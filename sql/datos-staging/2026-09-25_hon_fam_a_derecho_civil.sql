-- ============================================================================
-- SOLO STAGING: HON-FAM → 400004 (Derecho Civil). NO ES UNA MIGRACIÓN.
-- ============================================================================
-- 25/09/2026, pedido de Oliver: que HON-FAM deje de rechazar la emisión en
-- staging. Vive en `sql/datos-staging/` y NO en `sql/pending/` a propósito: no entra
-- a la cola de producción.
--
-- POR QUÉ 400004. La `043` mapeó los cinco HON-* que Josuarth confirmó y dejó
-- HON-FAM y HON-OTROS en `4101` (inactiva) hasta que el bufete decida. El plan
-- vigente NO tiene una cuenta de "Derecho de Familia": sus ingresos son
-- Corporativo, Tributario, Laboral, Civil, Penal, Administrativo, Migratorio y
-- Litigios. El derecho de familia es una rama del derecho privado civil (el
-- Código de la Familia de Panamá se desprendió del Código Civil), así que la
-- más cercana es 400004 Derecho Civil.
--
-- 🔴 EN PRODUCCIÓN NO SE APLICA. Allá la decisión sigue siendo de Josuarth
--    (pregunta en `task_plan.md`). El runbook tiene el SELECT que detecta los
--    servicios que apuntan a cuentas inactivas y el paso para reasignarlos en
--    la ventana. HON-OTROS no se toca: el pedido fue solo HON-FAM.
-- ============================================================================

DO $$
DECLARE v_n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                  WHERE code = '400004' AND active AND account_type = 'income') THEN
    RAISE EXCEPTION 'La cuenta 400004 no existe, no está activa o no es de ingreso. No se aplicó nada.';
  END IF;

  UPDATE public.services_catalog SET revenue_account = '400004'
   WHERE code = 'HON-FAM' AND revenue_account IS DISTINCT FROM '400004';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'HON-FAM → 400004 Derecho Civil · % fila(s) cambiadas', v_n;
END $$;

SELECT code, name, revenue_account FROM public.services_catalog WHERE code IN ('HON-FAM','HON-OTROS') ORDER BY code;
