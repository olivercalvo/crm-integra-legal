-- ============================================================================
-- 078 — Parámetros contables del bufete: la tasa de ISR (Bloque 1, E10)
-- ============================================================================
-- Decisión de Josuarth del 30/09/2026 (§7 del plan, decisión b): el Estado de
-- Resultado lleva SIEMPRE la línea de impuesto sobre la renta, con una tasa
-- CONFIGURABLE por bufete, en 0 % para Integra (sociedad civil).
--
-- Hasta hoy la tasa vivía en código (`DEFAULT_ISR_RATE = 0`). Pasa a ser un dato
-- del bufete:
--
--   finanzas_parametros (tenant_id PK, isr_rate fracción 0..1)
--
-- · Una fila por bufete. Si un bufete no tiene fila, el reporte usa 0 (el
--   default de siempre); la migración igual crea la fila de cada bufete.
-- · 🔴 Se guarda la FRACCIÓN (0.25) y la pantalla pide el PORCENTAJE, con las
--   dos a la vista, como las tasas de impuesto (SOP-037): "25" donde va 0.25
--   daría 2500 %, y el CHECK lo rechaza.
-- · Leen admin, abogada y contador; escriben admin y contador (mismo criterio
--   que las tasas de impuesto: la abogada lee el catálogo, no lo modifica).
-- · NO toca el libro. Es un cálculo del reporte, no un asiento: si algún día el
--   ISR se registra en el libro, es otro bloque (P-7a).
--
-- Idempotente. No depende de otras migraciones del Bloque 1.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.finanzas_parametros (
  tenant_id   uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  isr_rate    numeric(5,4) NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid NULL REFERENCES public.users(id),
  CONSTRAINT finanzas_parametros_isr_rango CHECK (isr_rate >= 0 AND isr_rate <= 1)
);

COMMENT ON TABLE public.finanzas_parametros IS
  'Parámetros contables por bufete (078). isr_rate: tasa de impuesto sobre la renta del Estado de Resultado, como FRACCIÓN (0.25 = 25 %). 0 para una sociedad civil.';

ALTER TABLE public.finanzas_parametros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finanzas_parametros_select ON public.finanzas_parametros;
CREATE POLICY finanzas_parametros_select ON public.finanzas_parametros
  FOR SELECT
  USING (tenant_id = public.get_tenant_id());

DROP POLICY IF EXISTS finanzas_parametros_insert ON public.finanzas_parametros;
CREATE POLICY finanzas_parametros_insert ON public.finanzas_parametros
  FOR INSERT
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  );

DROP POLICY IF EXISTS finanzas_parametros_update ON public.finanzas_parametros;
CREATE POLICY finanzas_parametros_update ON public.finanzas_parametros
  FOR UPDATE
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('admin', 'contador')
  );

-- Sin política de DELETE: un bufete sin fila vuelve al 0 de siempre, y borrarla
-- en silencio cambiaría el reporte sin dejar rastro.

-- Una fila por bufete, en 0.
INSERT INTO public.finanzas_parametros (tenant_id, isr_rate)
SELECT tn.id, 0 FROM public.tenants tn
ON CONFLICT (tenant_id) DO NOTHING;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_sin_fila int;
BEGIN
  SELECT count(*) INTO v_sin_fila
    FROM public.tenants tn
   WHERE NOT EXISTS (SELECT 1 FROM public.finanzas_parametros fp WHERE fp.tenant_id = tn.id);
  IF v_sin_fila > 0 THEN
    RAISE EXCEPTION '078: % bufete(s) sin fila de parámetros', v_sin_fila;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finanzas_parametros_isr_rango') THEN
    RAISE EXCEPTION '078: falta el CHECK del rango de la tasa';
  END IF;
  RAISE NOTICE '078 ✅ finanzas_parametros lista (isr_rate en fracción, 0 por defecto)';
END $$;

COMMIT;
