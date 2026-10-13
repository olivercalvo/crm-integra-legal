-- ============================================================================
-- 095 · Un documento de prueba nunca entra al libro, y no se mezcla con los reales
-- ============================================================================
-- Pedido de Oliver (05/10/2026): las marcas de prueba (094) tienen que dejar
-- fuera de todo a lo marcado ANTES de la ventana. Los reportes filtran por
-- `de_prueba` (código, `documentos-de-prueba.ts`); el LIBRO no filtra: se
-- asegura acá que nunca tenga un asiento de un documento de prueba.
-- Propuesta: docs/finanzas/propuesta-corte-quickbooks.md §9.3, reglas 2 y 1.
--
-- Qué deja:
--   1. journal_entries: rechaza un asiento cuyo documento de origen está marcado
--      de prueba (factura/ND, NC, cobro, gasto de trámite). Un trigger aparte,
--      sin tocar post_journal_entry: el motor no cambia.
--   2. journal_entry_lines: en un asiento manual, de apertura o de cierre, una
--      línea no puede tener como tercero a un cliente de prueba (no hay documento
--      que lo decida). En el asiento de un documento SÍ: FAC-HON-000463 es real y
--      su cliente es 0TEST-FE-002.
--   3. La NC nace de prueba si su factura lo es.
--   4. payment_applications: un cobro y la factura a la que se aplica son los
--      dos de prueba o los dos reales.
--
-- Idempotente. Va al final del Bloque C, después de la 094.
-- 🛡️ Escrita, SIN APLICAR en staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

-- ── 1. El libro no recibe asientos de documentos de prueba ─────────────────
CREATE OR REPLACE FUNCTION public.finanzas_libro_sin_documentos_de_prueba()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref text;
BEGIN
  IF NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT r INTO v_ref FROM (
    SELECT invoice_number AS r FROM public.invoices     WHERE id = NEW.source_id AND de_prueba
    UNION ALL SELECT credit_note_number FROM public.credit_notes WHERE id = NEW.source_id AND de_prueba
    UNION ALL SELECT coalesce(payment_number, id::text) FROM public.payments WHERE id = NEW.source_id AND de_prueba
    UNION ALL SELECT id::text FROM public.expenses WHERE id = NEW.source_id AND de_prueba
  ) d LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'El documento % es de prueba: no se registra en el libro.', v_ref
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_libro_sin_documentos_de_prueba ON public.journal_entries;
CREATE TRIGGER trg_libro_sin_documentos_de_prueba
  BEFORE INSERT ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_libro_sin_documentos_de_prueba();

-- ── 2. Asiento sin documento: sin clientes de prueba como tercero ──────────
CREATE OR REPLACE FUNCTION public.finanzas_linea_sin_cliente_de_prueba()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_num text;
BEGIN
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT c.client_number INTO v_num FROM public.clients c WHERE c.id = NEW.client_id AND c.es_de_prueba;
  IF FOUND AND EXISTS (SELECT 1 FROM public.journal_entries j
                        WHERE j.id = NEW.entry_id AND j.source_type IN ('manual', 'apertura', 'cierre')) THEN
    RAISE EXCEPTION 'El cliente % es de prueba: no va como tercero de un asiento manual.', v_num
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_linea_sin_cliente_de_prueba ON public.journal_entry_lines;
CREATE TRIGGER trg_linea_sin_cliente_de_prueba
  BEFORE INSERT ON public.journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_linea_sin_cliente_de_prueba();

-- ── 3. La NC hereda la marca de su factura (además de la del cliente, 094) ─
CREATE OR REPLACE FUNCTION public.finanzas_nc_hereda_de_prueba()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_num text;
BEGIN
  IF NOT NEW.de_prueba AND NEW.invoice_id IS NOT NULL THEN
    SELECT invoice_number INTO v_num FROM public.invoices WHERE id = NEW.invoice_id AND de_prueba;
    IF FOUND THEN
      NEW.de_prueba := true;
      NEW.de_prueba_motivo := 'Nota de crédito de la factura de prueba ' || v_num;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nc_hereda_de_prueba ON public.credit_notes;
CREATE TRIGGER trg_nc_hereda_de_prueba
  BEFORE INSERT ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_nc_hereda_de_prueba();

-- ── 4. Cobro y factura: los dos de prueba o los dos reales ─────────────────
CREATE OR REPLACE FUNCTION public.finanzas_aplicacion_sin_mezclar_pruebas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fac record;
  v_pago boolean;
BEGIN
  SELECT invoice_number, de_prueba INTO v_fac FROM public.invoices WHERE id = NEW.invoice_id;
  SELECT de_prueba INTO v_pago FROM public.payments WHERE id = NEW.payment_id;
  IF v_fac.de_prueba IS DISTINCT FROM v_pago THEN
    RAISE EXCEPTION 'La factura % es %, y el cobro %: no se aplica uno al otro.',
      v_fac.invoice_number,
      CASE WHEN v_fac.de_prueba THEN 'de prueba' ELSE 'real' END,
      CASE WHEN v_pago THEN 'es de prueba' ELSE 'es real' END
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aplicacion_sin_mezclar_pruebas ON public.payment_applications;
CREATE TRIGGER trg_aplicacion_sin_mezclar_pruebas
  BEFORE INSERT ON public.payment_applications
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_aplicacion_sin_mezclar_pruebas();

-- ── Post-check: ningún asiento de hoy apunta a un documento de prueba ──────
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.journal_entries j
   WHERE EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = j.source_id AND i.de_prueba)
      OR EXISTS (SELECT 1 FROM public.credit_notes n WHERE n.id = j.source_id AND n.de_prueba)
      OR EXISTS (SELECT 1 FROM public.payments p WHERE p.id = j.source_id AND p.de_prueba)
      OR EXISTS (SELECT 1 FROM public.expenses x WHERE x.id = j.source_id AND x.de_prueba);
  IF v_n > 0 THEN
    RAISE EXCEPTION '095: hay % asientos de documentos marcados de prueba. Revisar antes de seguir.', v_n;
  END IF;
  RAISE NOTICE '095 ✅ el libro no recibe documentos de prueba; NC heredan; cobros y facturas no se mezclan';
END $$;

COMMIT;

-- Verificación (BEGIN … ROLLBACK): sql/tests/verificacion-095-documentos-de-prueba-fuera-del-libro.sql
