-- ============================================================================
-- 083 · fe_estado = 'interna': la NC o la ND que se emite SIN enviarse a la DGI
-- ============================================================================
-- Pedido de Oliver (03/10/2026): al emitir una nota de crédito o de débito se
-- elige «Enviar a la DGI» o «Interna (no se envía)». La interna postea en el
-- libro igual que la otra, pero nunca llama al PAC y queda MARCADA.
--
-- Por qué un estado y no seguir en 'no_emitida': 'no_emitida' dice «todavía no
-- se mandó» y el botón «Enviar a la DGI» la ofrece. 'interna' dice «se decidió
-- no mandarla». Son dos hechos distintos y la pantalla los trata distinto.
--
-- Reglas que pone la base (trigger, en invoices y en credit_notes):
--   · Sólo se llega a 'interna' desde 'no_emitida' (nunca desde un envío que
--     ya empezó: 'pending', 'authorized', 'error' o 'canceled').
--   · 'interna' es TERMINAL: de ahí no se sale. Mandarla después a la DGI sería
--     otro documento fiscal sobre algo que el libro ya cerró como interno.
--
-- No toca datos: ningún documento existente pasa a 'interna'.
-- 🛡️ Sólo staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_fe_estado_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_fe_estado_check
  CHECK (fe_estado IN ('no_emitida', 'pending', 'authorized', 'canceled', 'error', 'interna'));

ALTER TABLE public.credit_notes DROP CONSTRAINT IF EXISTS credit_notes_fe_estado_check;
ALTER TABLE public.credit_notes ADD CONSTRAINT credit_notes_fe_estado_check
  CHECK (fe_estado IN ('no_emitida', 'pending', 'authorized', 'canceled', 'error', 'interna'));

CREATE OR REPLACE FUNCTION public.finanzas_fe_estado_interna_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.fe_estado IS NOT DISTINCT FROM OLD.fe_estado THEN
    RETURN NEW;
  END IF;
  IF OLD.fe_estado = 'interna' THEN
    RAISE EXCEPTION 'El documento se emitió como interno: no se envía a la DGI (estado fiscal «interna» → «%»).', NEW.fe_estado;
  END IF;
  IF NEW.fe_estado = 'interna' AND OLD.fe_estado <> 'no_emitida' THEN
    RAISE EXCEPTION 'Sólo un documento que nunca se envió a la DGI puede quedar interno (estado fiscal «%»).', OLD.fe_estado;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fe_estado_interna_guard ON public.invoices;
CREATE TRIGGER trg_fe_estado_interna_guard
  BEFORE UPDATE OF fe_estado ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_fe_estado_interna_guard();

DROP TRIGGER IF EXISTS trg_fe_estado_interna_guard ON public.credit_notes;
CREATE TRIGGER trg_fe_estado_interna_guard
  BEFORE UPDATE OF fe_estado ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_fe_estado_interna_guard();

-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF position('interna' IN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'invoices_fe_estado_check')) = 0
     OR position('interna' IN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'credit_notes_fe_estado_check')) = 0 THEN
    RAISE EXCEPTION '083: falta «interna» en un CHECK de fe_estado';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_fe_estado_interna_guard') <> 2 THEN
    RAISE EXCEPTION '083: falta el trigger de «interna» en invoices o credit_notes';
  END IF;
  RAISE NOTICE '083 ✅ fe_estado «interna» en facturas y notas de crédito, terminal';
END $$;

COMMIT;
