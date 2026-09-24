-- ============================================================================
-- 062 — `fe_emisiones` TAMBIÉN REGISTRA NOTAS DE CRÉDITO
-- ============================================================================
-- Bloque 9C (24/09/2026). Hasta hoy `fe_emisiones` era el historial de envíos
-- de FACTURAS: `invoice_id` NOT NULL con FK. La nota de crédito se manda por el
-- MISMO endpoint (`POST /api/v1/Invoices`, con `tipoDocumento = 04`) y necesita
-- exactamente el mismo registro: qué payload salió, qué contestó el PAC, en qué
-- intento, contra qué ambiente.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ARCO EXCLUSIVO, NO UNA TABLA NUEVA — y no es una preferencia estética
-- ─────────────────────────────────────────────────────────────────────────────
-- Es el mismo patrón que `supplier_payments` con `expense_id` /
-- `business_expense_id` (migración `049`), y por la misma razón: **la alerta de
-- rechazo se lee de `fe_emisiones`**. Esa alerta existe porque un rechazo no se
-- puede borrar editando el documento (SOP-041), y hay tres tests que lo
-- sostienen. Una segunda tabla `fe_emisiones_nc` obligaría a que
-- `ultimoEnvioFallido` y `contarFacturasConErrorDgi` consultaran las dos y las
-- mezclaran — o, mucho más probable, a que alguien agregue la NC a una sola y
-- la alerta quede a medias sin que ningún test lo note.
--
-- Una fila, un documento: `num_nonnulls(invoice_id, credit_note_id) = 1`.
--
-- 📋 Verificado contra information_schema / pg_constraint el 24/09/2026:
--    `fe_emisiones.invoice_id` es uuid NOT NULL con FK ON DELETE CASCADE a
--    `invoices`; no existe ninguna columna `credit_note_id`; los CHECK actuales
--    son `i_amb` y `intento >= 1`.
--
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS, ALTER COLUMN DROP NOT NULL (idempotente),
--               DROP/ADD CONSTRAINT con nombre fijo.
-- 🛑 SOLO STAGING.
-- ============================================================================

BEGIN;

ALTER TABLE public.fe_emisiones
  ADD COLUMN IF NOT EXISTS credit_note_id uuid REFERENCES public.credit_notes(id) ON DELETE CASCADE;

-- `invoice_id` deja de ser obligatorio, pero NO queda libre: el CHECK de abajo
-- exige que haya exactamente uno de los dos. Aflojar el NOT NULL sin el CHECK
-- dejaría lugar a una fila que no es de ningún documento.
ALTER TABLE public.fe_emisiones ALTER COLUMN invoice_id DROP NOT NULL;

ALTER TABLE public.fe_emisiones DROP CONSTRAINT IF EXISTS fe_emisiones_un_solo_documento_check;
ALTER TABLE public.fe_emisiones
  ADD CONSTRAINT fe_emisiones_un_solo_documento_check
  CHECK (num_nonnulls(invoice_id, credit_note_id) = 1);

CREATE INDEX IF NOT EXISTS idx_fe_emisiones_credit_note
  ON public.fe_emisiones (tenant_id, credit_note_id, intento DESC)
  WHERE credit_note_id IS NOT NULL;

COMMENT ON COLUMN public.fe_emisiones.credit_note_id IS
  'La nota de crédito de este envío. Arco exclusivo con invoice_id: cada fila es de UN documento (CHECK fe_emisiones_un_solo_documento_check). Existe para que la alerta de rechazo se lea de una sola tabla.';

-- ----------------------------------------------------------------------------
-- Verificación
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_n int; v_huerfanas int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='fe_emisiones' AND column_name='credit_note_id'
  ) THEN
    RAISE EXCEPTION '062: falta fe_emisiones.credit_note_id';
  END IF;

  -- Ninguna fila existente puede haber quedado fuera del arco.
  SELECT count(*) INTO v_huerfanas FROM public.fe_emisiones
   WHERE num_nonnulls(invoice_id, credit_note_id) <> 1;
  IF v_huerfanas > 0 THEN
    RAISE EXCEPTION '062: % fila(s) de fe_emisiones no cumplen el arco exclusivo', v_huerfanas;
  END IF;

  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid='public.fe_emisiones'::regclass
     AND conname='fe_emisiones_un_solo_documento_check';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '062: falta el CHECK del arco exclusivo';
  END IF;

  SELECT count(*) INTO v_n FROM public.fe_emisiones;
  RAISE NOTICE '062 ✅ fe_emisiones.credit_note_id + arco exclusivo · % fila(s) existentes intactas', v_n;
END $$;

COMMIT;
