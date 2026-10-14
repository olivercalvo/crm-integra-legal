-- ============================================================================
-- 103 · CORREGIR una COMPRA contabilizada desde la pantalla
-- ============================================================================
-- Criterio de Oliver con Josuarth (14/10/2026): un documento contabilizado se
-- CORRIGE, sin límite de veces, con el período abierto. Corregir NUNCA edita el
-- libro: en UNA transacción reversa el asiento vigente de la compra y registra
-- el corregido. Motivo obligatorio e historial de versiones.
--
-- Hasta hoy la compra contabilizada ofrecía «Editar» y al guardar respondía
-- 409 (gateContable, «se habilita junto con el asiento de reversión»).
--
-- Qué deja:
--   1. journal_entries_un_asiento_por_documento (034) sigue siendo UNIQUE pero
--      deja afuera los asientos de una corrección (idempotency_key
--      'correccion:…'). Sin eso, el asiento corregido de la compra chocaría con
--      el original (mismo source_type y source_id). La regla «uno por versión»
--      la sostiene el UNIQUE de idempotency_key, con la versión en la llave.
--   2. compra_correcciones: una fila por corrección (versión 2, 3, …), con el
--      asiento anterior, la reversión, el asiento nuevo, el motivo, el usuario y
--      la foto de la compra antes y después. Inmutable. La versión 1 es el
--      asiento original de la compra.
--   3. corregir_compra(...): SECURITY DEFINER, EXECUTE sólo service_role. En
--      UNA transacción, con el candado del correlativo primero (orden J → A):
--        · la compra existe y su asiento vigente es el que se editó (si otra
--          persona la corrigió mientras tanto, se rechaza);
--        · sin pagos registrados y sin notas de crédito (con o sin aplicación):
--          el mensaje dice cuáles reversar primero;
--        · el mes del asiento vigente y el de la fecha de registro nueva,
--          ABIERTOS;
--        · el espejo se VERIFICA contra el libro (EXCEPT ALL en los dos
--          sentidos, como toda reversión) y se postea con la fecha del asiento
--          original: el auxiliar y el mayor coinciden en cualquier corte;
--        · actualiza la compra y reemplaza sus líneas;
--        · verifica que el asiento nuevo (lo arma construirAsientoDeCompra, la
--          misma función del alta) acredite 200001 por el total nuevo con el
--          proveedor de la compra, y lo postea con su fecha de registro.
--      Si algo falla, no queda nada.
--
-- Bitácora: business_expenses, expense_lines y journal_entries ya se capturan
-- (trg_auditoria), con el usuario de x-actor-id. No toca datos.
-- 🛡️ Escrita para staging. En producción va en la ventana, después de la 102.
-- ============================================================================
BEGIN;

-- ── 1. Un asiento por documento, salvo las correcciones ────────────────────
DROP INDEX IF EXISTS public.journal_entries_un_asiento_por_documento;
CREATE UNIQUE INDEX journal_entries_un_asiento_por_documento
  ON public.journal_entries (tenant_id, source_type, source_id)
  WHERE source_id IS NOT NULL
    AND (idempotency_key IS NULL OR idempotency_key NOT LIKE 'correccion:%');
COMMENT ON INDEX public.journal_entries_un_asiento_por_documento IS
  'Un documento tiene UN asiento (034). Las correcciones (103, idempotency_key correccion:...) quedan afuera: cada versión es única por su llave.';

-- ── 2. El historial ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.compra_correcciones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  business_expense_id uuid NOT NULL REFERENCES public.business_expenses(id) ON DELETE RESTRICT,
  version             integer NOT NULL CHECK (version >= 2),
  entry_anterior_id   uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  reversal_entry_id   uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  entry_id            uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  motivo              text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 3 AND 1000),
  anterior            jsonb NOT NULL,
  nueva               jsonb NOT NULL,
  created_by          uuid NULL REFERENCES public.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compra_correcciones_una_version UNIQUE (business_expense_id, version)
);
CREATE INDEX IF NOT EXISTS compra_correcciones_tenant ON public.compra_correcciones (tenant_id, business_expense_id);
COMMENT ON TABLE public.compra_correcciones IS
  'Correcciones de compras contabilizadas (103). La escribe sólo corregir_compra. Inmutable.';

ALTER TABLE public.compra_correcciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compra_correcciones_select ON public.compra_correcciones;
CREATE POLICY compra_correcciones_select ON public.compra_correcciones
  FOR SELECT USING (tenant_id = public.get_tenant_id() AND public.get_user_role() IN ('admin', 'abogada', 'contador'));

CREATE OR REPLACE FUNCTION public.finanzas_compra_correccion_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'El historial de correcciones de una compra no se edita ni se borra.' USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS trg_compra_correccion_inmutable ON public.compra_correcciones;
CREATE TRIGGER trg_compra_correccion_inmutable BEFORE UPDATE OR DELETE ON public.compra_correcciones
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_compra_correccion_inmutable();

-- ── 3. corregir_compra ─────────────────────────────────────────────────────
-- p_cabecera: expense_date, accounting_date, due_date, supplier_id,
--   supplier_name, supplier_ruc, supplier_invoice_number, description,
--   subtotal, tax_rate, tax_amount, payment_method, notes (ya validados y
--   con los importes derivados de las líneas, como en el alta).
-- p_lineas: [{ description, chart_account_code, amount, tax_code_id,
--   tax_rate, tax_amount }] con la tasa del catálogo.
-- p_espejo: el espejo del asiento vigente (construirAsientoDeReversion).
-- p_asiento: { transaction_date, description, lines } de construirAsientoDeCompra
--   sobre la compra corregida.
CREATE OR REPLACE FUNCTION public.corregir_compra(
  p_tenant_id      uuid,
  p_compra_id      uuid,
  p_entry_esperado uuid,
  p_motivo         text,
  p_cabecera       jsonb,
  p_lineas         jsonb,
  p_espejo         jsonb,
  p_asiento        jsonb,
  p_created_by     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_motivo     text := btrim(coalesce(p_motivo, ''));
  v_c          public.business_expenses%ROWTYPE;
  v_orig       public.journal_entries%ROWTYPE;
  v_nueva_f    date;
  v_status     text;
  v_txt        text;
  v_n          int;
  v_dif        int;
  v_version    int;
  v_anterior   jsonb;
  v_nueva      jsonb;
  v_rev_id     uuid;
  v_new_id     uuid;
  v_total      numeric(14,2);
  v_cxp        numeric(14,2);
  v_deb        numeric(14,2);
  v_cre        numeric(14,2);
  v_prov       uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_compra_id IS NULL THEN
    RAISE EXCEPTION 'corregir_compra: faltan el tenant o la compra';
  END IF;
  IF length(v_motivo) < 3 OR length(v_motivo) > 1000 THEN
    RAISE EXCEPTION 'La corrección necesita un motivo de 3 a 1000 caracteres.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'La compra corregida necesita al menos una línea.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_espejo IS NULL OR jsonb_typeof(p_espejo) <> 'array' OR jsonb_array_length(p_espejo) < 2
     OR p_asiento IS NULL OR jsonb_typeof(p_asiento->'lines') <> 'array' THEN
    RAISE EXCEPTION 'corregir_compra: faltan el espejo o el asiento corregido';
  END IF;

  -- El candado del correlativo, antes de mirar nada (orden J → A de la 090).
  INSERT INTO public.accounting_sequences (tenant_id, sequence_type, last_number)
  VALUES (p_tenant_id, 'journal_entry', 0)
  ON CONFLICT (tenant_id, sequence_type) DO NOTHING;
  PERFORM 1 FROM public.accounting_sequences
   WHERE tenant_id = p_tenant_id AND sequence_type = 'journal_entry'
     FOR UPDATE;

  SELECT * INTO v_c FROM public.business_expenses
   WHERE tenant_id = p_tenant_id AND id = p_compra_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra no encontrada.' USING ERRCODE = 'check_violation';
  END IF;

  -- El asiento VIGENTE de la compra: el que nadie reversó.
  SELECT je.* INTO v_orig FROM public.journal_entries je
   WHERE je.tenant_id = p_tenant_id AND je.source_type = 'gasto' AND je.source_id = p_compra_id
     AND NOT EXISTS (SELECT 1 FROM public.journal_entries r
                      WHERE r.tenant_id = je.tenant_id AND r.reverses_entry_id = je.id)
   ORDER BY je.entry_number DESC
   LIMIT 1;
  IF v_orig.id IS NULL THEN
    RAISE EXCEPTION 'Esta compra no está registrada en el libro contable: no se corrige, se edita.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_entry_esperado IS DISTINCT FROM v_orig.id THEN
    RAISE EXCEPTION 'La compra cambió mientras la corregías (otra persona la corrigió). Vuelve a abrir «Corregir».'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Pagos y notas de crédito: primero se reversan.
  SELECT count(*), string_agg(coalesce(payment_number, 'saldo heredado'), ', ' ORDER BY payment_date)
    INTO v_n, v_txt
    FROM public.supplier_payments
   WHERE tenant_id = p_tenant_id AND business_expense_id = p_compra_id AND status = 'registrado';
  IF v_n > 0 OR coalesce(v_c.amount_paid, 0) > 0 THEN
    RAISE EXCEPTION 'Esta compra tiene % pago(s) registrado(s) (%). Primero reversa los pagos con asiento o elimina los que no lo tienen; después se corrige la compra.',
      v_n, coalesce(v_txt, 'sin número') USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*), string_agg(DISTINCT n.credit_note_number, ', ')
    INTO v_n, v_txt
    FROM public.supplier_credit_notes n
   WHERE n.tenant_id = p_tenant_id AND n.status = 'emitida'
     AND (n.business_expense_id = p_compra_id
          OR EXISTS (SELECT 1 FROM public.supplier_credit_note_applications a
                      WHERE a.credit_note_id = n.id AND a.business_expense_id = p_compra_id));
  IF v_n > 0 OR coalesce(v_c.credited_total, 0) > 0 THEN
    RAISE EXCEPTION 'Esta compra tiene nota(s) de crédito del proveedor (%). Primero se reversan; después se corrige la compra.',
      coalesce(v_txt, 'aplicadas') USING ERRCODE = 'check_violation';
  END IF;

  -- Los dos meses: el del asiento vigente y el de la fecha de registro nueva.
  SELECT status INTO v_status FROM public.accounting_periods
   WHERE tenant_id = p_tenant_id AND year = extract(year FROM v_orig.transaction_date)::int
     AND month = extract(month FROM v_orig.transaction_date)::int;
  IF v_status IS DISTINCT FROM 'abierto' THEN
    RAISE EXCEPTION 'El mes del asiento de la compra (%) está cerrado: la compra no se corrige. El ajuste va con un asiento de diario en un mes abierto, o el contador reabre el mes en Períodos contables.',
      to_char(v_orig.transaction_date, 'MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;
  v_nueva_f := (p_cabecera->>'accounting_date')::date;
  IF v_nueva_f IS NULL OR (p_asiento->>'transaction_date')::date IS DISTINCT FROM v_nueva_f THEN
    RAISE EXCEPTION 'corregir_compra: la fecha del asiento no es la fecha de registro de la compra';
  END IF;
  SELECT status INTO v_status FROM public.accounting_periods
   WHERE tenant_id = p_tenant_id AND year = extract(year FROM v_nueva_f)::int AND month = extract(month FROM v_nueva_f)::int;
  IF FOUND AND v_status IS DISTINCT FROM 'abierto' THEN
    RAISE EXCEPTION 'El mes de la fecha de registro nueva (%) está cerrado: la compra no se corrige con esa fecha.',
      to_char(v_nueva_f, 'MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;

  -- El espejo se VERIFICA, no se recalcula (mismo cerrojo que 046/050/055).
  WITH esperado AS (
    SELECT c.code AS code, l.credit AS debit, l.debit AS credit
      FROM public.journal_entry_lines l
      JOIN public.chart_of_accounts c ON c.id = l.account_id
     WHERE l.entry_id = v_orig.id
  ), recibido AS (
    SELECT btrim(x->>'account_code')                      AS code,
           round(coalesce((x->>'debit')::numeric, 0), 2)  AS debit,
           round(coalesce((x->>'credit')::numeric, 0), 2) AS credit
      FROM jsonb_array_elements(p_espejo) x
  )
  SELECT count(*) INTO v_dif
    FROM (
      (SELECT code, debit, credit FROM esperado EXCEPT ALL SELECT code, debit, credit FROM recibido)
      UNION ALL
      (SELECT code, debit, credit FROM recibido EXCEPT ALL SELECT code, debit, credit FROM esperado)
    ) d;
  IF v_dif > 0 THEN
    RAISE EXCEPTION
      'Las líneas recibidas no son el espejo exacto del asiento %: se rechaza la corrección para no descuadrar el libro.',
      v_orig.entry_number;
  END IF;

  SELECT count(*) + 2 INTO v_version FROM public.compra_correcciones
   WHERE tenant_id = p_tenant_id AND business_expense_id = p_compra_id;

  -- La reversión, con la fecha del asiento que revierte.
  v_rev_id := public.post_journal_entry(
    p_tenant_id, v_orig.transaction_date,
    'Reversión por corrección de la compra ' || coalesce(v_c.purchase_number, v_c.description),
    'reversion', p_espejo, p_compra_id, NULL, v_orig.id,
    'Corrección de la compra: ' || v_motivo, p_created_by, NULL, v_orig.reference,
    'correccion:gasto:' || p_compra_id || ':v' || v_version || ':reversa', NULL);

  -- La foto de antes, la compra corregida y sus líneas.
  SELECT jsonb_build_object(
           'expense_date', b.expense_date, 'accounting_date', b.accounting_date, 'due_date', b.due_date,
           'supplier_id', b.supplier_id, 'supplier_invoice_number', b.supplier_invoice_number,
           'description', b.description, 'subtotal', b.subtotal, 'tax_amount', b.tax_amount, 'total', b.total,
           'lineas', coalesce((SELECT jsonb_agg(jsonb_build_object(
                       'description', l.description, 'chart_account_code', l.chart_account_code,
                       'amount', l.amount, 'tax_code_id', l.tax_code_id, 'tax_amount', l.tax_amount) ORDER BY l.line_order)
                     FROM public.expense_lines l WHERE l.business_expense_id = b.id), '[]'::jsonb))
    INTO v_anterior
    FROM public.business_expenses b WHERE b.id = p_compra_id;

  UPDATE public.business_expenses SET
    expense_date            = (p_cabecera->>'expense_date')::date,
    accounting_date         = v_nueva_f,
    due_date                = nullif(p_cabecera->>'due_date', '')::date,
    supplier_id             = nullif(p_cabecera->>'supplier_id', '')::uuid,
    supplier_name           = nullif(btrim(coalesce(p_cabecera->>'supplier_name', '')), ''),
    supplier_ruc            = nullif(btrim(coalesce(p_cabecera->>'supplier_ruc', '')), ''),
    supplier_invoice_number = nullif(btrim(coalesce(p_cabecera->>'supplier_invoice_number', '')), ''),
    description             = btrim(p_cabecera->>'description'),
    subtotal                = round((p_cabecera->>'subtotal')::numeric, 2),
    tax_rate                = coalesce((p_cabecera->>'tax_rate')::numeric, 0),
    tax_amount              = round((p_cabecera->>'tax_amount')::numeric, 2),
    payment_method          = nullif(p_cabecera->>'payment_method', ''),
    notes                   = nullif(btrim(coalesce(p_cabecera->>'notes', '')), '')
  WHERE tenant_id = p_tenant_id AND id = p_compra_id;

  DELETE FROM public.expense_lines WHERE tenant_id = p_tenant_id AND business_expense_id = p_compra_id;
  INSERT INTO public.expense_lines (tenant_id, business_expense_id, line_order, description, chart_account_code,
                                    amount, tax_code_id, tax_rate, tax_amount)
  SELECT p_tenant_id, p_compra_id, n, btrim(l->>'description'), btrim(l->>'chart_account_code'),
         round((l->>'amount')::numeric, 2), nullif(l->>'tax_code_id', '')::uuid,
         coalesce((l->>'tax_rate')::numeric, 0), round(coalesce((l->>'tax_amount')::numeric, 0), 2)
    FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS x(l, n);

  -- El asiento nuevo tiene que ser el de ESTA compra: 200001 por el total, con
  -- su proveedor, y débitos igual al total. El cuadre lo vuelve a exigir el motor.
  SELECT b.total, b.supplier_id INTO v_total, v_prov FROM public.business_expenses b WHERE b.id = p_compra_id;
  IF v_prov IS NULL THEN
    RAISE EXCEPTION 'La compra va a Cuentas por pagar (200001) y ahí cada movimiento dice de qué proveedor es: elige el proveedor.'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(round(coalesce((x->>'credit')::numeric, 0), 2)) FILTER (WHERE btrim(x->>'account_code') = '200001'), 0),
         coalesce(sum(round(coalesce((x->>'debit')::numeric, 0), 2)), 0),
         coalesce(sum(round(coalesce((x->>'credit')::numeric, 0), 2)), 0),
         count(*) FILTER (WHERE btrim(x->>'account_code') = '200001'
                          AND nullif(x->>'supplier_id', '')::uuid IS DISTINCT FROM v_prov)
    INTO v_cxp, v_deb, v_cre, v_n
    FROM jsonb_array_elements(p_asiento->'lines') x;
  IF v_cxp <> v_total OR v_deb <> v_total OR v_cre <> v_total OR v_n > 0 THEN
    RAISE EXCEPTION 'El asiento corregido no corresponde a la compra corregida (total %, 200001 %, débitos %): no se registró nada.',
      v_total, v_cxp, v_deb USING ERRCODE = 'check_violation';
  END IF;

  v_new_id := public.post_journal_entry(
    p_tenant_id, v_nueva_f, coalesce(nullif(btrim(p_asiento->>'description'), ''), 'Compra ' || v_c.description),
    'gasto', p_asiento->'lines', p_compra_id, NULL, NULL, NULL, p_created_by, NULL, v_c.purchase_number,
    'correccion:gasto:' || p_compra_id || ':v' || v_version,
    nullif(btrim(coalesce(p_cabecera->>'supplier_invoice_number', '')), ''));

  SELECT jsonb_build_object(
           'expense_date', b.expense_date, 'accounting_date', b.accounting_date, 'due_date', b.due_date,
           'supplier_id', b.supplier_id, 'supplier_invoice_number', b.supplier_invoice_number,
           'description', b.description, 'subtotal', b.subtotal, 'tax_amount', b.tax_amount, 'total', b.total,
           'lineas', coalesce((SELECT jsonb_agg(jsonb_build_object(
                       'description', l.description, 'chart_account_code', l.chart_account_code,
                       'amount', l.amount, 'tax_code_id', l.tax_code_id, 'tax_amount', l.tax_amount) ORDER BY l.line_order)
                     FROM public.expense_lines l WHERE l.business_expense_id = b.id), '[]'::jsonb))
    INTO v_nueva
    FROM public.business_expenses b WHERE b.id = p_compra_id;

  INSERT INTO public.compra_correcciones (tenant_id, business_expense_id, version, entry_anterior_id, reversal_entry_id,
                                          entry_id, motivo, anterior, nueva, created_by)
  VALUES (p_tenant_id, p_compra_id, v_version, v_orig.id, v_rev_id, v_new_id, v_motivo, v_anterior, v_nueva, p_created_by);

  RETURN jsonb_build_object(
    'version', v_version,
    'entry_id', v_new_id,
    'entry_number', (SELECT entry_number FROM public.journal_entries WHERE id = v_new_id),
    'reversal_entry_id', v_rev_id,
    'reversal_entry_number', (SELECT entry_number FROM public.journal_entries WHERE id = v_rev_id),
    'reversed_entry_number', v_orig.entry_number);
END;
$fn$;

REVOKE ALL ON FUNCTION public.corregir_compra(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corregir_compra(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid) TO service_role;

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.corregir_compra(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '103: authenticated no debe poder ejecutar corregir_compra';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'journal_entries_un_asiento_por_documento'
                   AND indexdef LIKE '%correccion:%') THEN
    RAISE EXCEPTION '103: el índice de un asiento por documento no quedó con la excepción de las correcciones';
  END IF;
  RAISE NOTICE '103 ✅ corregir_compra: reversa el asiento vigente y postea el corregido en una transacción, con historial';
END $$;

COMMIT;

-- Verificación (BEGIN … ROLLBACK): sql/tests/verificacion-103-corregir-compra.sql
-- Producción (SQL Editor, no escribe nada): sql/tests/verificacion-103-produccion.sql
