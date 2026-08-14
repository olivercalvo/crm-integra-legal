-- =============================================================================
-- FEATURE: chart_of_accounts + saldo_inicial y subcategoria — Paso 1a plan contable
-- Sprint:  Contabilidad — Paso 1 (Josuar), ver docs/finanzas/roadmap-contable.md §10
-- Fecha:   2026-08-14
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- CONTEXTO:
--   Josuar (contador) bajó el requerimiento contable a 5 pasos. El Paso 1 pide
--   que el plan de cuentas soporte:
--
--     1. SALDO INICIAL por cuenta (monto de apertura). Su xlsx de 62 cuentas
--        trae los saldos reales de apertura y quiere cargarlos con la cuenta.
--
--     2. SUBCATEGORÍA para agrupar los reportes:
--        - Balance General → agrupa activos/pasivos por corriente vs no corriente
--          y separa propiedad, planta y equipo.
--        - Estado de Resultado → separa COSTOS (5xxxxx) de GASTOS OPERATIVOS
--          (6xxxxx), que hoy comparten account_type='expense'.
--
-- DECISIÓN DE DISEÑO (puente deliberado, documentada en el roadmap §10):
--   saldo_inicial vive como COLUMNA en chart_of_accounts porque calza con el
--   modelo mental de Josuar y con la carga masiva por Excel. Cuando exista el
--   motor de posteo del ledger (Paso 3), ese saldo se convierte en un ASIENTO
--   DE APERTURA (source_type='manual') y los reportes pasan a leer del ledger
--   en lugar de esta columna. La columna no se borra en ese momento sin migrar
--   los saldos al asiento primero.
--
--   subcategoria es TEXT NULL SIN CHECK constraint, a propósito:
--     - Los valores válidos se validan en la capa de aplicación
--       (src/lib/finanzas/types/chart-of-account.ts → SUBCATEGORIAS).
--     - El Paso 1b (carga masiva por Excel de las 62 cuentas de Josuar) puede
--       necesitar agregar valores; un CHECK obligaría a una migración por cada
--       ajuste de vocabulario en plena ventana de deadline.
--   Valores que la app acepta hoy (snake_case):
--     activo_corriente, activo_no_corriente, propiedad_planta_equipo,
--     pasivo_corriente, pasivo_no_corriente, patrimonio,
--     ingreso, costo, gasto_operativo, otro
--
-- LO QUE ESTA MIGRACIÓN NO TOCA:
--   - El CHECK de account_type sigue con sus 5 valores en inglés
--     (asset/liability/equity/income/expense). La distinción costos vs gastos
--     se resuelve con subcategoria ('costo' vs 'gasto_operativo'), NO abriendo
--     el CHECK.
--   - is_system, el código de cuenta (inmutable), y las 34 cuentas sembradas
--     quedan exactamente como están. Las cuentas existentes arrancan con
--     saldo_inicial=0 (por el DEFAULT) y subcategoria=NULL.
--
-- IDEMPOTENCIA:
--   ADD COLUMN IF NOT EXISTS en ambas columnas → re-ejecutable sin error.
--
-- APLICACIÓN:
--   Ejecutar manualmente en el SQL Editor de Supabase (dashboard del cliente).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- PASO A — Columnas nuevas (aditivo, idempotente)
-- -----------------------------------------------------------------------------
--   saldo_inicial numeric(14,2) NOT NULL DEFAULT 0
--     · numeric (no float) porque es dinero: sin error de redondeo binario.
--     · NOT NULL DEFAULT 0 → las 34 cuentas existentes quedan en 0 y el código
--       nunca tiene que manejar NULL vs 0 al sumar reportes.
--     · PERMITE NEGATIVOS a propósito: una cuenta de patrimonio con pérdida
--       acumulada, o una contra-cuenta (depreciación acumulada), abre negativa.
--   subcategoria text NULL
--     · NULL = sin clasificar (las 34 cuentas viejas de QB, que se desactivan
--       aparte cuando entren las 62 de Josuar).
ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS saldo_inicial numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subcategoria  text NULL;

-- -----------------------------------------------------------------------------
-- PASO B — COMMENT ON COLUMN (documentación viva en el schema)
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN public.chart_of_accounts.saldo_inicial IS
  'Saldo de apertura de la cuenta (moneda del tenant, B/.). Puente transitorio: cuando el motor de posteo del ledger esté listo (Paso 3 del plan contable), este saldo se convierte en un asiento de apertura source_type=''manual'' y los reportes leen del ledger. Admite negativos (patrimonio con pérdida acumulada, contra-cuentas).';

COMMENT ON COLUMN public.chart_of_accounts.subcategoria IS
  'Agrupador de reportes, snake_case, validado en la capa de app (SUBCATEGORIAS en src/lib/finanzas/types/chart-of-account.ts): activo_corriente, activo_no_corriente, propiedad_planta_equipo, pasivo_corriente, pasivo_no_corriente, patrimonio, ingreso, costo, gasto_operativo, otro. Separa COSTOS de GASTOS OPERATIVOS dentro de account_type=''expense'' para el Estado de Resultado, y agrupa el Balance General. NULL = sin clasificar. Sin CHECK a propósito: el vocabulario puede crecer con la carga masiva por Excel.';

COMMIT;

-- =============================================================================
-- VERIFICACIÓN — ambas columnas existen con el tipo y default esperados
-- =============================================================================
DO $$
DECLARE
  v_cols INT;
BEGIN
  SELECT COUNT(*) INTO v_cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'chart_of_accounts'
      AND column_name IN ('saldo_inicial', 'subcategoria');

  RAISE NOTICE '— POST-CHECK —';
  RAISE NOTICE 'Columnas nuevas presentes: % (esperado 2)', v_cols;

  IF v_cols <> 2 THEN
    RAISE EXCEPTION 'ABORT: se esperaban las 2 columnas (saldo_inicial, subcategoria) y hay %', v_cols;
  END IF;
END $$;

-- 1) Ambas columnas existen, con tipo / nullability / default
SELECT column_name,
       data_type,
       numeric_precision,
       numeric_scale,
       is_nullable,
       column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'chart_of_accounts'
  AND  column_name IN ('saldo_inicial', 'subcategoria')
ORDER  BY column_name;
-- Esperado:
--   saldo_inicial | numeric | 14 | 2 | NO  | 0
--   subcategoria  | text    |    |   | YES | (null)

-- 2) Las 34 cuentas existentes quedaron en saldo_inicial=0 / subcategoria=NULL
SELECT COUNT(*)                                        AS cuentas_total,
       COUNT(*) FILTER (WHERE saldo_inicial = 0)        AS en_cero,
       COUNT(*) FILTER (WHERE subcategoria IS NULL)     AS sin_subcategoria
FROM   public.chart_of_accounts
WHERE  tenant_id = 'a0000000-0000-0000-0000-000000000001';
-- Esperado: 34 | 34 | 34

-- =============================================================================
-- ROLLBACK (descomentar solo si hay que revertir)
-- -----------------------------------------------------------------------------
-- ATENCIÓN: dropear saldo_inicial BORRA los saldos de apertura cargados. Si ya
-- se corrió la carga masiva de las 62 cuentas de Josuar, exportar primero:
--   SELECT code, name, saldo_inicial, subcategoria FROM chart_of_accounts
--   WHERE tenant_id='a0000000-0000-0000-0000-000000000001';
-- =============================================================================
-- BEGIN;
-- ALTER TABLE public.chart_of_accounts DROP COLUMN IF EXISTS subcategoria;
-- ALTER TABLE public.chart_of_accounts DROP COLUMN IF EXISTS saldo_inicial;
-- COMMIT;
-- =============================================================================
