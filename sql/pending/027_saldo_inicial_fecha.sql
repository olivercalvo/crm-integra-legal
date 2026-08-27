-- =============================================================================
-- FEATURE: fecha del saldo inicial — chart_of_accounts.saldo_inicial_fecha
-- Sprint:  Contabilidad — Fase 1 (Tarea 5)
-- Fecha:   2026-08-27
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- CONTEXTO:
--   Un saldo de apertura sin fecha no dice nada: "191,947.55 por cobrar" es un
--   dato distinto al 1 de enero que al 14 de agosto. Esta migración agrega la
--   fecha y la vuelve obligatoria en cuanto hay un saldo cargado.
--
--   Regla del período fiscal (Rose, RM Consultores): el período va del 1 de
--   enero al 31 de diciembre, y el 1 de enero solo arrancan con saldo las
--   cuentas del estado de situación financiera. Vive en
--   `src/lib/finanzas/contabilidad/periodo-fiscal.ts`.
--
-- ALCANCE — SOLO EL CAMPO. NADA DE LEDGER.
--   El asiento de apertura, los `accounting_periods`, la secuencia de
--   `accounting_sequences`, el `source_type='apertura'` y el Libro Mayor van
--   COMPLETOS a la Fase 2, con el motor de posteo. La Fase 1 existe para que RM
--   valide el plan de cuentas y los reportes; meterle el ledger la vuelve un
--   proyecto de semanas y retrasa esa validación.
--
--   Este campo está diseñado PENSANDO en ese asiento: cuando llegue el motor,
--   las filas con `saldo_inicial <> 0` se agrupan por `saldo_inicial_fecha` y
--   cada grupo se convierte en UN asiento de apertura con esa fecha.
--
-- ⚠️ HALLAZGO — LO QUE HAY CARGADO NO ES UNA APERTURA AL 1 DE ENERO
--   Los saldos actuales suman CERO en total, pero repartidos así:
--
--       cuentas de BALANCE      244,476.91
--       cuentas de RESULTADO   -244,476.91
--       patrimonio                    0.00
--
--   Un asiento de apertura al 1 de enero necesita que el resultado del año
--   anterior YA esté cerrado contra el patrimonio: las cuentas de resultado
--   arrancarían en 0 y las de balance cuadrarían solas. Acá pasa lo contrario —
--   las de resultado traen el movimiento de enero a agosto de 2026 y el
--   patrimonio está en cero.
--
--   O sea: es una FOTO DE MITAD DE AÑO, no una apertura. Está pendiente de
--   confirmación del contador (ver task_plan.md). Por eso esta migración NO
--   prohíbe que una cuenta de resultado tenga saldo: hoy es exactamente lo que
--   hay, y prohibirlo vaciaría el Estado de Resultado que RM tiene que validar.
--
-- BACKFILL:
--   Las 64 cuentas activas con saldo <> 0 quedan con `2026-01-01`, el inicio del
--   período fiscal que indicó Rose. Es la ÚNICA fecha que el cliente especificó
--   — se carga como tal, no como una fecha de corte verificada, y queda sujeta a
--   la consulta de arriba.
--
-- IDEMPOTENCIA:
--   ADD COLUMN IF NOT EXISTS + UPDATE filtrado por NULL + constraint dropeado
--   antes de crearse. Re-ejecutable.
--
-- APLICACIÓN:
--   Staging: `node scripts/apply-staging-sql.mjs` (ya está en BUNDLE_2).
--   Producción: NO. Solo por merge a main.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- PASO A — la columna
-- -----------------------------------------------------------------------------
--   DATE y no TIMESTAMPTZ a propósito: un saldo de apertura es de un DÍA, no de
--   un instante. Con timestamptz, "2026-01-01" en Panamá se guardaría como
--   2026-01-01T05:00:00Z y al leerlo en otro huso podría mostrar el 31/12.
ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS saldo_inicial_fecha date NULL;

COMMENT ON COLUMN public.chart_of_accounts.saldo_inicial_fecha IS
  'Fecha a la que corresponde saldo_inicial (DATE: es de un día, no de un instante). Obligatoria cuando saldo_inicial <> 0. Período fiscal de Integra: 1 de enero a 31 de diciembre (ver src/lib/finanzas/contabilidad/periodo-fiscal.ts). En la Fase 2, las filas con saldo se agrupan por esta fecha y cada grupo genera UN asiento de apertura.';

-- -----------------------------------------------------------------------------
-- PASO B — backfill
-- -----------------------------------------------------------------------------
-- Solo donde hay saldo y todavía no hay fecha. Correrla de nuevo no pisa nada
-- que alguien haya corregido a mano.
UPDATE public.chart_of_accounts
   SET saldo_inicial_fecha = DATE '2026-01-01'
 WHERE saldo_inicial <> 0
   AND saldo_inicial_fecha IS NULL;

-- -----------------------------------------------------------------------------
-- PASO C — si hay saldo, hay fecha
-- -----------------------------------------------------------------------------
-- La regla NO depende de cuál sea la fecha de corte correcta (que es la consulta
-- abierta con el contador): dice solamente que un saldo cargado tiene que
-- declarar a qué día corresponde. Eso es cierto en los dos escenarios.
--
-- Se aplica a TODAS las cuentas, de balance y de resultado. Las de resultado no
-- quedan exentas porque hoy SÍ tienen saldo (la foto de mitad de año) y esconder
-- esa fecha sería perder justamente el dato que hace falta para interpretarlas.
ALTER TABLE public.chart_of_accounts
  DROP CONSTRAINT IF EXISTS coa_saldo_inicial_requiere_fecha;

ALTER TABLE public.chart_of_accounts
  ADD CONSTRAINT coa_saldo_inicial_requiere_fecha CHECK (
    saldo_inicial = 0 OR saldo_inicial_fecha IS NOT NULL
  );

COMMIT;

-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================
DO $$
DECLARE
  v_tenant     uuid := 'a0000000-0000-0000-0000-000000000001';
  v_con_saldo  int;
  v_sin_fecha  int;
  v_en_cero    int;
BEGIN
  SELECT COUNT(*) INTO v_con_saldo FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant AND saldo_inicial <> 0;

  SELECT COUNT(*) INTO v_sin_fecha FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant AND saldo_inicial <> 0 AND saldo_inicial_fecha IS NULL;

  SELECT COUNT(*) INTO v_en_cero FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant AND saldo_inicial = 0 AND saldo_inicial_fecha IS NOT NULL;

  RAISE NOTICE '— POST-CHECK saldo_inicial_fecha —';
  RAISE NOTICE 'cuentas con saldo <> 0 ............ %', v_con_saldo;
  RAISE NOTICE 'de esas, SIN fecha ............... % (esperado 0)', v_sin_fecha;
  RAISE NOTICE 'en cero pero CON fecha ........... % (informativo)', v_en_cero;

  IF v_sin_fecha > 0 THEN
    RAISE EXCEPTION 'ABORT: % cuenta(s) con saldo y sin fecha', v_sin_fecha;
  END IF;
END $$;

-- Foto por naturaleza: deja ver de un vistazo el hallazgo de la cabecera —
-- balance y resultado NO suman cero por separado.
SELECT CASE WHEN account_type IN ('income','cost','expense')
            THEN 'resultado' ELSE 'balance' END AS naturaleza,
       COUNT(*) FILTER (WHERE saldo_inicial <> 0)          AS con_saldo,
       MIN(saldo_inicial_fecha)                            AS fecha_min,
       MAX(saldo_inicial_fecha)                            AS fecha_max,
       ROUND(SUM(saldo_inicial), 2)                        AS suma
FROM   public.chart_of_accounts
WHERE  tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND  active
GROUP  BY 1
ORDER  BY 1;

-- =============================================================================
-- ROLLBACK (descomentar solo si hay que revertir)
-- =============================================================================
-- BEGIN;
-- ALTER TABLE public.chart_of_accounts DROP CONSTRAINT IF EXISTS coa_saldo_inicial_requiere_fecha;
-- ALTER TABLE public.chart_of_accounts DROP COLUMN IF EXISTS saldo_inicial_fecha;
-- COMMIT;
-- =============================================================================
