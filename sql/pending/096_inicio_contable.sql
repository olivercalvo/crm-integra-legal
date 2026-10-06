-- ============================================================================
-- 096 · Inicio contable: lo anterior está «contabilizado fuera»
-- ============================================================================
-- Pedido de Oliver (06/10/2026). Fecha B de la propuesta del corte con
-- QuickBooks (docs/finanzas/propuesta-corte-quickbooks.md §1): desde el inicio
-- contable cada documento del CRM genera su asiento; lo anterior ya está en los
-- libros del contador (QuickBooks o los registros de las licenciadas) y el CRM
-- NO lo vuelve a contabilizar. El documento sigue existiendo y sigue contando
-- en la antigüedad, el estado de cuenta y los listados, con la etiqueta
-- «Contabilizado fuera».
--
-- 🔴 Se compara la FECHA DEL DOCUMENTO, no la de registro ni el punto de
--    facturación (pedido explícito; la propuesta decía «registro», §8.5):
--      factura / ND ...... invoices.issue_date
--      NC de venta ....... credit_notes.issue_date
--      cobro ............. payments.payment_date
--      compra ............ business_expenses.expense_date
--      gasto de trámite .. expenses.date
--      pago a proveedor .. supplier_payments.payment_date
--      NC de compra ...... supplier_credit_notes.supplier_document_date (o issue_date)
--    Cada documento por SU fecha: un cobro de agosto aplicado a una factura de
--    junio SÍ postea (acredita el 100004 del cliente, que viene del saldo
--    inicial). Una anulación de una factura de junio no postea nada: no hay
--    asiento que reversar (cancel_invoice_with_reversal ya lo maneja).
--
-- Qué deja:
--   1. finanzas_parametros.fecha_inicio_contable (date, NOT NULL, 01/07/2026).
--      La bitácora contable ya captura la tabla (087): cada cambio queda ahí.
--   2. finanzas_inicio_contable(tenant): la fecha, con el default si no hay fila.
--   3. finanzas_documento_de_origen(source_type, source_id): número y fecha del
--      documento de un asiento. UNA definición para el trigger y el guard.
--   4. journal_entries: rechaza el asiento de un documento anterior al inicio.
--      Trigger aparte, como el de la 095: el motor no cambia. Así también la
--      factura externa (092) y la NC de compra (082), que postean dentro de su
--      RPC, se rechazan enteras sin quemar número.
--   5. finanzas_parametros: el inicio NO cambia si deja documentos del lado
--      equivocado. Mover la fecha HACIA ADELANTE choca con documentos del tramo
--      que ya tienen asiento (el libro tendría algo que «está fuera»); moverla
--      HACIA ATRÁS choca con documentos del tramo sin asiento (quedarían dentro
--      sin asiento, y no hay cómo postearlos con su fecha vieja). El mensaje
--      nombra los primeros diez.
--   6. Pre-flight: los asientos que YA existen de documentos anteriores al
--      01/07/2026. En producción el libro está vacío: tiene que dar 0. En
--      staging hay (datos de antes del corte): la migración aborta salvo que la
--      sesión traiga la llave `finanzas.inicio_contable_existentes = 'aceptar'`,
--      y entonces los lista en NOTICE y sigue (el libro no se toca).
--
-- No toca: el motor (post_journal_entry), los RPC de reversión, FAC-EXT, ni la
-- marca de prueba (094/095): un documento de prueba sigue sin asiento aunque
-- sea posterior al inicio, por su propio trigger.
--
-- Idempotente. Va al final del Bloque C, después de la 095.
-- 🛡️ Escrita, SIN APLICAR en staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

-- ── 1. El parámetro ─────────────────────────────────────────────────────────
ALTER TABLE public.finanzas_parametros
  ADD COLUMN IF NOT EXISTS fecha_inicio_contable date NOT NULL DEFAULT DATE '2026-07-01';

COMMENT ON COLUMN public.finanzas_parametros.fecha_inicio_contable IS
  'Inicio contable (096). Los documentos con fecha anterior están contabilizados fuera del CRM (QuickBooks): no generan asiento. Cambia sólo si no deja documentos del lado equivocado (trigger).';

INSERT INTO public.finanzas_parametros (tenant_id)
SELECT tn.id FROM public.tenants tn
ON CONFLICT (tenant_id) DO NOTHING;

-- ── 2. La fecha del bufete ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finanzas_inicio_contable(p_tenant_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT fp.fecha_inicio_contable FROM public.finanzas_parametros fp WHERE fp.tenant_id = p_tenant_id),
    DATE '2026-07-01'
  );
$$;

-- ── 3. El documento de un asiento: número y fecha ───────────────────────────
CREATE OR REPLACE FUNCTION public.finanzas_documento_de_origen(p_source_type text, p_source_id uuid)
RETURNS TABLE (numero text, fecha date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(i.invoice_number, 'factura sin número'), i.issue_date
    FROM public.invoices i WHERE p_source_type = 'factura' AND i.id = p_source_id
  UNION ALL
  SELECT coalesce(n.credit_note_number, 'nota de crédito sin número'), n.issue_date
    FROM public.credit_notes n WHERE p_source_type = 'nota_credito' AND n.id = p_source_id
  UNION ALL
  SELECT coalesce(p.payment_number, 'cobro sin número'), p.payment_date
    FROM public.payments p WHERE p_source_type = 'pago' AND p.id = p_source_id
  UNION ALL
  SELECT coalesce(b.purchase_number, b.description, 'compra'), b.expense_date
    FROM public.business_expenses b WHERE p_source_type = 'gasto' AND b.id = p_source_id
  UNION ALL
  SELECT coalesce(x.purchase_number, x.concept, 'gasto de trámite'), x.date
    FROM public.expenses x WHERE p_source_type = 'gasto_tramite' AND x.id = p_source_id
  UNION ALL
  SELECT coalesce(s.payment_number, 'pago a proveedor'), s.payment_date
    FROM public.supplier_payments s WHERE p_source_type = 'pago_proveedor' AND s.id = p_source_id
  UNION ALL
  SELECT coalesce(c.credit_note_number, 'nota de crédito de compra'), coalesce(c.supplier_document_date, c.issue_date)
    FROM public.supplier_credit_notes c WHERE p_source_type = 'nota_credito_proveedor' AND c.id = p_source_id;
$$;

-- ── 4. El libro no recibe documentos anteriores al inicio ──────────────────
CREATE OR REPLACE FUNCTION public.finanzas_libro_desde_el_inicio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc    record;
  v_inicio date;
BEGIN
  IF NEW.source_id IS NULL OR NEW.source_type NOT IN
     ('factura', 'nota_credito', 'pago', 'gasto', 'gasto_tramite', 'pago_proveedor', 'nota_credito_proveedor') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_doc FROM public.finanzas_documento_de_origen(NEW.source_type, NEW.source_id) LIMIT 1;
  IF NOT FOUND OR v_doc.fecha IS NULL THEN
    RETURN NEW;
  END IF;
  v_inicio := public.finanzas_inicio_contable(NEW.tenant_id);
  IF v_doc.fecha < v_inicio THEN
    RAISE EXCEPTION 'El documento % es del %, anterior al inicio contable (%): está contabilizado fuera y no genera asiento.',
      v_doc.numero, to_char(v_doc.fecha, 'DD/MM/YYYY'), to_char(v_inicio, 'DD/MM/YYYY')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_libro_desde_el_inicio ON public.journal_entries;
CREATE TRIGGER trg_libro_desde_el_inicio
  BEFORE INSERT ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_libro_desde_el_inicio();

-- ── 5. Mover el inicio: qué quedaría del lado equivocado ───────────────────
-- Devuelve los documentos que cruzan el corte al pasar de p_desde a p_hasta.
--   · Hacia adelante (p_hasta > p_desde): documentos del tramo [desde, hasta)
--     CON asiento propio.
--   · Hacia atrás (p_hasta < p_desde): documentos del tramo [hasta, desde) SIN
--     asiento que lo tendrían si fueran posteriores al inicio: facturas y ND
--     emitidas, NC con asiento propio esperado (no las de una anulación),
--     cobros, compras, gastos de trámite, pagos (no los saldos heredados) y NC
--     de compra. Los documentos de prueba no cuentan: nunca tienen asiento.
CREATE OR REPLACE FUNCTION public.finanzas_cruces_del_inicio(p_tenant_id uuid, p_desde date, p_hasta date)
RETURNS TABLE (tipo text, numero text, fecha date, motivo text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH docs AS (
    SELECT 'factura'::text AS st, 'factura'::text AS tipo, i.id, coalesce(i.invoice_number, '(sin número)') AS numero, i.issue_date AS fecha,
           (i.status NOT IN ('borrador', 'cancelada_pre_emision') AND NOT i.de_prueba) AS deberia
      FROM public.invoices i WHERE i.tenant_id = p_tenant_id
    UNION ALL
    SELECT 'nota_credito', 'nota de crédito', n.id, coalesce(n.credit_note_number, '(sin número)'), n.issue_date,
           (NOT n.de_prueba AND NOT EXISTS (SELECT 1 FROM public.invoices fi WHERE fi.id = n.invoice_id AND fi.status = 'anulada'))
      FROM public.credit_notes n WHERE n.tenant_id = p_tenant_id
    UNION ALL
    SELECT 'pago', 'cobro', p.id, coalesce(p.payment_number, '(sin número)'), p.payment_date, NOT p.de_prueba
      FROM public.payments p WHERE p.tenant_id = p_tenant_id
    UNION ALL
    SELECT 'gasto', 'compra', b.id, coalesce(b.purchase_number, b.description, '(compra)'), b.expense_date, true
      FROM public.business_expenses b WHERE b.tenant_id = p_tenant_id
    UNION ALL
    SELECT 'gasto_tramite', 'gasto de trámite', x.id, coalesce(x.purchase_number, x.concept, '(gasto)'), x.date, NOT x.de_prueba
      FROM public.expenses x WHERE x.tenant_id = p_tenant_id
    UNION ALL
    SELECT 'pago_proveedor', 'pago a proveedor', s.id, coalesce(s.payment_number, '(sin número)'), s.payment_date, s.kind = 'payment'
      FROM public.supplier_payments s WHERE s.tenant_id = p_tenant_id
    UNION ALL
    SELECT 'nota_credito_proveedor', 'nota de crédito de compra', c.id, coalesce(c.credit_note_number, '(sin número)'),
           coalesce(c.supplier_document_date, c.issue_date), true
      FROM public.supplier_credit_notes c WHERE c.tenant_id = p_tenant_id
  ), con_asiento AS (
    SELECT d.*, je.entry_number
      FROM docs d
      LEFT JOIN LATERAL (
        SELECT j.entry_number FROM public.journal_entries j
         WHERE j.tenant_id = p_tenant_id AND j.source_type = d.st AND j.source_id = d.id
         ORDER BY j.entry_number LIMIT 1
      ) je ON true
  )
  SELECT ca.tipo, ca.numero, ca.fecha,
         'tiene el asiento ' || ca.entry_number || ' y quedaría antes del inicio'
    FROM con_asiento ca
   WHERE p_hasta > p_desde AND ca.fecha >= p_desde AND ca.fecha < p_hasta AND ca.entry_number IS NOT NULL
  UNION ALL
  SELECT ca.tipo, ca.numero, ca.fecha,
         'no tiene asiento y quedaría después del inicio'
    FROM con_asiento ca
   WHERE p_hasta < p_desde AND ca.fecha >= p_hasta AND ca.fecha < p_desde AND ca.entry_number IS NULL AND ca.deberia
  ORDER BY 3, 1, 2;
$$;

CREATE OR REPLACE FUNCTION public.finanzas_inicio_contable_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_desde date;
  v_total int;
  v_lista text;
BEGIN
  v_desde := CASE WHEN TG_OP = 'UPDATE' THEN OLD.fecha_inicio_contable ELSE DATE '2026-07-01' END;
  IF NEW.fecha_inicio_contable IS NOT DISTINCT FROM v_desde THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_total FROM public.finanzas_cruces_del_inicio(NEW.tenant_id, v_desde, NEW.fecha_inicio_contable);
  IF v_total > 0 THEN
    SELECT string_agg(format('%s %s (%s): %s', c.tipo, c.numero, to_char(c.fecha, 'DD/MM/YYYY'), c.motivo), '; ')
      INTO v_lista
      FROM (SELECT * FROM public.finanzas_cruces_del_inicio(NEW.tenant_id, v_desde, NEW.fecha_inicio_contable) LIMIT 10) c;
    RAISE EXCEPTION 'No se puede mover el inicio contable del % al %: % documento(s) quedarían del lado equivocado. %',
      to_char(v_desde, 'DD/MM/YYYY'), to_char(NEW.fecha_inicio_contable, 'DD/MM/YYYY'), v_total,
      v_lista || CASE WHEN v_total > 10 THEN format('; y %s más.', v_total - 10) ELSE '.' END
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inicio_contable_guard ON public.finanzas_parametros;
CREATE TRIGGER trg_inicio_contable_guard
  BEFORE INSERT OR UPDATE OF fecha_inicio_contable ON public.finanzas_parametros
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_inicio_contable_guard();

-- Las funciones de lectura: sólo el servidor (la ruta y los triggers).
REVOKE ALL ON FUNCTION public.finanzas_cruces_del_inicio(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_cruces_del_inicio(uuid, date, date) TO service_role;
REVOKE ALL ON FUNCTION public.finanzas_documento_de_origen(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_documento_de_origen(text, uuid) TO service_role;

-- ── 6. Pre-flight: asientos que YA existen de documentos anteriores al inicio
DO $$
DECLARE
  v_n     int;
  v_lista text;
BEGIN
  WITH malos AS (
    SELECT j.entry_number, d.numero, d.fecha
      FROM public.journal_entries j
      CROSS JOIN LATERAL public.finanzas_documento_de_origen(j.source_type, j.source_id) d
     WHERE j.source_id IS NOT NULL
       AND d.fecha < public.finanzas_inicio_contable(j.tenant_id)
  )
  SELECT count(*), string_agg(format('asiento %s (%s, %s)', entry_number, numero, to_char(fecha, 'DD/MM/YYYY')), '; ' ORDER BY entry_number)
    INTO v_n, v_lista FROM malos;
  IF v_n > 0 THEN
    IF coalesce(current_setting('finanzas.inicio_contable_existentes', true), '') <> 'aceptar' THEN
      RAISE EXCEPTION '096: hay % asiento(s) de documentos anteriores al inicio contable: %. En producción no debería haber ninguno (libro vacío): revisar antes de seguir. En staging, aplicar con SET finanzas.inicio_contable_existentes = ''aceptar''.',
        v_n, v_lista;
    END IF;
    RAISE NOTICE '096: % asiento(s) de documentos anteriores al inicio, aceptados (staging): %', v_n, v_lista;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_libro_desde_el_inicio') THEN
    RAISE EXCEPTION '096: falta el trigger del libro';
  END IF;
  RAISE NOTICE '096 ✅ inicio contable % por defecto; el libro rechaza documentos anteriores; el inicio no cruza documentos', DATE '2026-07-01';
END $$;

COMMIT;

-- Verificación (BEGIN … ROLLBACK): sql/tests/verificacion-096-inicio-contable.sql
