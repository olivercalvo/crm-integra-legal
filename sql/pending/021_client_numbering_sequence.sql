-- =============================================================================
-- HOT-FIX CLIENT-NUMBERING — Secuencia atómica para client_number
-- Fecha: 2026-06-04
-- Sprint: hot-fix sobre incidente "duplicate key value violates unique
--         constraint idx_clients_number_tenant" reportado por Daveiva el
--         2026-06-04 al crear una cotización con prospecto nuevo.
--
-- Contexto:
--   Hoy client_number se genera en código con ORDER BY client_number DESC
--   LIMIT 1 + regex /CLI-(\d+)/ y fallback nextNum=1 si el regex no matchea.
--   Cuando hay filas con prefijo lex-mayor que 'CLI-' (ej. TEST-FE-002 que
--   se insertaron como fixtures de la integración eFactura), esa fila gana
--   el ORDER BY, el regex no matchea, el fallback cae a CLI-001 y la
--   INSERT viola el UNIQUE (tenant_id, client_number). Además, aun sin
--   prefijos raros, el sort lexicográfico se rompe en CLI-1000 (queda
--   "menor" que CLI-999) y la lógica nunca arregla esa transición.
--
--   Esta migración introduce 'client' como sequence_type válido en
--   numbering_sequences y seedea la fila con last_number = MAX(suffix
--   numérico de CLI-NNN) actual, filtrando explícitamente filas que NO
--   matchean el patrón (TEST-FE-*, imports legacy con otro formato, etc.).
--   El código pasa a usar la RPC get_next_sequence_number (SELECT FOR
--   UPDATE → atómico, sin race) ya consolidada en facturas y cotizaciones.
--
-- Cambios:
--   1. ALTER numbering_sequences_sequence_type_check: agregar 'client'
--      al CHECK existente ('quote','invoice_hon','invoice_reim',
--      'credit_note'). El CHECK era inline en la CREATE TABLE original
--      (migration 20260505000002), así que su nombre auto-generado es
--      'numbering_sequences_sequence_type_check'.
--   2. INSERT (idempotente con ON CONFLICT DO NOTHING) una fila por
--      tenant con sequence_type='client' y last_number derivado del MAX
--      de los client_number que matchean ^CLI-\d+$.
--      - Tenants sin clientes válidos arrancan con last_number=0 →
--        el primer allocate devuelve CLI-001.
--      - El filtro descarta TEST-FE-*, prefijos diferentes y nulls.
--
-- Aplicación:
--   Manual en Supabase SQL Editor (convención sql/pending/).
--   Idempotente: ALTER CHECK usa DROP IF EXISTS + ADD; INSERT usa
--   ON CONFLICT (tenant_id, sequence_type) DO NOTHING.
--
-- Pre-requisito:
--   La RPC public.get_next_sequence_number ya existe en prod desde la
--   migration 20260505000002. No requiere cambios.
--
-- Mitigación previa recomendada (NO incluida en este script):
--   Renombrar las dos filas TEST-FE-001/002 a un prefijo lex-bajo
--   (ej. '0TEST-FE-001') antes de seedear, para evitar que vuelvan a
--   contaminar reportes que ordenen por client_number. Esto es
--   cosmético — la secuencia ya no las mira para nada gracias al
--   filtro del seed. Se ejecuta aparte.
--
-- Reversibilidad: ver bloque ROLLBACK comentado al final.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. ALTER CHECK numbering_sequences_sequence_type_check: agregar 'client'
-- -----------------------------------------------------------------------------
ALTER TABLE numbering_sequences
  DROP CONSTRAINT IF EXISTS numbering_sequences_sequence_type_check;

ALTER TABLE numbering_sequences
  ADD CONSTRAINT numbering_sequences_sequence_type_check
  CHECK (sequence_type IN (
    'quote',
    'invoice_hon',
    'invoice_reim',
    'credit_note',
    'client'
  ));

-- -----------------------------------------------------------------------------
-- 2. SEED: fila por tenant con last_number derivado del MAX(suffix).
-- -----------------------------------------------------------------------------
-- Filtra explícitamente solo client_number que matchean ^CLI-\d+$ para
-- que prefijos no-canónicos (TEST-FE-001, legacy imports, etc.) NO
-- contaminen el seed. Tenants sin clientes válidos arrancan en 0.
INSERT INTO numbering_sequences (tenant_id, sequence_type, last_number)
SELECT
  t.id AS tenant_id,
  'client' AS sequence_type,
  COALESCE(
    (
      SELECT MAX(
        (regexp_match(c.client_number, '^CLI-(\d+)$'))[1]::INT
      )
      FROM clients c
      WHERE c.tenant_id = t.id
        AND c.client_number ~ '^CLI-\d+$'
    ),
    0
  ) AS last_number
FROM tenants t
ON CONFLICT (tenant_id, sequence_type) DO NOTHING;

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

-- 1. Confirmar que 'client' está en el CHECK:
-- SELECT pg_get_constraintdef(oid)
-- FROM   pg_constraint
-- WHERE  conrelid='public.numbering_sequences'::regclass
--   AND  conname='numbering_sequences_sequence_type_check';
-- Esperado: ... 'client' ... en la lista.

-- 2. Confirmar fila seedeada para el tenant de Integra Legal:
-- SELECT tenant_id, sequence_type, last_number
-- FROM   numbering_sequences
-- WHERE  sequence_type = 'client'
--   AND  tenant_id = 'a0000000-0000-0000-0000-000000000001';
-- Esperado: last_number ≈ 75 (último CLI-NNN canónico). Si es 0 → revisar
-- que hay filas con client_number ~ '^CLI-\d+$' en clients.

-- 3. Cross-check contra el MAX real:
-- SELECT MAX((regexp_match(client_number, '^CLI-(\d+)$'))[1]::INT)
-- FROM   clients
-- WHERE  tenant_id = 'a0000000-0000-0000-0000-000000000001'
--   AND  client_number ~ '^CLI-\d+$';
-- Esperado: idéntico al last_number de (2).

-- 4. Smoke test sin gastar número (preview):
-- SELECT last_number + 1 AS next_client_number
-- FROM   numbering_sequences
-- WHERE  tenant_id     = 'a0000000-0000-0000-0000-000000000001'
--   AND  sequence_type = 'client';
-- Esperado: 76 si el seed es 75.

-- 5. Smoke test consumiendo (avanza la secuencia — usar solo si va a
--    crearse un cliente real a continuación, o aceptar el gap):
-- SELECT get_next_sequence_number(
--   'a0000000-0000-0000-0000-000000000001'::uuid,
--   'client'
-- );
-- Esperado: el siguiente INT (ej. 76). Re-ejecutar devuelve 77, etc.

-- =============================================================================
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- Solo necesario si se decide volver al algoritmo viejo (no recomendado:
-- el bug original vuelve a estar latente). Para revertir:
--
-- BEGIN;
--
--   -- 1. Borrar las filas de secuencia 'client' (si no se usaron, seguras
--   --    de borrar; si ya se consumieron números vía allocator, perdés
--   --    el contador y al reseedear quedará en MAX actual).
--   DELETE FROM numbering_sequences WHERE sequence_type = 'client';
--
--   -- 2. Restaurar el CHECK previo sin 'client'.
--   ALTER TABLE numbering_sequences
--     DROP CONSTRAINT IF EXISTS numbering_sequences_sequence_type_check;
--   ALTER TABLE numbering_sequences
--     ADD CONSTRAINT numbering_sequences_sequence_type_check
--     CHECK (sequence_type IN (
--       'quote','invoice_hon','invoice_reim','credit_note'
--     ));
--
-- COMMIT;
--
-- IMPORTANTE: el rollback de la migration NO arregla el código TS — habría
-- que revertir también el commit que reemplaza las 5 copias por el
-- allocator, porque si el código sigue llamando a get_next_sequence_number
-- con p_sequence_type='client' y la fila no existe, la RPC lanza
-- no_data_found y la creación de cliente falla. Por eso el ORDEN de
-- deploy es: SEED PRIMERO, luego deploy del código.
-- =============================================================================
