-- EJECUTADO EN PRODUCCIÓN: 2026-05-29 (cleanup smoke Sprint 2E.4).
-- =============================================================================
-- 018 — Limpieza de cotizaciones de prueba (Sprint 2E.4 smoke testing)
-- Fecha:   2026-05-29
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
-- Autor:   Oliver (planificado) + Claude (generación)
--
-- OBJETIVO
--   Eliminar 18 cotizaciones de prueba creadas durante el smoke testing del
--   Sprint 2E.4 y todo su rastro derivado:
--     - quote_lines, quote_acceptances, quote_rejections (CASCADE FK)
--     - invoices generadas vía convertToInvoices (FK quote_id ON DELETE SET NULL)
--     - invoice_lines, credit_notes, credit_note_lines, payment_applications
--       de esas invoices
--     - documents con entity_type='quote' (los PDFs generados) e
--       entity_type='invoice' (PDFs de las facturas asociadas)
--
--   NO toca:
--     - payments (los pagos son a nivel cliente; aunque queden con
--       amount_unapplied > 0 tras borrar applications, NO se eliminan
--       para evitar tocar datos de prueba ajenos a estas cotizaciones).
--     - documents con source='auto_signed_quote_pdf' (entity_type='client'
--       o 'case') — sin FK directa al quote. Ver sección (D) al final.
--     - audit_log (registros históricos polimórficos sin FK).
--
-- POR QUÉ HAY QUE DESHABILITAR TRIGGERS
--   Los triggers de protección del módulo Finanzas (T5b/T5c/T5d/T6/T5) están
--   diseñados para producción y bloquean cualquier DELETE sobre:
--     - quotes con status != 'borrador'        (T6 finanzas_no_delete_protected)
--     - invoices con status != 'borrador'      (T6 idem)
--     - credit_notes (siempre)                 (T6 idem)
--     - payments con status != 'registrado'    (T6 idem)
--     - quote_lines / invoice_lines / credit_note_lines bajo padres no-borrador
--       (T5b/T5c/T5d *_immutability)
--
--   Como las 18 cotizaciones están en estados 'enviada'/'aceptada'/'rechazada'
--   y muchas tienen invoices 'emitida', no se pueden eliminar por la vía normal.
--   Solución estándar de cleanup en PostgreSQL/Supabase:
--     SET LOCAL session_replication_role = 'replica';
--   Deshabilita TODOS los triggers ORIGIN (los de usuario, incluyendo los
--   de protección) Y los chequeos de FK durante la sesión. Como es SET LOCAL,
--   se revierte automáticamente al COMMIT/ROLLBACK. Requiere rol `postgres`
--   (el del SQL Editor de Supabase ya lo tiene).
--
-- ESTRUCTURA (estándar del repo)
--   (A) PRE-CHECK   — SELECTs informativos para confirmar alcance
--   (B) DELETEs     — en orden de dependencia, todos scopeados a los 18 ids
--   (C) POST-CHECK  — SELECTs confirmando 0 filas restantes
--   (D) Nota Storage — sobre los PDFs huérfanos en Supabase Storage
--
-- COMO USAR
--   1. Pegar TODO en el SQL Editor de Supabase (proyecto del cliente).
--   2. Correr tal cual. Termina con ROLLBACK comentado + COMMIT comentado
--      → la transacción QUEDA ABIERTA al final del bloque (porque ni una ni
--      el otro se ejecutan). Hay que terminarla manualmente:
--        - Si los counters de (C) son los esperados: descomentá `COMMIT;` y
--          córrelo (o ejecutá `COMMIT;` suelto en la consola).
--        - Si algo no cuadra: descomentá `ROLLBACK;` (o `ROLLBACK;` suelto).
--   3. Para verificar antes de commitear, correr una segunda consulta en la
--      misma sesión, ej. `SELECT COUNT(*) FROM quotes WHERE id IN (...);`
--      → si la transacción sigue abierta, debería ya ver 0; el ROLLBACK
--      restituiría el estado.
--
-- =============================================================================

BEGIN;

-- =============================================================================
-- (0) TABLAS TEMPORALES DE TRABAJO
-- -----------------------------------------------------------------------------
-- Patrón estándar para cleanup multi-tabla: poblamos el set de IDs una vez,
-- y todos los DELETEs lo referencian. Evita repetir 18 UUIDs en cada query y
-- evita drift si alguien edita la lista en un punto y olvida otro.
-- =============================================================================

CREATE TEMP TABLE target_quote_ids (
  quote_id UUID PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO target_quote_ids (quote_id) VALUES
  ('8b03c88e-ecf6-40d6-8d84-e4aa40e31c64'),
  ('1794484c-6ad1-44d4-85c4-cbfd4e84ead9'),
  ('7bec3d99-a095-47ca-adf5-2f1a26298202'),
  ('41e5f37d-dc94-4110-a025-d14c99c52e59'),
  ('32ec4230-d7d2-4957-87aa-4728982d89af'),
  ('a4214d39-d4c9-4cba-a37c-c64974ad45e6'),
  ('2ead3a91-3fe8-4fef-bead-986ed844d0dd'),
  ('da63e4ca-c5d0-4e10-bf7e-17b428c7e6a8'),
  ('7cb05282-f135-4892-9315-aead899568d3'),
  ('6784eb81-b542-4b8f-b95b-e74e0adf6b99'),
  ('90e53faf-6e6f-4628-a770-f39aab257867'),
  ('a61a5e7d-bff9-4587-b550-9166b6d68b47'),
  ('5624810c-8808-4fb1-bb98-2d30992aa510'),
  ('88b5b2bb-3a8a-4e65-8da0-2d8e6a083be0'),
  ('534dfb4a-f3c5-4114-aaf3-21d3b574398e'),
  ('cce547c9-9ce5-4e88-8433-ccdda355ba19'),
  ('23993471-dc71-49e6-be23-d5e6bbc0d251'),
  ('e734ad01-b00f-4d55-8998-4187f24cfb1f');

-- Capturar las facturas generadas desde esas quotes (FK quote_id en invoices).
-- Lo hacemos AHORA porque más adelante haremos UPDATE quote_id=NULL implícito
-- vía DELETE de quotes (ON DELETE SET NULL) — entonces si esperamos a borrar
-- quotes primero, perdemos la relación.
CREATE TEMP TABLE target_invoice_ids (
  invoice_id UUID PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO target_invoice_ids (invoice_id)
SELECT id
FROM invoices
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND quote_id IN (SELECT quote_id FROM target_quote_ids);


-- =============================================================================
-- (A) PRE-CHECK — confirmar alcance antes de borrar
-- =============================================================================

-- A.1. Las 18 cotizaciones, con datos para identificarlas a ojo:
SELECT
  q.quote_number,
  q.title,
  q.status,
  c.name AS client_name,
  q.issue_date,
  q.grand_total,
  q.id
FROM quotes q
JOIN clients c ON c.id = q.client_id
WHERE q.tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND q.id IN (SELECT quote_id FROM target_quote_ids)
ORDER BY q.quote_number;
-- Esperado: 18 filas. Si menos, alguna ID no existe o pertenece a otro tenant.

-- A.2. Las facturas que se van a borrar con sus estados (clave para entender
-- el impacto: si alguna está 'pagada' eso significa que se simuló cobro
-- contra una cotización de prueba — el cleanup las elimina igual).
SELECT
  i.invoice_number,
  i.invoice_kind,
  i.status,
  i.issue_date,
  i.grand_total,
  i.amount_paid,
  i.quote_id,
  i.id
FROM invoices i
WHERE i.id IN (SELECT invoice_id FROM target_invoice_ids)
ORDER BY i.invoice_number;
-- Si retorna 0 filas → ninguna de las 18 fue convertida a factura. OK.

-- A.3. Conteo agregado de filas a eliminar por tabla:
SELECT 'quotes (target)'             AS tabla,
       (SELECT COUNT(*) FROM quotes
        WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
          AND id IN (SELECT quote_id FROM target_quote_ids)) AS filas
UNION ALL
SELECT 'quote_lines',
       (SELECT COUNT(*) FROM quote_lines
        WHERE quote_id IN (SELECT quote_id FROM target_quote_ids))
UNION ALL
SELECT 'quote_acceptances',
       (SELECT COUNT(*) FROM quote_acceptances
        WHERE quote_id IN (SELECT quote_id FROM target_quote_ids))
UNION ALL
SELECT 'quote_rejections',
       (SELECT COUNT(*) FROM quote_rejections
        WHERE quote_id IN (SELECT quote_id FROM target_quote_ids))
UNION ALL
SELECT 'invoices (linked)',
       (SELECT COUNT(*) FROM invoices
        WHERE id IN (SELECT invoice_id FROM target_invoice_ids))
UNION ALL
SELECT 'invoice_lines (of those)',
       (SELECT COUNT(*) FROM invoice_lines
        WHERE invoice_id IN (SELECT invoice_id FROM target_invoice_ids))
UNION ALL
SELECT 'credit_notes (of those)',
       (SELECT COUNT(*) FROM credit_notes
        WHERE invoice_id IN (SELECT invoice_id FROM target_invoice_ids))
UNION ALL
SELECT 'credit_note_lines (of those)',
       (SELECT COUNT(*) FROM credit_note_lines
        WHERE credit_note_id IN (
          SELECT id FROM credit_notes
          WHERE invoice_id IN (SELECT invoice_id FROM target_invoice_ids)
        ))
UNION ALL
SELECT 'payment_applications (of those invoices)',
       (SELECT COUNT(*) FROM payment_applications
        WHERE invoice_id IN (SELECT invoice_id FROM target_invoice_ids))
UNION ALL
SELECT 'documents entity_type=quote',
       (SELECT COUNT(*) FROM documents
        WHERE entity_type = 'quote'
          AND entity_id IN (SELECT quote_id FROM target_quote_ids))
UNION ALL
SELECT 'documents entity_type=invoice (linked)',
       (SELECT COUNT(*) FROM documents
        WHERE entity_type = 'invoice'
          AND entity_id IN (SELECT invoice_id FROM target_invoice_ids))
ORDER BY tabla;
-- Esperado: 'quotes (target)' = 18. El resto puede ser 0 o positivo.

-- A.4. Diagnóstico extra — payments que tienen aplicaciones contra estas
-- invoices (informativo, NO se borran; ver header). Si retorna > 0, esos
-- pagos quedarán con amount_unapplied > 0 tras el cleanup.
SELECT DISTINCT
  p.id              AS payment_id,
  p.payment_number,
  p.payment_date,
  p.amount,
  p.amount_unapplied AS unapplied_actual,
  p.status,
  c.name            AS client_name
FROM payments p
JOIN payment_applications pa ON pa.payment_id = p.id
JOIN clients c              ON c.id = p.client_id
WHERE pa.invoice_id IN (SELECT invoice_id FROM target_invoice_ids)
ORDER BY p.payment_date;
-- Si retorna 0 → ningún pago será impactado. OK.
-- Si retorna > 0 → revisar caso a caso si conviene borrar manualmente esos
-- pagos también (ver (D) al final).

-- A.5. Documents auto-firmados huérfanos (informativo, NO se borran aquí;
-- no tienen FK al quote, solo el quote_number en file_name). Ver (D):
SELECT
  d.id,
  d.entity_type,
  d.file_name,
  d.storage_key,
  d.source,
  d.created_at
FROM documents d
JOIN quotes q
  ON q.tenant_id = d.tenant_id
 AND q.id IN (SELECT quote_id FROM target_quote_ids)
 AND d.file_name LIKE q.quote_number || '-firmada-%'
WHERE d.source = 'auto_signed_quote_pdf'
ORDER BY d.created_at DESC;
-- Si retorna filas, esos rows quedarán huérfanos (sin entity referente real
-- una vez borrada la quote). Limpieza opcional en (D).


-- =============================================================================
-- (B) DELETEs en orden de dependencia
-- -----------------------------------------------------------------------------
-- session_replication_role = 'replica' deshabilita TODOS los triggers ORIGIN
-- (incluyendo T5b/T5c/T5d/T5/T6) y los chequeos de FK. SET LOCAL → solo en
-- esta transacción; al COMMIT/ROLLBACK vuelve a 'origin' automáticamente.
--
-- IMPORTANTE: requiere rol postgres / superuser. El SQL Editor de Supabase
-- corre con ese rol por defecto. Si esto se intentara desde un anon/service
-- restringido, fallaría con "permission denied to set parameter".
-- =============================================================================

SET LOCAL session_replication_role = 'replica';

-- B.1. PDFs de cotización (entity_type='quote') — sin FK, limpieza manual.
DELETE FROM documents
WHERE entity_type = 'quote'
  AND entity_id IN (SELECT quote_id FROM target_quote_ids);

-- B.2. PDFs de factura (entity_type='invoice') — sin FK, limpieza manual.
DELETE FROM documents
WHERE entity_type = 'invoice'
  AND entity_id IN (SELECT invoice_id FROM target_invoice_ids);

-- B.3. Payment applications de las invoices objetivo (FK NO ACTION en
-- invoice_id → bloquearía borrar invoices si no las quitamos primero).
DELETE FROM payment_applications
WHERE invoice_id IN (SELECT invoice_id FROM target_invoice_ids);

-- B.4. Credit note lines (FK CASCADE pero con T5d siempre bloqueando — ya
-- deshabilitado por replica). Las hacemos explícitas para legibilidad.
DELETE FROM credit_note_lines
WHERE credit_note_id IN (
  SELECT id FROM credit_notes
  WHERE invoice_id IN (SELECT invoice_id FROM target_invoice_ids)
);

-- B.5. Credit notes (FK NO ACTION en invoice_id, y T6 siempre bloquea).
DELETE FROM credit_notes
WHERE invoice_id IN (SELECT invoice_id FROM target_invoice_ids);

-- B.6. Invoice lines (FK CASCADE, T5c bloqueado por replica).
DELETE FROM invoice_lines
WHERE invoice_id IN (SELECT invoice_id FROM target_invoice_ids);

-- B.7. Invoices generadas desde estas quotes (T6 bloqueado por replica).
DELETE FROM invoices
WHERE id IN (SELECT invoice_id FROM target_invoice_ids);

-- B.8. Quote acceptances (FK CASCADE — explícito para audit visible).
DELETE FROM quote_acceptances
WHERE quote_id IN (SELECT quote_id FROM target_quote_ids);

-- B.9. Quote rejections (FK CASCADE — explícito).
DELETE FROM quote_rejections
WHERE quote_id IN (SELECT quote_id FROM target_quote_ids);

-- B.10. Quote lines (FK CASCADE, T5b bloqueado por replica).
DELETE FROM quote_lines
WHERE quote_id IN (SELECT quote_id FROM target_quote_ids);

-- B.11. Quotes (T6 bloqueado por replica).
DELETE FROM quotes
WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND id IN (SELECT quote_id FROM target_quote_ids);

-- Restaurar el rol normal de replicación. SET LOCAL se revierte solo al
-- COMMIT/ROLLBACK, pero lo hacemos explícito por simetría — si en el futuro
-- alguien copia este bloque sin la transacción envolvente, los triggers no
-- quedan deshabilitados.
SET LOCAL session_replication_role = 'origin';


-- =============================================================================
-- (C) POST-CHECK — confirmar 0 filas restantes
-- -----------------------------------------------------------------------------
-- Idéntico a A.3 pero esperando 0 en TODO. Si algún contador sale != 0,
-- significa que un DELETE no agarró las filas — NO HAGAS COMMIT, abortá.
-- =============================================================================

SELECT 'quotes (should be 0)'                AS tabla,
       (SELECT COUNT(*) FROM quotes
        WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
          AND id IN (SELECT quote_id FROM target_quote_ids)) AS filas
UNION ALL
SELECT 'quote_lines',
       (SELECT COUNT(*) FROM quote_lines
        WHERE quote_id IN (SELECT quote_id FROM target_quote_ids))
UNION ALL
SELECT 'quote_acceptances',
       (SELECT COUNT(*) FROM quote_acceptances
        WHERE quote_id IN (SELECT quote_id FROM target_quote_ids))
UNION ALL
SELECT 'quote_rejections',
       (SELECT COUNT(*) FROM quote_rejections
        WHERE quote_id IN (SELECT quote_id FROM target_quote_ids))
UNION ALL
SELECT 'invoices (linked)',
       (SELECT COUNT(*) FROM invoices
        WHERE id IN (SELECT invoice_id FROM target_invoice_ids))
UNION ALL
SELECT 'invoice_lines (of those)',
       (SELECT COUNT(*) FROM invoice_lines
        WHERE invoice_id IN (SELECT invoice_id FROM target_invoice_ids))
UNION ALL
SELECT 'credit_notes (of those)',
       (SELECT COUNT(*) FROM credit_notes
        WHERE invoice_id IN (SELECT invoice_id FROM target_invoice_ids))
UNION ALL
SELECT 'credit_note_lines (of those)',
       (SELECT COUNT(*) FROM credit_note_lines
        WHERE credit_note_id IN (
          SELECT id FROM credit_notes
          WHERE invoice_id IN (SELECT invoice_id FROM target_invoice_ids)
        ))
UNION ALL
SELECT 'payment_applications (of those)',
       (SELECT COUNT(*) FROM payment_applications
        WHERE invoice_id IN (SELECT invoice_id FROM target_invoice_ids))
UNION ALL
SELECT 'documents entity_type=quote',
       (SELECT COUNT(*) FROM documents
        WHERE entity_type = 'quote'
          AND entity_id IN (SELECT quote_id FROM target_quote_ids))
UNION ALL
SELECT 'documents entity_type=invoice (linked)',
       (SELECT COUNT(*) FROM documents
        WHERE entity_type = 'invoice'
          AND entity_id IN (SELECT invoice_id FROM target_invoice_ids))
ORDER BY tabla;
-- Esperado: TODAS las filas con `filas = 0`. Si algo != 0 → ROLLBACK.


-- =============================================================================
-- ROLLBACK / COMMIT — descomentá el que corresponda
-- =============================================================================
-- ROLLBACK;
-- COMMIT;


-- =============================================================================
-- (D) NOTAS POST-CLEANUP
-- =============================================================================
--
-- D.1. STORAGE: PDFs huérfanos en Supabase Storage
-- -----------------------------------------------------------------------------
-- El DELETE de la tabla `documents` SOLO elimina los rows. Los archivos
-- físicos en el bucket `documents` de Supabase Storage QUEDAN HUÉRFANOS.
--
-- Los paths siguen el patrón (ver src/lib/finanzas/pdf/ensure-signed-quote-pdf.ts
-- y ensure-quote-pdf.ts):
--
--   PDFs de cotización on-demand (Sprint 2E.3):
--     tenants/{tenantId}/cotizaciones/{quoteId}/{quote_number}-{version}.pdf
--     (el path exacto está en documents.storage_key — capturado antes de
--      borrar en una segunda corrida si hace falta, ver SELECT abajo)
--
--   PDFs firmados de aceptación (Sprint 2E.4):
--     tenants/{tenantId}/clientes/{clientId}/propuestas-aceptadas/{quote_number}-firmada-{timestamp}.pdf
--
-- Para limpiar Storage (manual, post-COMMIT de este script):
--   a) Antes de COMMITear (este script aún abierto), correr:
--        SELECT storage_key
--        FROM documents
--        WHERE entity_type = 'quote'
--          AND entity_id IN (SELECT quote_id FROM target_quote_ids);
--      → guardar la lista de paths en un .txt.
--   b) En Supabase Dashboard → Storage → bucket `documents` → eliminar
--      esos paths a mano, O usar la CLI de Supabase / API de Storage para
--      borrar en bulk.
--
-- (Alternativa: si no te importa el espacio en Storage, ignoralos. No rompen
-- nada — son blobs sin referencia en la app porque sus rows de documents
-- ya están eliminados.)
--
--
-- D.2. PDFs FIRMADOS COMPARTIDOS (auto_signed_quote_pdf con entity_type='client'/'case')
-- -----------------------------------------------------------------------------
-- Estos rows NO se borran en este script porque no tienen FK al quote
-- (su entity_id apunta al client o al case, no al quote). Quedan visibles en
-- la sección "Documentos" del cliente como referencia histórica.
--
-- Para identificarlos y eliminarlos manualmente (post-COMMIT):
--
--   -- Lista de candidatos (ya documentada en A.5):
--   SELECT d.id, d.entity_type, d.entity_id, d.file_name, d.storage_key
--   FROM documents d
--   WHERE d.source = 'auto_signed_quote_pdf'
--     AND d.tenant_id = 'a0000000-0000-0000-0000-000000000001'
--     AND d.file_name LIKE ANY (ARRAY[
--       'COT-001275-firmada-%',  -- reemplazar con los quote_number reales
--       'COT-001291-firmada-%',
--       -- ...etc
--     ]);
--
--   -- DELETE manual una vez confirmados (en otra transacción aparte):
--   BEGIN;
--     SET LOCAL session_replication_role = 'replica';  -- no necesario
--                                                       -- porque documents
--                                                       -- no tiene T6, pero
--                                                       -- por consistencia
--     DELETE FROM documents WHERE id IN (...ids confirmados...);
--   COMMIT;
--
-- NOTA: el rol postgres puede borrar documents directamente (no hay trigger
-- de protección sobre documents en sí — el bloqueo de "no borrar manual" vive
-- en /api/documents/[id]/delete a nivel app, no en DB).
--
--
-- D.3. PAYMENTS HUÉRFANOS (amount_unapplied > 0 tras cleanup)
-- -----------------------------------------------------------------------------
-- Si A.4 retornó payments con aplicaciones contra las invoices objetivo,
-- esos pagos siguen en la tabla payments con amount_unapplied = amount (ya
-- no tienen applications). Casos:
--
--   - Si esos payments son de prueba (creados durante el smoke testing) →
--     borralos manualmente:
--
--       BEGIN;
--         SET LOCAL session_replication_role = 'replica';  -- bypass T6
--         DELETE FROM payments WHERE id IN (...ids de A.4...);
--       COMMIT;
--
--   - Si son payments reales que se aplicaron por error a estas invoices →
--     revisar cliente por cliente. NO ejecutar el DELETE arriba.
--
--
-- D.4. AUDIT_LOG (no se toca)
-- -----------------------------------------------------------------------------
-- La tabla audit_log puede tener filas con entity='quotes' AND entity_id IN
-- (los 18) acumuladas durante el testing. NO se borran porque:
--   a) audit_log es históricamente inmutable por convención del proyecto
--      (ver migration_completa.sql sección 14).
--   b) No tiene FK física a quotes — su contenido es texto.
--   c) Sirve como rastro de qué se hizo con esos quotes ANTES del cleanup,
--      útil si en el futuro hay que reconstruir el historial.
--
--
-- D.5. FKs NO CUBIERTAS EN ESTE SCRIPT
-- -----------------------------------------------------------------------------
-- - quotes.source_quote_id (FK recursivo, ON DELETE SET NULL): si alguna de
--   las 18 fue ORIGEN de una cotización duplicada que NO está en la lista,
--   esa duplicada queda con source_quote_id=NULL automáticamente (el SET
--   NULL ocurre incluso con session_replication_role='replica' porque es
--   parte del CASCADE FK, no de un trigger). Eso es el comportamiento
--   deseado: la duplicada sobrevive sin referencia.
--
-- - Sin FKs adicionales identificadas en migrations: el módulo Finanzas
--   completo (3a-3e) + ext 2E.3 + ext 2E.4 está cubierto.
--
-- =============================================================================
