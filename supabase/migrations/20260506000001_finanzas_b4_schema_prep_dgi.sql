-- =============================================================================
-- FEATURE: Finanzas — schema prep DGI (registro manual pre-integración eFactura)
-- Fecha: 2026-05-06
-- Sprint: Fase 2B-MVP — Transición pre-integración eFactura (Camino 1)
--
-- Contexto:
--   El MVP de facturas (cerrado en commit eca963a) emite facturas INTERNAS,
--   no fiscales. Hasta que se implemente la integración con el PAC (Camino 2,
--   bloqueado por credenciales sandbox), las abogadas replican manualmente
--   cada factura interna en el portal de eFactura DGI.
--
--   Este sprint agrega 4 columnas a public.invoices para capturar los datos
--   oficiales que devuelve eFactura, permitiendo dejar trazabilidad entre la
--   factura interna del CRM y la factura electrónica fiscal de DGI.
--
--   Cuando llegue Camino 2, estas columnas las llenará el flujo automático
--   contra el PAC; mientras tanto se llenan a mano desde la pantalla de
--   detalle.
--
--   Convención del repo: ADD COLUMN idempotente, todas NULL (no requieren
--   default — son opcionales hasta que la abogada complete el flujo).
--
-- Tablas afectadas:
--   - public.invoices (ALTER, agrega 4 columnas, ningún CHECK)
--
-- Columnas agregadas:
--   dgi_numero_documento     TEXT          — número de documento oficial DGI.
--                                              Formato típico: 10 dígitos (ej '0000001234').
--                                              Validación de formato se hace en la app
--                                              (no en DB) para no bloquear casos atípicos
--                                              que pueda devolver eFactura en el futuro.
--                                              Se llena tras emitir en eFactura.
--   dgi_cufe                 TEXT          — CUFE (Código Único de Factura Electrónica)
--                                              que retorna eFactura. String largo
--                                              (típicamente 40+ caracteres alfanuméricos).
--   dgi_fecha_autorizacion   TIMESTAMPTZ   — timestamp de autorización por DGI según
--                                              eFactura. Diferente del issue_date interno.
--   dgi_cafe_url             TEXT          — URL del CAFE (Constancia de Autorización
--                                              de Facturación Electrónica) emitido por
--                                              DGI. Se valida como URL en la app.
--
-- Interacción con triggers existentes:
--   T4 (trg_invoice_immutability) usa una WHITELIST EXPLÍCITA de columnas
--   restringidas (invoice_number, invoice_kind, quote_id, client_id, case_id,
--   issue_date, due_date, currency, *_total, notes, tenant_id, created_at,
--   created_by). Las 4 columnas nuevas NO están en esa lista, por lo que son
--   modificables post-emisión sin necesidad de modificar T4. Esto es
--   exactamente lo que queremos: la abogada captura los datos DGI DESPUÉS
--   de emitir la factura interna.
--
-- Aplicación:
--   Ejecutar manualmente en Supabase SQL Editor (proyecto del cliente
--   Integra Legal). Convención del proyecto: las migraciones nuevas se
--   ejecutan a mano, no vía `supabase db push`.
--
-- Reversibilidad:
--   ADD COLUMN no es destructivo. El rollback (al final del archivo) hace
--   DROP COLUMN IF EXISTS de las 4 columnas. Pierde solo los valores
--   capturados manualmente. Seguro.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Agregar columnas (idempotente: ADD COLUMN IF NOT EXISTS)
-- -----------------------------------------------------------------------------
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dgi_numero_documento   TEXT        NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dgi_cufe               TEXT        NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dgi_fecha_autorizacion TIMESTAMPTZ NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dgi_cafe_url           TEXT        NULL;

-- -----------------------------------------------------------------------------
-- 2. COMMENT ON COLUMN — documentación para el siguiente desarrollador / DBA
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN invoices.dgi_numero_documento IS
  'Número de documento oficial asignado por eFactura DGI tras replicar la factura interna. '
  'Típicamente 10 dígitos numéricos. Se llena manualmente desde la UI cuando la abogada '
  'termina de emitir la factura electrónica en el portal DGI. Cuando llegue la integración '
  'PAC (Camino 2) lo poblará el flujo automático.';

COMMENT ON COLUMN invoices.dgi_cufe IS
  'CUFE (Código Único de Factura Electrónica) emitido por eFactura DGI. String alfanumérico '
  'largo. Captura manual hasta integración PAC. Su presencia indica que la factura interna '
  'ya tiene contraparte fiscal oficial.';

COMMENT ON COLUMN invoices.dgi_fecha_autorizacion IS
  'Fecha y hora de autorización oficial por DGI según el sistema eFactura. Distinta del '
  'issue_date interno del CRM (que es la fecha en que se emitió la factura interna). '
  'Captura manual hasta integración PAC.';

COMMENT ON COLUMN invoices.dgi_cafe_url IS
  'URL del CAFE (Constancia de Autorización de Facturación Electrónica) descargable desde '
  'eFactura DGI. Opcional. Validación de formato URL se hace en la app.';

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

-- 1. Listar las 4 columnas nuevas (deben aparecer todas, is_nullable=YES):
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'invoices'
  AND  column_name IN ('dgi_numero_documento', 'dgi_cufe',
                       'dgi_fecha_autorizacion', 'dgi_cafe_url')
ORDER BY column_name;
-- Esperado: 4 filas, todas is_nullable='YES', column_default NULL.

-- 2. Confirmar que los COMMENTS quedaron registrados:
SELECT a.attname AS column_name,
       pg_catalog.col_description(a.attrelid, a.attnum) AS comment
FROM   pg_catalog.pg_attribute a
WHERE  a.attrelid = 'public.invoices'::regclass
  AND  a.attname IN ('dgi_numero_documento', 'dgi_cufe',
                     'dgi_fecha_autorizacion', 'dgi_cafe_url')
ORDER BY a.attname;
-- Esperado: 4 filas con su comment correspondiente (no NULL).

-- 3. Confirmar que T4 sigue activo y NO incluye las nuevas columnas en su
--    whitelist (smoke check de no-regresión):
SELECT tgname, tgenabled
FROM   pg_trigger
WHERE  tgrelid = 'public.invoices'::regclass
  AND  tgname  = 'trg_invoice_immutability';
-- Esperado: 1 fila, tgenabled='O' (origin / enabled).

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir)
-- -----------------------------------------------------------------------------
-- ATENCIÓN: el rollback descarta los valores DGI capturados manualmente. Si
-- ya hay facturas con datos DGI registrados, se pierden de forma irrecuperable
-- (no hay tabla de respaldo). Antes de rollback considerá exportar:
--   SELECT id, invoice_number, dgi_numero_documento, dgi_cufe,
--          dgi_fecha_autorizacion, dgi_cafe_url
--   FROM   invoices
--   WHERE  dgi_numero_documento IS NOT NULL
--      OR  dgi_cufe             IS NOT NULL;
-- =============================================================================
-- BEGIN;
--
-- ALTER TABLE invoices DROP COLUMN IF EXISTS dgi_cafe_url;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS dgi_fecha_autorizacion;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS dgi_cufe;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS dgi_numero_documento;
--
-- COMMIT;
