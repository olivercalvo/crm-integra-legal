-- ============================================================================
-- 066 — NOTA DE CRÉDITO DE COMPRA (proveedor). Punto 3.5, aprobado el 25/09/2026
-- ============================================================================
-- El proveedor nos acredita parte (o toda) una compra. Es un documento DEL
-- PROVEEDOR que registramos, no uno que emitimos: no va a la DGI.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LAS REGLAS (Oliver, 25/09/2026)
-- ─────────────────────────────────────────────────────────────────────────────
--   · Reduce el saldo con el proveedor y el ITBMS de compras del período DE
--     LA NC.
--   · El asiento sigue el patrón de la NC de venta: el asiento de la compra,
--     armado sobre las líneas acreditadas, AL REVÉS. Nada restado a mano.
--   · No puede exceder lo pendiente de la compra.
--   · Se anula con su reversión fechada hoy.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🟡 VALORES POR DEFECTO QUE DEPENDEN DE JOSUARTH (preguntas en task_plan.md)
-- ─────────────────────────────────────────────────────────────────────────────
--   J-2  Fecha contable = HOY (la del registro). La fecha del documento del
--        proveedor se guarda aparte (`supplier_document_date`).
--   J-3  Tope = `balance_due` (lo que falta pagar). Una compra ya pagada NO
--        admite NC por encima de su saldo: no se crea saldo a favor en 200001
--        hasta que Josuarth diga a qué cuenta va. Es más estricto que "lo
--        pendiente de acreditar", así que también lo cumple.
--   J-5  Resta ITBMS de compras (HABER 200003) en el mes de la NC.
--   J-10 Número del documento del proveedor OBLIGATORIO; CUFE opcional.
--   J-11 Número interno `NCP-000001`.
--   J-7  Sólo COMPRAS (`business_expenses`). El gasto de trámite queda fuera
--        hasta saber qué pasa si ya se refacturó al cliente.
--   Cuentas: las MISMAS de la compra (la de cada línea, 200003, 200001).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ UN SOLO RPC Y NO "INSERT + POSTEO + COMPENSAR"
-- ─────────────────────────────────────────────────────────────────────────────
-- `create_supplier_credit_note` toma el número, valida los topes con la compra
-- BLOQUEADA, inserta la NC y sus líneas y postea el asiento, todo en una
-- transacción. Si algo falla no queda nada: ni NC huérfana, ni asiento, ni
-- hueco en `NCP-` (la secuencia también se deshace). Y el tope se valida con
-- candado: dos NC simultáneas sobre la misma compra no pueden pasarse.
--
-- 🔴 EL SALDO SE DERIVA, NO SE ESCRIBE (patrón 051/060). `credited_total` la
--    calcula un trigger desde las NC `emitida`; `balance_due` es GENERATED; el
--    status de la compra se deriva contra el total NETO. Anular una NC cambia
--    UN estado y el trigger recalcula todo.
--
-- IDEMPOTENCIA: IF NOT EXISTS / CREATE OR REPLACE / DROP+ADD con nombre fijo.
-- 🛑 SOLO STAGING. Depende de 048 (supplier_payments, recálculo), 054 (motor).
-- ============================================================================

BEGIN;

-- ── 1. Las tablas ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_credit_notes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  credit_note_number      text NOT NULL,
  business_expense_id     uuid NOT NULL REFERENCES public.business_expenses(id),
  supplier_id             uuid NULL REFERENCES public.suppliers(id),
  supplier_document_number text NOT NULL,
  supplier_document_date  date NOT NULL,
  supplier_cufe           text NULL,
  issue_date              date NOT NULL,
  reason                  text NOT NULL,
  status                  text NOT NULL DEFAULT 'emitida',
  subtotal_total          numeric(12,2) NOT NULL,
  tax_total               numeric(12,2) NOT NULL,
  grand_total             numeric(12,2) NOT NULL,
  cancelled_at            timestamptz NULL,
  cancellation_reason     text NULL,
  created_by              uuid NULL REFERENCES public.users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scn_numero_unico UNIQUE (tenant_id, credit_note_number),
  CONSTRAINT scn_status_check CHECK (status IN ('emitida', 'anulada')),
  CONSTRAINT scn_motivo_largo CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  CONSTRAINT scn_doc_proveedor_no_vacio CHECK (char_length(btrim(supplier_document_number)) > 0),
  CONSTRAINT scn_montos CHECK (subtotal_total >= 0 AND tax_total >= 0 AND grand_total > 0
                               AND grand_total = subtotal_total + tax_total),
  CONSTRAINT scn_anulacion_completa CHECK (
    (status = 'anulada' AND cancelled_at IS NOT NULL AND char_length(btrim(coalesce(cancellation_reason, ''))) >= 3)
    OR (status = 'emitida' AND cancelled_at IS NULL AND cancellation_reason IS NULL)
  )
);

-- El mismo documento del proveedor no se registra dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS scn_doc_proveedor_unico
  ON public.supplier_credit_notes (tenant_id, supplier_id, supplier_document_number)
  WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS scn_por_compra ON public.supplier_credit_notes (business_expense_id);

CREATE TABLE IF NOT EXISTS public.supplier_credit_note_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  credit_note_id      uuid NOT NULL REFERENCES public.supplier_credit_notes(id) ON DELETE CASCADE,
  expense_line_id     uuid NOT NULL REFERENCES public.expense_lines(id),
  line_order          integer NOT NULL,
  description         text NOT NULL,
  chart_account_code  text NOT NULL,
  amount              numeric(12,2) NOT NULL CHECK (amount > 0),
  tax_rate            numeric(5,4) NOT NULL DEFAULT 0,
  tax_amount          numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total          numeric(12,2) GENERATED ALWAYS AS (amount + tax_amount) STORED,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scnl_por_nc ON public.supplier_credit_note_lines (credit_note_id);
CREATE INDEX IF NOT EXISTS scnl_por_linea ON public.supplier_credit_note_lines (expense_line_id);

ALTER TABLE public.supplier_credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_credit_note_lines ENABLE ROW LEVEL SECURITY;
-- Sólo LECTURA por sesión. Se escriben únicamente por los RPC (SECURITY DEFINER).
DROP POLICY IF EXISTS scn_lectura ON public.supplier_credit_notes;
CREATE POLICY scn_lectura ON public.supplier_credit_notes FOR SELECT USING (tenant_id = get_tenant_id());
DROP POLICY IF EXISTS scnl_lectura ON public.supplier_credit_note_lines;
CREATE POLICY scnl_lectura ON public.supplier_credit_note_lines FOR SELECT USING (tenant_id = get_tenant_id());

-- ── 2. Inmutabilidad: UNA transición, emitida → anulada ─────────────────────
CREATE OR REPLACE FUNCTION public.finanzas_scn_inmutable()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'La nota de crédito de proveedor % no se borra: se reversa.', OLD.credit_note_number
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.credit_note_number, NEW.business_expense_id, NEW.supplier_id, NEW.supplier_document_number,
      NEW.supplier_document_date, NEW.issue_date, NEW.reason, NEW.subtotal_total, NEW.tax_total, NEW.grand_total,
      NEW.tenant_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.credit_note_number, OLD.business_expense_id, OLD.supplier_id, OLD.supplier_document_number,
      OLD.supplier_document_date, OLD.issue_date, OLD.reason, OLD.subtotal_total, OLD.tax_total, OLD.grand_total,
      OLD.tenant_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'La nota de crédito de proveedor % es inmutable: sólo se puede anular.', OLD.credit_note_number
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'emitida' AND NEW.status = 'anulada') THEN
    RAISE EXCEPTION 'Nota de crédito de proveedor %: la única transición es emitida → anulada (llegó % → %).',
      OLD.credit_note_number, OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_scn_inmutable ON public.supplier_credit_notes;
CREATE TRIGGER trg_scn_inmutable BEFORE UPDATE OR DELETE ON public.supplier_credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_scn_inmutable();

CREATE OR REPLACE FUNCTION public.finanzas_scnl_inmutable()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'Las líneas de una nota de crédito de proveedor no se modifican ni se borran.'
    USING ERRCODE = 'check_violation';
END $fn$;
DROP TRIGGER IF EXISTS trg_scnl_inmutable ON public.supplier_credit_note_lines;
CREATE TRIGGER trg_scnl_inmutable BEFORE UPDATE OR DELETE ON public.supplier_credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_scnl_inmutable();

-- ── 3. El saldo de la compra: credited_total derivada, balance_due generada ──
ALTER TABLE public.business_expenses
  ADD COLUMN IF NOT EXISTS credited_total numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.business_expenses DROP CONSTRAINT IF EXISTS business_expenses_credited_range_check;
ALTER TABLE public.business_expenses ADD CONSTRAINT business_expenses_credited_range_check
  CHECK (credited_total >= 0 AND credited_total <= subtotal + tax_amount);
-- `total` es GENERATED y Postgres no deja que una generada lea otra: se usa
-- subtotal + tax_amount, que es exactamente la definición de `total` (010).
ALTER TABLE public.business_expenses
  ADD COLUMN IF NOT EXISTS balance_due numeric(12,2)
  GENERATED ALWAYS AS (subtotal + tax_amount - amount_paid - credited_total) STORED;

-- El recálculo de pagos (048) deriva el status contra el total NETO.
-- Acreditada al 100% sin pagos = `pendiente_pago` con saldo 0 (criterio D3 de
-- ventas): "pagada" diría que salió plata que no salió.
CREATE OR REPLACE FUNCTION public.finanzas_recalc_one_expense_amount_paid(p_expense_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_paid       numeric(12,2);
  v_last_date  date;
  v_neto       numeric(12,2);
  v_new_status text;
BEGIN
  SELECT COALESCE(SUM(amount), 0), MAX(payment_date)
    INTO v_paid, v_last_date
    FROM public.supplier_payments
   WHERE business_expense_id = p_expense_id AND status = 'registrado';

  SELECT total - credited_total INTO v_neto
    FROM public.business_expenses WHERE id = p_expense_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_paid <= 0 THEN
    v_new_status := 'pendiente_pago';
    v_last_date  := NULL;
  ELSIF v_paid >= v_neto THEN
    v_new_status := 'pagado';
  ELSE
    v_new_status := 'parcialmente_pagado';
  END IF;

  PERFORM set_config('finanzas.recalc', 'on', true);
  UPDATE public.business_expenses
     SET amount_paid  = v_paid,
         status       = v_new_status,
         payment_date = v_last_date
   WHERE id = p_expense_id;
  PERFORM set_config('finanzas.recalc', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.finanzas_recalc_one_expense_credited(p_expense_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_cred numeric(12,2);
BEGIN
  SELECT COALESCE(SUM(grand_total), 0) INTO v_cred
    FROM public.supplier_credit_notes
   WHERE business_expense_id = p_expense_id AND status = 'emitida';
  PERFORM set_config('finanzas.recalc', 'on', true);
  UPDATE public.business_expenses SET credited_total = v_cred WHERE id = p_expense_id;
  PERFORM set_config('finanzas.recalc', 'off', true);
  -- Y el status, con la MISMA función que lo deriva de los pagos.
  PERFORM public.finanzas_recalc_one_expense_amount_paid(p_expense_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.finanzas_trg_recalc_expense_credited()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.finanzas_recalc_one_expense_credited(NEW.business_expense_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_recalc_expense_credited ON public.supplier_credit_notes;
CREATE TRIGGER trg_recalc_expense_credited AFTER INSERT OR UPDATE ON public.supplier_credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_trg_recalc_expense_credited();

-- El guard de la 048 protege también credited_total.
CREATE OR REPLACE FUNCTION public.finanzas_guard_expense_amount_paid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_recalc   text := current_setting('finanzas.recalc', true);
  v_override text := current_setting('finanzas.amount_paid_override', true);
  v_ayuda    text :=
    '`business_expenses.amount_paid`, `credited_total` y su `status` se DERIVAN de `supplier_payments` '
    'y `supplier_credit_notes` (048, 066). Para pagar o acreditar una compra NO se escriben estas '
    'columnas: se registra el PAGO o la NOTA DE CRÉDITO y el trigger las deriva. '
    'Si esto es una restauración autorizada, la válvula es finanzas.amount_paid_override (SOP-017).';
BEGIN
  IF v_recalc = 'on' THEN
    RETURN NEW;
  END IF;
  IF v_override = 'on' THEN
    RAISE WARNING 'finanzas.amount_paid_override: escritura MANUAL en la compra % (%). Ver sop.md SOP-017.',
      NEW.id, TG_OP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.amount_paid IS DISTINCT FROM 0 OR NEW.credited_total IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'La compra no puede nacer pagada ni acreditada. %', v_ayuda
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'pendiente_pago' THEN
      RAISE EXCEPTION 'La compra no puede nacer con status = %. %', NEW.status, v_ayuda
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN
    RAISE EXCEPTION 'Escritura directa de amount_paid en la compra % (% → %). %',
      OLD.id, OLD.amount_paid, NEW.amount_paid, v_ayuda USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.credited_total IS DISTINCT FROM OLD.credited_total THEN
    RAISE EXCEPTION 'Escritura directa de credited_total en la compra % (% → %). %',
      OLD.id, OLD.credited_total, NEW.credited_total, v_ayuda USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Escritura directa del status en la compra % (% → %). %',
      OLD.id, OLD.status, NEW.status, v_ayuda USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. Numeración y source_type ─────────────────────────────────────────────
-- Los OCHO valores de la 048 más éste. Re-declarado completo.
ALTER TABLE public.numbering_sequences DROP CONSTRAINT IF EXISTS numbering_sequences_sequence_type_check;
ALTER TABLE public.numbering_sequences ADD CONSTRAINT numbering_sequences_sequence_type_check
  CHECK (sequence_type IN ('quote', 'invoice_hon', 'invoice_reim', 'credit_note', 'client',
                           'supplier', 'payment', 'supplier_payment', 'supplier_credit_note'));
INSERT INTO public.numbering_sequences (tenant_id, sequence_type, last_number)
SELECT t.id, 'supplier_credit_note', 0 FROM public.tenants t
ON CONFLICT DO NOTHING;

-- 🔴 Por NOMBRE exacto: la `028` borró de más una vez al buscar por texto y se
--    llevó `je_reversion_requires_ref` (lo documenta la 042).
ALTER TABLE public.journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IN ('factura', 'gasto', 'gasto_tramite', 'pago', 'pago_proveedor',
                         'nota_credito', 'nota_credito_proveedor', 'manual', 'reversion', 'apertura'));

-- ── 5. Crear: número + NC + líneas + asiento, UNA transacción ───────────────
-- El asiento lo arma la app (`asiento-nota-credito-compra.ts`, puro: el de la
-- compra al revés). Acá se VERIFICA contra los montos que calcula la base:
-- 200001 debita el total de la NC y 200003 acredita su ITBMS. Los montos de
-- cada línea NO vienen del cliente: la base toma sólo (línea, base) y aplica
-- la tasa de la línea de compra.
CREATE OR REPLACE FUNCTION public.create_supplier_credit_note(
  p_tenant_id            uuid,
  p_business_expense_id  uuid,
  p_doc_numero           text,
  p_doc_fecha            date,
  p_doc_cufe             text,
  p_reason               text,
  p_issue_date           date,
  p_lineas               jsonb,   -- [{expense_line_id, amount}]
  p_asiento              jsonb,   -- [{account_code, debit, credit, description}]
  p_created_by           uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_compra     record;
  v_linea      record;
  v_x          jsonb;
  v_sub        numeric(12,2) := 0;
  v_tax        numeric(12,2) := 0;
  v_monto      numeric(12,2);
  v_tax_linea  numeric(12,2);
  v_acreditado numeric(12,2);
  v_tax_acred  numeric(12,2);
  v_orden      int := 0;
  v_seq        int;
  v_numero     text;
  v_nc_id      uuid;
  v_entry_id   uuid;
  v_entry_nro  bigint;
  v_deb_200001 numeric(12,2);
  v_cre_200003 numeric(12,2);
  v_desc       text;
BEGIN
  IF p_tenant_id IS NULL OR p_business_expense_id IS NULL THEN
    RAISE EXCEPTION 'create_supplier_credit_note: faltan el tenant o la compra';
  END IF;
  IF coalesce(char_length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'El motivo de la nota de crédito necesita al menos 3 caracteres.';
  END IF;
  IF coalesce(char_length(btrim(p_doc_numero)), 0) = 0 THEN
    RAISE EXCEPTION 'Falta el número del documento del proveedor.';
  END IF;
  IF p_issue_date IS NULL OR abs(p_issue_date - current_date) > 1 THEN
    RAISE EXCEPTION 'La nota de crédito de proveedor se registra con la fecha de hoy (%): llegó %.',
      current_date, coalesce(p_issue_date::text, 'NULL');
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'La nota de crédito necesita al menos una línea con monto.';
  END IF;

  -- La compra, BLOQUEADA: dos NC a la vez no pueden pasarse del saldo.
  SELECT id, description, supplier_id, supplier_name, balance_due
    INTO v_compra
    FROM public.business_expenses
   WHERE tenant_id = p_tenant_id AND id = p_business_expense_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra no encontrada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.journal_entries
                  WHERE tenant_id = p_tenant_id AND source_type = 'gasto' AND source_id = p_business_expense_id) THEN
    RAISE EXCEPTION 'La compra no está registrada en el libro contable: no se le puede aplicar una nota de crédito.';
  END IF;

  -- PASADA 1: validar cada línea y calcular sus montos, SIN escribir nada.
  CREATE TEMP TABLE IF NOT EXISTS _ncp_lineas (
    orden int, expense_line_id uuid, description text, cuenta text,
    amount numeric(12,2), tax_rate numeric(5,4), tax_amount numeric(12,2)
  ) ON COMMIT DROP;
  TRUNCATE _ncp_lineas;

  FOR v_x IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v_monto := round(coalesce((v_x->>'amount')::numeric, 0), 2);
    IF v_monto <= 0 THEN
      CONTINUE;
    END IF;
    SELECT id, line_order, description, chart_account_code, amount, tax_rate, tax_amount
      INTO v_linea
      FROM public.expense_lines
     WHERE tenant_id = p_tenant_id
       AND business_expense_id = p_business_expense_id
       AND id = (v_x->>'expense_line_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Una línea de la nota de crédito no pertenece a esta compra.';
    END IF;

    -- Tope por línea: la base original menos lo acreditado por NC VIGENTES.
    SELECT COALESCE(SUM(l.amount), 0), COALESCE(SUM(l.tax_amount), 0) INTO v_acreditado, v_tax_acred
      FROM public.supplier_credit_note_lines l
      JOIN public.supplier_credit_notes n ON n.id = l.credit_note_id
     WHERE l.expense_line_id = v_linea.id AND n.status = 'emitida';
    IF v_monto > v_linea.amount - v_acreditado THEN
      RAISE EXCEPTION 'Línea % ("%"): se puede acreditar hasta B/. % de base; ya se acreditaron B/. % con otras notas de crédito.',
        v_linea.line_order, v_linea.description, (v_linea.amount - v_acreditado), v_acreditado;
    END IF;

    -- Si acredita TODO lo que queda de la línea, el ITBMS es el remanente
    -- exacto: el de la compra se cargó con ±0,02 de tolerancia y recalcularlo
    -- podría dejar un centavo de saldo que nadie debe.
    IF v_monto = v_linea.amount - v_acreditado THEN
      v_tax_linea := coalesce(v_linea.tax_amount, 0) - v_tax_acred;
    ELSE
      v_tax_linea := round(v_monto * coalesce(v_linea.tax_rate, 0), 2);
    END IF;
    v_orden := v_orden + 1;
    INSERT INTO _ncp_lineas VALUES (v_orden, v_linea.id, v_linea.description,
      v_linea.chart_account_code, v_monto, coalesce(v_linea.tax_rate, 0), v_tax_linea);
    v_sub := v_sub + v_monto;
    v_tax := v_tax + v_tax_linea;
  END LOOP;

  IF v_orden = 0 THEN
    RAISE EXCEPTION 'La nota de crédito necesita al menos una línea con monto mayor que cero.';
  END IF;

  -- Tope del documento: lo que falta pagar (J-3, ver el encabezado).
  IF v_sub + v_tax > v_compra.balance_due THEN
    RAISE EXCEPTION 'La nota de crédito (B/. %) supera lo que falta pagar de esta compra (B/. %). Si el proveedor te devolvió dinero o te dejó saldo a favor, consulta con el contador antes de registrarla.',
      (v_sub + v_tax), v_compra.balance_due;
  END IF;

  -- El asiento que armó la app tiene que coincidir con lo que calculó la base.
  SELECT COALESCE(SUM(CASE WHEN x->>'account_code' = '200001' THEN (x->>'debit')::numeric ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN x->>'account_code' = '200003' THEN (x->>'credit')::numeric ELSE 0 END), 0)
    INTO v_deb_200001, v_cre_200003
    FROM jsonb_array_elements(p_asiento) x;
  IF round(v_deb_200001, 2) <> round(v_sub + v_tax, 2) OR round(v_cre_200003, 2) <> round(v_tax, 2) THEN
    RAISE EXCEPTION 'El asiento no coincide con la nota de crédito (proveedores % contra %, ITBMS % contra %). No se registró nada.',
      v_deb_200001, (v_sub + v_tax), v_cre_200003, v_tax;
  END IF;

  -- PASADA 2: escribir. El número dentro de la transacción: si algo falla
  -- después, también se deshace y no queda hueco.
  v_seq := public.get_next_sequence_number(p_tenant_id, 'supplier_credit_note');
  v_numero := 'NCP-' || lpad(v_seq::text, 6, '0');

  INSERT INTO public.supplier_credit_notes (
    tenant_id, credit_note_number, business_expense_id, supplier_id,
    supplier_document_number, supplier_document_date, supplier_cufe,
    issue_date, reason, status, subtotal_total, tax_total, grand_total, created_by)
  VALUES (p_tenant_id, v_numero, p_business_expense_id, v_compra.supplier_id,
    btrim(p_doc_numero), p_doc_fecha, nullif(btrim(coalesce(p_doc_cufe, '')), ''),
    p_issue_date, btrim(p_reason), 'emitida', v_sub, v_tax, v_sub + v_tax, p_created_by)
  RETURNING id INTO v_nc_id;

  INSERT INTO public.supplier_credit_note_lines (
    tenant_id, credit_note_id, expense_line_id, line_order, description,
    chart_account_code, amount, tax_rate, tax_amount)
  SELECT p_tenant_id, v_nc_id, expense_line_id, orden, description, cuenta, amount, tax_rate, tax_amount
    FROM _ncp_lineas ORDER BY orden;

  v_desc := format('Nota de crédito de proveedor %s: compra %s%s (documento del proveedor %s)',
    v_numero, v_compra.description,
    CASE WHEN v_compra.supplier_name IS NOT NULL THEN ', ' || v_compra.supplier_name ELSE '' END,
    btrim(p_doc_numero));

  v_entry_id := public.post_journal_entry(
    p_tenant_id, p_issue_date, v_desc, 'nota_credito_proveedor', p_asiento,
    v_nc_id, NULL, NULL, NULL, p_created_by, NULL, v_numero, 'nota-credito-proveedor:' || v_nc_id::text
  );
  SELECT entry_number INTO v_entry_nro FROM public.journal_entries WHERE id = v_entry_id;

  RETURN jsonb_build_object(
    'id', v_nc_id, 'credit_note_number', v_numero,
    'subtotal', v_sub, 'tax', v_tax, 'total', v_sub + v_tax,
    'entry_id', v_entry_id, 'entry_number', v_entry_nro
  );
END $fn$;

-- ── 6. Reversar: espejo verificado + anulada, UNA transacción (calco de 060) ─
CREATE OR REPLACE FUNCTION public.reverse_supplier_credit_note(
  p_tenant_id        uuid,
  p_credit_note_id   uuid,
  p_reason           text,
  p_transaction_date date,
  p_description      text,
  p_lines            jsonb,
  p_created_by       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_numero    text;
  v_status    text;
  v_compra    uuid;
  v_orig_id   uuid;
  v_orig_nro  bigint;
  v_orig_ref  text;
  v_orig_date date;
  v_ya_nro    bigint;
  v_dif       int;
  v_entry_id  uuid;
  v_entry_nro bigint;
  v_balance   numeric(12,2);
BEGIN
  IF coalesce(char_length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'La reversión necesita un motivo de al menos 3 caracteres (DE 34/1998 Art. 5.7)';
  END IF;
  IF p_transaction_date IS NULL OR abs(p_transaction_date - current_date) > 1 THEN
    RAISE EXCEPTION 'La reversión lleva la fecha en que se hace (hoy, %), nunca otra: llegó %',
      current_date, coalesce(p_transaction_date::text, 'NULL');
  END IF;

  SELECT credit_note_number, status, business_expense_id INTO v_numero, v_status, v_compra
    FROM public.supplier_credit_notes
   WHERE tenant_id = p_tenant_id AND id = p_credit_note_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota de crédito de proveedor no encontrada';
  END IF;
  IF v_status = 'anulada' THEN
    RAISE EXCEPTION 'La nota de crédito % ya está anulada.', v_numero;
  END IF;

  SELECT id, entry_number, reference, transaction_date
    INTO v_orig_id, v_orig_nro, v_orig_ref, v_orig_date
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND source_type = 'nota_credito_proveedor' AND source_id = p_credit_note_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La nota de crédito % no tiene asiento: no hay nada que reversar.', v_numero;
  END IF;
  IF p_transaction_date < v_orig_date THEN
    RAISE EXCEPTION 'La reversión (%) no puede ser anterior al asiento que revierte (asiento %, %)',
      p_transaction_date, v_orig_nro, v_orig_date;
  END IF;
  SELECT entry_number INTO v_ya_nro FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND reverses_entry_id = v_orig_id LIMIT 1;
  IF v_ya_nro IS NOT NULL THEN
    RAISE EXCEPTION 'La nota de crédito % ya fue reversada por el asiento %.', v_numero, v_ya_nro;
  END IF;

  WITH esperado AS (
    SELECT c.code AS code, l.credit AS debit, l.debit AS credit
      FROM public.journal_entry_lines l JOIN public.chart_of_accounts c ON c.id = l.account_id
     WHERE l.entry_id = v_orig_id
  ), recibido AS (
    SELECT btrim(x->>'account_code') AS code,
           round(coalesce((x->>'debit')::numeric, 0), 2) AS debit,
           round(coalesce((x->>'credit')::numeric, 0), 2) AS credit
      FROM jsonb_array_elements(p_lines) x
  )
  SELECT count(*) INTO v_dif FROM (
    (SELECT code, debit, credit FROM esperado EXCEPT ALL SELECT code, debit, credit FROM recibido)
    UNION ALL
    (SELECT code, debit, credit FROM recibido EXCEPT ALL SELECT code, debit, credit FROM esperado)
  ) d;
  IF v_dif > 0 THEN
    RAISE EXCEPTION 'Las líneas recibidas no son el espejo exacto del asiento % de la nota de crédito %: se rechaza la reversión para no descuadrar el libro.',
      v_orig_nro, v_numero;
  END IF;

  v_entry_id := public.post_journal_entry(
    p_tenant_id, p_transaction_date, p_description, 'reversion', p_lines,
    p_credit_note_id, NULL, v_orig_id, btrim(p_reason), p_created_by, NULL, v_orig_ref, NULL
  );
  SELECT entry_number INTO v_entry_nro FROM public.journal_entries WHERE id = v_entry_id;

  -- UN estado. El trigger recalcula credited_total, balance_due y el status.
  UPDATE public.supplier_credit_notes
     SET status = 'anulada', cancelled_at = now(), cancellation_reason = btrim(p_reason)
   WHERE tenant_id = p_tenant_id AND id = p_credit_note_id;

  SELECT balance_due INTO v_balance FROM public.business_expenses WHERE id = v_compra;

  RETURN jsonb_build_object(
    'entry_id', v_entry_id, 'entry_number', v_entry_nro,
    'reversed_entry_number', v_orig_nro, 'transaction_date', p_transaction_date,
    'credit_note_number', v_numero, 'balance_due', v_balance
  );
END $fn$;

REVOKE EXECUTE ON FUNCTION public.create_supplier_credit_note(uuid, uuid, text, date, text, text, date, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_supplier_credit_note(uuid, uuid, text, date, text, text, date, jsonb, jsonb, uuid)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.reverse_supplier_credit_note(uuid, uuid, text, date, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_supplier_credit_note(uuid, uuid, text, date, text, jsonb, uuid)
  TO service_role;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
DO $$
DECLARE v_n int; v_mal int;
BEGIN
  IF to_regclass('public.supplier_credit_notes') IS NULL OR to_regclass('public.supplier_credit_note_lines') IS NULL THEN
    RAISE EXCEPTION '066: faltan las tablas';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'je_reversion_requires_ref') THEN
    RAISE EXCEPTION '066: se perdió je_reversion_requires_ref (el bug de la 028)';
  END IF;
  IF position('nota_credito_proveedor' IN (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                                            WHERE conname = 'journal_entries_source_type_check')) = 0 THEN
    RAISE EXCEPTION '066: el CHECK de source_type no admite nota_credito_proveedor';
  END IF;
  IF has_function_privilege('authenticated', 'public.create_supplier_credit_note(uuid, uuid, text, date, text, text, date, jsonb, jsonb, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reverse_supplier_credit_note(uuid, uuid, text, date, text, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '066: authenticated puede ejecutar los RPC de la NC de compra';
  END IF;
  -- Sin NC, balance_due tiene que ser exactamente total − amount_paid.
  SELECT count(*) INTO v_mal FROM public.business_expenses
   WHERE balance_due <> total - amount_paid - credited_total OR credited_total <> 0;
  IF v_mal > 0 THEN
    RAISE EXCEPTION '066: % compra(s) con saldo que no cierra', v_mal;
  END IF;
  SELECT count(*) INTO v_n FROM public.business_expenses;
  RAISE NOTICE '066 ✅ NC de compra: tablas, saldo derivado, RPC de alta y de reversión · % compra(s) intactas', v_n;
END $$;
