-- =============================================================================
-- FEATURE: cuenta 300004 Distribución a Socias — sociedad civil
-- Sprint:  Contabilidad — Fase 1 (Tarea 4)
-- Fecha:   2026-08-27
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- CONTEXTO:
--   Integra es una SOCIEDAD CIVIL: no paga impuesto sobre la renta a nivel de
--   empresa. Reparte el resultado a las socias y cada una paga su renta personal
--   al 15%. Por eso el Estado de Resultado cierra el ejercicio en CERO, con una
--   sección de distribución al final.
--
--   Esta cuenta es el destino contable de ese reparto.
--
-- ⚠️ PROVISIONAL — el código puede cambiar.
--   Oliver se lo confirma a Josuar por correo. Puede que ademas quiera una
--   cuenta de PASIVO ("Por pagar a socias") para cuando la distribución no se
--   paga de inmediato: una cosa es asignar el resultado y otra es deberlo.
--
--   Por eso el codigo NO esta hardcodeado del lado de la app: vive en
--   `CUENTA_DISTRIBUCION_SOCIAS` (src/lib/finanzas/reports/estado-resultado-niif18.ts)
--   y es un parametro de `buildEstadoResultadoNiif18()`. Si Josuar pide otro
--   codigo, se cambia ahi y se agrega la cuenta nueva — sin perseguir literales.
--
-- POR QUÉ NACE EN CERO Y SE QUEDA EN CERO (por ahora):
--   El renglón de distribución del reporte es CALCULADO (= la utilidad neta, con
--   signo opuesto), no se lee de esta cuenta. Es el mismo patrón que
--   `300003 Utilidad del Ejercicio` en el Balance General, con el mismo riesgo
--   documentado: si alguien le carga un saldo a mano, se contaría dos veces.
--   Cuando exista el cierre de ejercicio con asientos (Fase 2), el resultado se
--   posteara aca y el renglón calculado desaparece.
--
-- IDEMPOTENCIA:
--   INSERT ... WHERE NOT EXISTS. Re-ejecutable sin error.
--
-- APLICACIÓN:
--   Staging: `node scripts/apply-staging-sql.mjs` (ya está en BUNDLE_2).
--   Producción: NO. Solo por merge a main.
-- =============================================================================

BEGIN;

INSERT INTO public.chart_of_accounts
  (tenant_id, code, name, account_type, subcategoria, saldo_inicial, active, is_trust_pass_through)
SELECT 'a0000000-0000-0000-0000-000000000001',
       '300004',
       'Distribución a Socias',
       'equity',
       'patrimonio',
       0,
       true,
       false
 WHERE NOT EXISTS (
   SELECT 1 FROM public.chart_of_accounts
    WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
      AND code      = '300004'
 );

COMMIT;

-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n
    FROM public.chart_of_accounts
   WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'
     AND code      = '300004'
     AND account_type = 'equity'
     AND active;

  RAISE NOTICE '— POST-CHECK — 300004 Distribución a Socias: % (esperado 1)', v_n;

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: se esperaba 1 cuenta 300004 activa de patrimonio y hay %', v_n;
  END IF;
END $$;

SELECT code, name, account_type, subcategoria, saldo_inicial, active
FROM   public.chart_of_accounts
WHERE  tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND  account_type = 'equity'
ORDER  BY code;

-- =============================================================================
-- ROLLBACK (descomentar solo si hay que revertir)
-- -----------------------------------------------------------------------------
-- Seguro mientras la cuenta siga en 0 y sin asientos. Si ya tiene movimientos,
-- NO borrarla: desactivarla, y aun eso lo bloquea updateChartAccount.
-- =============================================================================
-- DELETE FROM public.chart_of_accounts
--  WHERE tenant_id='a0000000-0000-0000-0000-000000000001' AND code='300004';
-- =============================================================================
