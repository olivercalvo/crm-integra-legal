-- ============================================================================
-- 065 — `fe_anulaciones` TAMBIÉN REGISTRA NOTAS DE CRÉDITO
-- ============================================================================
-- 25/09/2026. Lo encontró la verificación con clics de 9C.
--
-- La matriz ya decidía `anular_en_dgi_y_libro` para una NC autorizada dentro de
-- las 182 h (`decidirAccionSobreNotaDeCredito`), pero NADIE lo ejecutaba: el
-- botón «Reversar» del detalle de la NC llamaba a `reverseCreditNote`, que sólo
-- toca el libro. Una NC autorizada quedaba anulada en nuestros libros y VIVA
-- ante la DGI: el estado que D3 prohíbe para las facturas, porque la reversión
-- del libro es inmutable y no se puede deshacer.
--
-- El orquestador nuevo (`anular-nota-de-credito-ante-dgi.ts`) sigue el orden de
-- la factura: PAC primero, `fe_estado = 'canceled'` antes del libro, libro
-- después. Y necesita dónde guardar cada intento, igual que la factura.
--
-- ARCO EXCLUSIVO, NO UNA TABLA NUEVA. Mismo patrón y misma razón que la `062`
-- en `fe_emisiones`: el historial de lo que se le pidió al PAC es uno solo. Una
-- fila, un documento: `num_nonnulls(invoice_id, credit_note_id) = 1`.
--
-- 📋 Verificado contra information_schema / pg_constraint el 25/09/2026 en
--    staging: `fe_anulaciones.invoice_id` es uuid NOT NULL con FK ON DELETE
--    CASCADE; no existe `credit_note_id`; UNIQUE (invoice_id, intento).
--
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS, DROP NOT NULL (idempotente),
--               DROP/ADD CONSTRAINT con nombre fijo, CREATE UNIQUE INDEX IF NOT EXISTS.
-- Reversible: sólo mientras no haya filas de NC (el NOT NULL no vuelve con ellas).
-- 🛑 SOLO STAGING. Depende de la `059` (crea la tabla).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.fe_anulaciones') IS NULL THEN
    RAISE EXCEPTION '065: no existe public.fe_anulaciones. Aplicar primero la 059.';
  END IF;
END $$;

ALTER TABLE public.fe_anulaciones
  ADD COLUMN IF NOT EXISTS credit_note_id uuid REFERENCES public.credit_notes(id) ON DELETE CASCADE;

-- `invoice_id` deja de ser obligatorio, pero NO queda libre: el CHECK exige
-- exactamente uno de los dos.
ALTER TABLE public.fe_anulaciones ALTER COLUMN invoice_id DROP NOT NULL;

ALTER TABLE public.fe_anulaciones DROP CONSTRAINT IF EXISTS fe_anulaciones_un_solo_documento_check;
ALTER TABLE public.fe_anulaciones
  ADD CONSTRAINT fe_anulaciones_un_solo_documento_check
  CHECK (num_nonnulls(invoice_id, credit_note_id) = 1);

-- El correlativo de intentos es por documento, como el de la factura.
CREATE UNIQUE INDEX IF NOT EXISTS fe_anulaciones_un_intento_por_nc
  ON public.fe_anulaciones (credit_note_id, intento)
  WHERE credit_note_id IS NOT NULL;

COMMENT ON COLUMN public.fe_anulaciones.credit_note_id IS
  'La nota de crédito de este pedido de anulación. Arco exclusivo con invoice_id '
  '(CHECK fe_anulaciones_un_solo_documento_check). Existe desde la 065 porque una '
  'NC autorizada se anula ante la DGI por el mismo endpoint que una factura.';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
DO $$
DECLARE v_n int; v_huerfanas int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='fe_anulaciones' AND column_name='credit_note_id'
  ) THEN
    RAISE EXCEPTION '065: falta fe_anulaciones.credit_note_id';
  END IF;

  SELECT count(*) INTO v_huerfanas FROM public.fe_anulaciones
   WHERE num_nonnulls(invoice_id, credit_note_id) <> 1;
  IF v_huerfanas > 0 THEN
    RAISE EXCEPTION '065: % fila(s) de fe_anulaciones no cumplen el arco exclusivo', v_huerfanas;
  END IF;

  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid='public.fe_anulaciones'::regclass
     AND conname='fe_anulaciones_un_solo_documento_check';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '065: falta el CHECK del arco exclusivo';
  END IF;

  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE tablename='fe_anulaciones' AND indexname='fe_anulaciones_un_intento_por_nc';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '065: falta el índice único de intentos por NC';
  END IF;

  SELECT count(*) INTO v_n FROM public.fe_anulaciones;
  RAISE NOTICE '065 ✅ fe_anulaciones.credit_note_id + arco exclusivo · % fila(s) existentes intactas', v_n;
END $$;
