-- =============================================================================
-- FEATURE: eFactura PTY (PAC DGI Panamá) — Fase 1A: Modelo de Datos
-- Sprint:  eFactura Integration — Fase 1A (modelo, sin API ni credenciales)
-- Fecha:   2026-05-30
-- EJECUTADO en Supabase 2026-05-30 (Fase 1A aplicada — clients +8 col, invoices +9 col, tablas fe_emisiones y fe_secuencias creadas).
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- Contexto:
--   Migración aditiva fundacional para preparar el esquema antes de integrar
--   el CRM con el PAC eFactura PTY. NO ejecuta llamadas a API ni requiere
--   credenciales — sólo prepara las columnas/tablas que el flujo posterior
--   necesitará. Las fases siguientes (cliente HTTP, polling, etc.) van por
--   sprints separados.
--
--   100% aditiva: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS. No
--   DROP, no ALTER destructivo. Todas las columnas nuevas son nullable o
--   con default seguro para no romper filas existentes.
--
-- DECISIONES DE MODELADO (consolidadas antes de ejecutar)
-- -----------------------------------------------------------------------------
--   - CUFE y fecha de autorización: NO se crean columnas nuevas. La fuente
--     única de verdad es la familia existente dgi_cufe / dgi_fecha_autorizacion
--     (sprint 2B-MVP Camino 1). El flujo de API por PAC reutilizará esas
--     mismas columnas (manual hoy, API mañana).
--   - Protocolo de autorización: se agrega como dgi_protocolo_autorizacion
--     (no `protocolo_autorizacion`) para integrarse a la familia dgi_ —
--     viene en la misma respuesta de autorización que dgi_cufe.
--   - tipo_contribuyente del PAC (1=natural, 2=jurídico): NO se almacena.
--     Se deriva en el mapper de la Fase 2 desde la columna existente
--     clients.client_type ('persona_natural'→1, 'persona_juridica'→2).
--   - invoices.numero_documento (BIGINT, nuevo): correlativo API autoritativo
--     a futuro. Convive con invoices.dgi_numero_documento (TEXT, captura
--     manual del portal Camino 1, legacy). Documentado en el COMMENT.
-- =============================================================================

-- =============================================================================
-- PRE-CHECK (informativo)
-- =============================================================================
DO $$
DECLARE
  v_clients_exists       INT;
  v_invoices_exists      INT;
  v_users_exists         INT;
  v_tenants_exists       INT;
  v_get_tenant_id        INT;
  v_update_updated_at    INT;
  v_fe_emisiones_exists  INT;
  v_fe_secuencias_exists INT;
BEGIN
  SELECT COUNT(*) INTO v_clients_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='clients';
  SELECT COUNT(*) INTO v_invoices_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='invoices';
  SELECT COUNT(*) INTO v_users_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='users';
  SELECT COUNT(*) INTO v_tenants_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='tenants';

  SELECT COUNT(*) INTO v_get_tenant_id
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_tenant_id';
  SELECT COUNT(*) INTO v_update_updated_at
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='update_updated_at';

  SELECT COUNT(*) INTO v_fe_emisiones_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='fe_emisiones';
  SELECT COUNT(*) INTO v_fe_secuencias_exists
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='fe_secuencias';

  RAISE NOTICE '— PRE-CHECK —';
  RAISE NOTICE 'Tabla clients: %, invoices: %, users: %, tenants: %',
    v_clients_exists, v_invoices_exists, v_users_exists, v_tenants_exists;
  RAISE NOTICE 'Función public.get_tenant_id(): %, public.update_updated_at(): %',
    v_get_tenant_id, v_update_updated_at;
  RAISE NOTICE 'fe_emisiones ya existe: %, fe_secuencias ya existe: %',
    v_fe_emisiones_exists, v_fe_secuencias_exists;

  IF v_clients_exists = 0 OR v_invoices_exists = 0
     OR v_users_exists = 0 OR v_tenants_exists = 0 THEN
    RAISE EXCEPTION 'ABORT: alguna tabla base falta (clients/invoices/users/tenants).';
  END IF;
  IF v_get_tenant_id = 0 OR v_update_updated_at = 0 THEN
    RAISE EXCEPTION 'ABORT: funciones helper public.get_tenant_id() / public.update_updated_at() no existen. Esperadas del initial_schema.';
  END IF;
END $$;

BEGIN;

-- =============================================================================
-- A. clients — campos del receptor según taxonomía PAC eFactura
-- -----------------------------------------------------------------------------
-- Conviven con tax_id / tax_id_type / billing_address que ya existen y NO se
-- modifican. Los nuevos campos modelan información estructurada que el PAC
-- requiere en el XML del receptor (DV del RUC, ubicación geográfica DGI,
-- clasificación de receptor, datos de extranjeros).
-- =============================================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS digito_verificador  TEXT     NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tipo_receptor_fe    TEXT     NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS codigo_ubicacion    TEXT     NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS corregimiento       TEXT     NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS distrito            TEXT     NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS provincia           TEXT     NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS id_extranjero       TEXT     NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pais_receptor       TEXT     NULL;

-- CHECK constraints nombrados, idempotentes (DROP + ADD).

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_tipo_receptor_fe_check;
ALTER TABLE clients
  ADD CONSTRAINT clients_tipo_receptor_fe_check
  CHECK (tipo_receptor_fe IS NULL OR tipo_receptor_fe IN ('01','02','03','04'));

COMMENT ON COLUMN clients.digito_verificador IS
  'DV del RUC panameño (típicamente 1 a 2 dígitos). Requerido por el PAC para receptores con tipo_receptor_fe=01.';
COMMENT ON COLUMN clients.tipo_receptor_fe IS
  'Taxonomía de receptor según DGI: 01=contribuyente RUC, 02=consumidor final, 03=entidad gubernamental, 04=receptor extranjero.';
COMMENT ON COLUMN clients.codigo_ubicacion IS
  'Código compuesto DGI de ubicación geográfica (provincia-distrito-corregimiento). Estructurado, distinto del texto libre billing_address.';
COMMENT ON COLUMN clients.id_extranjero IS
  'Documento de identidad de receptores no-residentes. Aplica cuando tipo_receptor_fe=04.';
COMMENT ON COLUMN clients.pais_receptor IS
  'Código ISO del país del receptor extranjero. Aplica cuando tipo_receptor_fe=04.';

-- =============================================================================
-- B. invoices — campos de la emisión electrónica (PAC eFactura)
-- -----------------------------------------------------------------------------
-- Conviven con la familia dgi_ existente (dgi_numero_documento, dgi_cufe,
-- dgi_fecha_autorizacion, dgi_cafe_url — captura manual Camino 1). El nuevo
-- dgi_protocolo_autorizacion se integra a esa familia. Ver DECISIONES DE
-- MODELADO al inicio del archivo.
-- =============================================================================

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fe_estado                  TEXT       NOT NULL DEFAULT 'no_emitida';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dgi_protocolo_autorizacion TEXT       NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS i_amb                      SMALLINT   NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS punto_facturacion     VARCHAR(3) NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS numero_documento      BIGINT    NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qr_content            TEXT      NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cafe_storage_key      TEXT      NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xml_storage_key       TEXT      NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ef_invoice_uuid       UUID      NULL;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_fe_estado_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_fe_estado_check
  CHECK (fe_estado IN ('no_emitida','pending','authorized','canceled','error'));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_i_amb_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_i_amb_check
  CHECK (i_amb IS NULL OR i_amb IN (1, 2));

-- Índices parciales útiles para el flujo de polling/reintentos.
CREATE INDEX IF NOT EXISTS idx_invoices_fe_estado
  ON invoices(tenant_id, fe_estado)
  WHERE fe_estado <> 'no_emitida';
CREATE INDEX IF NOT EXISTS idx_invoices_ef_invoice_uuid
  ON invoices(ef_invoice_uuid)
  WHERE ef_invoice_uuid IS NOT NULL;

COMMENT ON COLUMN invoices.fe_estado IS
  'Estado del ciclo de vida en eFactura PAC. no_emitida (default, factura solo interna) → pending (enviada al PAC, esperando respuesta) → authorized (CUFE recibido) | canceled | error.';
COMMENT ON COLUMN invoices.dgi_protocolo_autorizacion IS
  'Protocolo de autorización retornado por DGI/PAC junto con dgi_cufe y dgi_fecha_autorizacion en la respuesta del endpoint de emisión. Familia dgi_ — captura manual hoy, API mañana.';
COMMENT ON COLUMN invoices.i_amb IS
  'Ambiente de emisión PAC: 1=producción, 2=pruebas (sandbox).';
COMMENT ON COLUMN invoices.punto_facturacion IS
  'Punto de facturación de 3 caracteres asignado por DGI al emisor. Forma parte del número de documento fiscal.';
COMMENT ON COLUMN invoices.numero_documento IS
  'Correlativo numérico que se envía al PAC. Fuente autoritativa a futuro del número de factura electrónica administrado por el CRM. Distinto de invoices.dgi_numero_documento (TEXT, captura manual del portal eFactura Camino 1, legacy).';
COMMENT ON COLUMN invoices.qr_content IS
  'Texto que se codifica en el QR del CAFE retornado por DGI.';
COMMENT ON COLUMN invoices.cafe_storage_key IS
  'Ruta en Supabase Storage donde queda el CAFE (PDF oficial). Distinto de dgi_cafe_url (URL externa).';
COMMENT ON COLUMN invoices.xml_storage_key IS
  'Ruta en Supabase Storage del XML firmado enviado al PAC (opcional, para auditoría).';
COMMENT ON COLUMN invoices.ef_invoice_uuid IS
  'UUID interno asignado por eFactura PTY a la factura. Permite recuperar el estado vía polling sin depender del CUFE.';

-- =============================================================================
-- C. fe_emisiones — log de cada intento de emisión electrónica
-- -----------------------------------------------------------------------------
-- Una fila por intento. Permite auditar reintentos, ver request/response
-- exactos enviados al PAC y reconstruir qué pasó en cada iteración.
-- =============================================================================

CREATE TABLE IF NOT EXISTS fe_emisiones (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL DEFAULT public.get_tenant_id()
                              REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id             UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  intento                INT  NOT NULL,
  punto_facturacion      VARCHAR(3) NULL,
  numero_documento       BIGINT NULL,
  request_payload        JSONB NULL,
  response_payload       JSONB NULL,
  cufe                   TEXT NULL,
  protocolo_autorizacion TEXT NULL,
  fecha_autorizacion     TIMESTAMPTZ NULL,
  autorizada             BOOLEAN NULL,
  cod_res                JSONB NULL,
  i_amb                  SMALLINT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by             UUID NULL REFERENCES public.users(id),

  CONSTRAINT fe_emisiones_intento_positive_check CHECK (intento >= 1),
  CONSTRAINT fe_emisiones_i_amb_check
    CHECK (i_amb IS NULL OR i_amb IN (1, 2))
);

CREATE INDEX IF NOT EXISTS idx_fe_emisiones_tenant
  ON fe_emisiones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fe_emisiones_invoice
  ON fe_emisiones(invoice_id, intento);
CREATE INDEX IF NOT EXISTS idx_fe_emisiones_autorizada
  ON fe_emisiones(tenant_id, autorizada)
  WHERE autorizada IS NOT NULL;

ALTER TABLE fe_emisiones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fe_emisiones_tenant_isolation ON fe_emisiones;
CREATE POLICY fe_emisiones_tenant_isolation ON fe_emisiones
  FOR ALL USING (tenant_id = public.get_tenant_id());

COMMENT ON TABLE fe_emisiones IS
  'Log inmutable (insert-only) de intentos de emisión electrónica al PAC. Una fila por intento por factura. Útil para auditoría y debug de fallas de integración.';
COMMENT ON COLUMN fe_emisiones.intento IS
  'Número de intento secuencial para esta factura. 1=primer envío, 2=reintento, etc.';
COMMENT ON COLUMN fe_emisiones.cod_res IS
  'Arreglo de objetos { dCodRes, dMsgRes } retornados por el PAC con códigos de resultado/error.';

-- =============================================================================
-- D. fe_secuencias — contador correlativo por punto de facturación
-- -----------------------------------------------------------------------------
-- Sólo estructura. NO se implementa la lógica de incremento/consumo del
-- número en esta fase — pendiente confirmar con el PAC si un rechazo "quema"
-- el correlativo o se reutiliza.
-- =============================================================================

CREATE TABLE IF NOT EXISTS fe_secuencias (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL DEFAULT public.get_tenant_id()
                         REFERENCES tenants(id) ON DELETE CASCADE,
  punto_facturacion VARCHAR(3) NOT NULL,
  ultimo_numero     BIGINT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fe_secuencias_ultimo_numero_non_negative_check
    CHECK (ultimo_numero >= 0),
  CONSTRAINT fe_secuencias_tenant_punto_unique
    UNIQUE (tenant_id, punto_facturacion)
);

CREATE INDEX IF NOT EXISTS idx_fe_secuencias_tenant
  ON fe_secuencias(tenant_id);

ALTER TABLE fe_secuencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fe_secuencias_tenant_isolation ON fe_secuencias;
CREATE POLICY fe_secuencias_tenant_isolation ON fe_secuencias
  FOR ALL USING (tenant_id = public.get_tenant_id());

-- Trigger updated_at: el contador se modifica vía UPDATE de la fila, así que
-- queremos que el timestamp refleje cada incremento. Sigue el patrón estándar
-- del repo (mismo que invoices, business_expenses).
DROP TRIGGER IF EXISTS trg_fe_secuencias_updated_at ON fe_secuencias;
CREATE TRIGGER trg_fe_secuencias_updated_at
  BEFORE UPDATE ON fe_secuencias
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE fe_secuencias IS
  'Contador correlativo de numero_documento por (tenant, punto_facturacion). La lógica de incremento/consumo queda pendiente — debe confirmarse con el PAC si rechazos queman el número.';

COMMIT;

-- =============================================================================
-- POST-CHECK (verificación visible)
-- =============================================================================

-- 1. Columnas nuevas en clients (esperado: 8)
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema='public' AND table_name='clients'
  AND  column_name IN ('digito_verificador','tipo_receptor_fe',
                       'codigo_ubicacion','corregimiento','distrito','provincia',
                       'id_extranjero','pais_receptor')
ORDER  BY column_name;

-- 2. Columnas nuevas en invoices (esperado: 9)
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema='public' AND table_name='invoices'
  AND  column_name IN ('fe_estado','dgi_protocolo_autorizacion',
                       'i_amb','punto_facturacion','numero_documento','qr_content',
                       'cafe_storage_key','xml_storage_key','ef_invoice_uuid')
ORDER  BY column_name;

-- 3. CHECK constraints agregados (esperado: 3)
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conname IN ('clients_tipo_receptor_fe_check',
                   'invoices_fe_estado_check',
                   'invoices_i_amb_check')
ORDER  BY conname;

-- 4. Tablas nuevas + RLS habilitada (esperado: 2 filas, rls_enabled=true)
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname='public' AND c.relname IN ('fe_emisiones','fe_secuencias')
ORDER  BY c.relname;

-- 5. Política tenant_isolation en cada tabla nueva (esperado: 2 filas)
SELECT schemaname, tablename, policyname
FROM   pg_policies
WHERE  schemaname='public'
  AND  tablename IN ('fe_emisiones','fe_secuencias')
ORDER  BY tablename;

-- 6. Trigger updated_at en fe_secuencias (esperado: 1 fila, tgenabled='O')
SELECT tgname, tgenabled
FROM   pg_trigger
WHERE  tgrelid='public.fe_secuencias'::regclass
  AND  tgname='trg_fe_secuencias_updated_at';

-- 7. Conteos (esperado: 0 en ambas — tablas recién creadas)
SELECT 'fe_emisiones'  AS tbl, COUNT(*) FROM fe_emisiones
UNION ALL
SELECT 'fe_secuencias', COUNT(*) FROM fe_secuencias;

-- =============================================================================
-- ROLLBACK (descomentar si fuera necesario revertir)
-- -----------------------------------------------------------------------------
-- ATENCIÓN: dropea las tablas nuevas (se pierde el log fe_emisiones si ya
-- hay datos) y elimina las columnas agregadas (pierde valores capturados).
-- Antes de revertir, exportar manualmente cualquier dato relevante.
-- =============================================================================
-- BEGIN;
--
-- -- D. fe_secuencias
-- DROP TRIGGER IF EXISTS trg_fe_secuencias_updated_at ON fe_secuencias;
-- DROP TABLE IF EXISTS fe_secuencias CASCADE;
--
-- -- C. fe_emisiones
-- DROP TABLE IF EXISTS fe_emisiones CASCADE;
--
-- -- B. invoices
-- DROP INDEX IF EXISTS idx_invoices_ef_invoice_uuid;
-- DROP INDEX IF EXISTS idx_invoices_fe_estado;
-- ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_i_amb_check;
-- ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_fe_estado_check;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS ef_invoice_uuid;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS xml_storage_key;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS cafe_storage_key;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS qr_content;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS numero_documento;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS punto_facturacion;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS i_amb;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS dgi_protocolo_autorizacion;
-- ALTER TABLE invoices DROP COLUMN IF EXISTS fe_estado;
--
-- -- A. clients
-- ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_tipo_receptor_fe_check;
-- ALTER TABLE clients DROP COLUMN IF EXISTS pais_receptor;
-- ALTER TABLE clients DROP COLUMN IF EXISTS id_extranjero;
-- ALTER TABLE clients DROP COLUMN IF EXISTS provincia;
-- ALTER TABLE clients DROP COLUMN IF EXISTS distrito;
-- ALTER TABLE clients DROP COLUMN IF EXISTS corregimiento;
-- ALTER TABLE clients DROP COLUMN IF EXISTS codigo_ubicacion;
-- ALTER TABLE clients DROP COLUMN IF EXISTS tipo_receptor_fe;
-- ALTER TABLE clients DROP COLUMN IF EXISTS digito_verificador;
--
-- COMMIT;
