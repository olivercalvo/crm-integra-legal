-- ============================================================================
-- 048 — PAGOS A PROVEEDORES: el pago como entidad, parcial, uno por compra
-- ============================================================================
-- Bloque 3 (21/09/2026). Reglas de Josuarth (21/09): pago PARCIAL a un
-- proveedor SÍ; un pago cubre UNA compra, no varias. O sea: varios pagos por
-- compra, cada pago apunta a una sola compra. Sin tabla N:M.
--
-- Hasta hoy "pagar" una compra era un cambio de estado de `business_expenses`
-- (`markBusinessExpenseAsPaid`), que además escribía una columna que la tabla
-- no tiene (FND-009). Esta migración deja:
--
--   1. `supplier_payments`: el pago, con el BANCO en el pago (no en la compra).
--      `kind` distingue un pago registrado (`payment`) de un SALDO HEREDADO de
--      esta migración (`migrated_balance`), ver el punto 5.
--   2. `business_expenses.amount_paid`, DERIVADA por trigger de los pagos
--      `registrado` (el criterio de T7a en facturas), que también deriva el
--      `status`: `pendiente_pago` → `parcialmente_pagado` → `pagado`. Y un guard
--      (el criterio de T4b) que rechaza escribirla desde fuera del trigger.
--   3. El CHECK de `status` con los tres valores, y `payment_date_consistency`
--      reescrito: `payment_date` = fecha del último pago registrado, o NULL.
--   4. La secuencia `'supplier_payment'` (CE-000001) en `numbering_sequences`
--      —CHECK re-declarado con los OCHO valores— y `documents` acepta el
--      comprobante de egreso en PDF.
--   5. El backfill: cada compra `pagado` sin pagos recibe UN `supplier_payment`
--      `migrated_balance` por su total. NO es un pago: no tiene número, ni
--      banco, ni método, ni comprobante. Ver abajo.
--   6. El RPC `reverse_supplier_payment`: espejo + `anulado`, una transacción.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 EL BACKFILL NO INVENTA PAGOS (objeción de Oliver, 21/09/2026)
-- ─────────────────────────────────────────────────────────────────────────────
-- En cobros, los cobros existentes eran reales y numerarlos era darle su recibo
-- a algo que ya había pasado. Acá la mayoría de las compras están en `pagado`
-- por el DEFAULT de la 010 (y en staging las tres nacieron `pagado` en el alta,
-- sin pago detrás — verificado en audit_log). Un CE-000001 que diga "se pagó
-- B/. X el día Y por el banco Z" para eso es un documento inventado, y va a
-- terminar impreso frente a un proveedor o a la DGI.
--
-- Así que el saldo heredado existe (hace falta para que `amount_paid` derive y
-- la antigüedad no se llene de deuda que ya no existe) pero es IDENTIFICABLE
-- como lo que es: `kind = 'migrated_balance'`, y el CHECK
-- `supplier_payments_kind_consistency` hace imposible que tenga número, banco o
-- método, ni por error. Un `payment_number IS NULL` solo no alcanzaba para
-- distinguirlo (los cobros anteriores a la 047 también lo tenían en NULL).
-- Se puede ELIMINAR (es la corrección honesta si la compra nunca se pagó: T7a'
-- devuelve la compra a `pendiente_pago`); no se reversa (no hay asiento); no
-- tiene PDF (la ruta responde 409).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 COLUMNAS VERIFICADAS CONTRA information_schema, NO CONTRA COMENTARIOS
-- ─────────────────────────────────────────────────────────────────────────────
-- FND-009 nació de un comentario que decía que `business_expenses` tenía
-- `payment_account_code` "desde la 036". No la tiene: la 036 se la dio a
-- `expenses` y la 041 a `payments`. Verificado el 21/09 en staging:
-- `business_expenses` tiene `status`, `payment_date`, `payment_method`, `total`
-- y NO tiene `amount_paid`, `payment_account_code` ni `kind`. Todo lo que esta
-- migración agrega es `IF NOT EXISTS`.
--
-- IDEMPOTENCIA: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP+ADD de CHECK, backfill que inserta SOLO donde no hay pagos. Re-ejecutable.
--
-- 📋 Pre-flight contra PRODUCCIÓN, el día que vaya (SELECT puros):
--   SELECT status, COUNT(*), SUM(total) FROM business_expenses GROUP BY 1;
--   -- Cuántos saldos heredados va a crear (los `pagado`). Anotar el número.
--   SELECT COUNT(*) FROM business_expenses WHERE status='pagado' AND total <= 0;
--   -- Tiene que dar 0: un saldo heredado por 0 no se puede insertar (amount > 0)
--   -- y la compra quedaría `pendiente_pago` con total 0. Si hay, mirarlas antes.
--   Va DESPUÉS de la 047 (re-declara el CHECK de numbering_sequences y los de
--   documents con sus valores) y de la 039 (firma de post_journal_entry).
--
-- Verificación: sql/tests/verificacion-048-pagos-a-proveedores.sql (ROLLBACK).
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. supplier_payments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT public.get_tenant_id()
                          REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- NO ACTION: una compra con pagos no se borra; primero se eliminan (sin
  -- asiento) o se reversan (con asiento) los pagos.
  business_expense_id   uuid NOT NULL REFERENCES public.business_expenses(id),
  -- 'payment': un pago registrado, con número, banco y método.
  -- 'migrated_balance': el saldo heredado del backfill de esta migración.
  kind                  text NOT NULL DEFAULT 'payment',
  -- CE-000001. NULL solo en los saldos heredados (CHECK abajo).
  payment_number        text NULL,
  payment_date          date NOT NULL,
  amount                numeric(12,2) NOT NULL,
  currency              text NOT NULL DEFAULT 'USD',
  method                text NULL,
  -- La cuenta del plan de donde SALIÓ la plata. Obligatoria en un pago
  -- registrado: es lo que el asiento acredita y no se puede deducir.
  payment_account_code  text NULL,
  reference             text NULL,
  notes                 text NULL,
  status                text NOT NULL DEFAULT 'registrado',
  created_by            uuid NULL REFERENCES public.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT supplier_payments_kind_check
    CHECK (kind IN ('payment', 'migrated_balance')),
  CONSTRAINT supplier_payments_status_check
    CHECK (status IN ('registrado', 'anulado')),
  CONSTRAINT supplier_payments_method_check
    CHECK (method IS NULL OR method IN ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'ach', 'otro')),
  CONSTRAINT supplier_payments_currency_check
    CHECK (currency = 'USD'),
  CONSTRAINT supplier_payments_amount_positive_check
    CHECK (amount > 0),
  CONSTRAINT supplier_payments_reference_length_check
    CHECK (reference IS NULL OR char_length(reference) <= 200),
  CONSTRAINT supplier_payments_notes_length_check
    CHECK (notes IS NULL OR char_length(notes) <= 1000),
  -- 🔴 Un saldo heredado NO puede parecer un pago; un pago NO puede carecer de
  -- número ni de banco. Es lo que hace imposible el documento inventado.
  CONSTRAINT supplier_payments_kind_consistency
    CHECK (
      (kind = 'migrated_balance'
         AND payment_number IS NULL AND payment_account_code IS NULL AND method IS NULL)
      OR
      (kind = 'payment'
         AND payment_number IS NOT NULL AND payment_account_code IS NOT NULL AND method IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_tenant
  ON public.supplier_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_expense
  ON public.supplier_payments(tenant_id, business_expense_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_date
  ON public.supplier_payments(tenant_id, payment_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_payments_tenant_payment_number_key
  ON public.supplier_payments(tenant_id, payment_number)
  WHERE payment_number IS NOT NULL;

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_payments_tenant_isolation ON public.supplier_payments;
CREATE POLICY supplier_payments_tenant_isolation ON public.supplier_payments
  FOR ALL USING (tenant_id = public.get_tenant_id());

DROP TRIGGER IF EXISTS trg_supplier_payments_updated_at ON public.supplier_payments;
CREATE TRIGGER trg_supplier_payments_updated_at
  BEFORE UPDATE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Transición de estado: solo registrado → anulado. Un pago anulado no vuelve
-- (se registra otro). Espeja T3 de payments.
CREATE OR REPLACE FUNCTION public.finanzas_supplier_payment_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT (OLD.status = 'registrado' AND NEW.status = 'anulado') THEN
      RAISE EXCEPTION 'Transición de estado no permitida en el pago a proveedor: % → %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_payment_status_transition ON public.supplier_payments;
CREATE TRIGGER trg_supplier_payment_status_transition
  BEFORE UPDATE OF status ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_supplier_payment_status_transition();

COMMENT ON TABLE public.supplier_payments IS
  'Pagos a proveedores (Bloque 3, 048). Uno por compra, parciales permitidos. kind=payment es un pago registrado (número CE-, banco, método); kind=migrated_balance es el saldo heredado del backfill de la 048: no es un pago, no tiene comprobante, se puede eliminar, no se reversa.';
COMMENT ON COLUMN public.supplier_payments.kind IS
  'payment | migrated_balance. Un migrated_balance NO puede tener número, banco ni método (CHECK). Ver el encabezado de la 048.';

-- ----------------------------------------------------------------------------
-- 2. business_expenses.amount_paid + status derivados (T7a'), y su guard (T4b')
-- ----------------------------------------------------------------------------
ALTER TABLE public.business_expenses
  ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.business_expenses
  DROP CONSTRAINT IF EXISTS business_expenses_status_check;
ALTER TABLE public.business_expenses
  ADD CONSTRAINT business_expenses_status_check
  CHECK (status IN ('pendiente_pago', 'parcialmente_pagado', 'pagado'));

-- `payment_date` pasa a ser "la fecha del último pago registrado, o NULL sin
-- pagos". La escribe el trigger. La regla vieja (pendiente ⇒ NULL) sigue
-- valiendo y se extiende a los otros dos estados.
ALTER TABLE public.business_expenses
  DROP CONSTRAINT IF EXISTS business_expenses_payment_date_consistency_check;
ALTER TABLE public.business_expenses
  ADD CONSTRAINT business_expenses_payment_date_consistency_check
  CHECK (
    (status = 'pendiente_pago' AND payment_date IS NULL)
    OR status IN ('parcialmente_pagado', 'pagado')
  );

ALTER TABLE public.business_expenses
  DROP CONSTRAINT IF EXISTS business_expenses_amount_paid_range_check;
ALTER TABLE public.business_expenses
  ADD CONSTRAINT business_expenses_amount_paid_range_check
  CHECK (amount_paid >= 0);

CREATE OR REPLACE FUNCTION public.finanzas_recalc_one_expense_amount_paid(p_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_paid       numeric(12,2);
  v_last_date  date;
  v_total      numeric(12,2);
  v_status     text;
  v_new_status text;
BEGIN
  SELECT COALESCE(SUM(amount), 0), MAX(payment_date)
    INTO v_paid, v_last_date
    FROM public.supplier_payments
   WHERE business_expense_id = p_expense_id AND status = 'registrado';

  SELECT total, status INTO v_total, v_status
    FROM public.business_expenses WHERE id = p_expense_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_paid <= 0 THEN
    v_new_status := 'pendiente_pago';
    v_last_date  := NULL;
  ELSIF v_paid >= v_total THEN
    v_new_status := 'pagado';
  ELSE
    v_new_status := 'parcialmente_pagado';
  END IF;

  -- La llave de T4b'. Mismo flag que T7a: es la vía normal del sistema.
  PERFORM set_config('finanzas.recalc', 'on', true);
  UPDATE public.business_expenses
     SET amount_paid  = v_paid,
         status       = v_new_status,
         payment_date = v_last_date
   WHERE id = p_expense_id;
  PERFORM set_config('finanzas.recalc', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.finanzas_trg_recalc_expense_amount_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.finanzas_recalc_one_expense_amount_paid(OLD.business_expense_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.business_expense_id IS DISTINCT FROM NEW.business_expense_id THEN
    PERFORM public.finanzas_recalc_one_expense_amount_paid(OLD.business_expense_id);
    PERFORM public.finanzas_recalc_one_expense_amount_paid(NEW.business_expense_id);
    RETURN NEW;
  ELSE
    PERFORM public.finanzas_recalc_one_expense_amount_paid(NEW.business_expense_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_expense_amount_paid ON public.supplier_payments;
CREATE TRIGGER trg_recalc_expense_amount_paid
  AFTER INSERT OR UPDATE OR DELETE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_trg_recalc_expense_amount_paid();

COMMENT ON FUNCTION public.finanzas_recalc_one_expense_amount_paid IS
  'T7a de compras (048). ÚNICA vía normal para escribir business_expenses.amount_paid: SUM(supplier_payments registrado), deriva status (pendiente_pago / parcialmente_pagado / pagado) y payment_date (último pago). Se anuncia ante el guard con finanzas.recalc.';

-- El guard: amount_paid y status NO se escriben a mano. Mismo mecanismo que
-- T4b en facturas (032): flag finanzas.recalc para el trigger, válvula
-- finanzas.amount_paid_override para restauraciones (SOP-017).
CREATE OR REPLACE FUNCTION public.finanzas_guard_expense_amount_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_recalc   text := current_setting('finanzas.recalc', true);
  v_override text := current_setting('finanzas.amount_paid_override', true);
  v_ayuda    text :=
    '`business_expenses.amount_paid` y su `status` se DERIVAN de `supplier_payments` (048). '
    'Para pagar una compra NO se escribe esta columna ni el status: se registra el PAGO '
    '(INSERT en `supplier_payments`) y el trigger los deriva. '
    'Si esto es una restauración autorizada, la válvula es finanzas.amount_paid_override (SOP-017).';
BEGIN
  IF v_recalc = 'on' THEN
    RETURN NEW;
  END IF;
  IF v_override = 'on' THEN
    RAISE WARNING 'finanzas.amount_paid_override: escritura MANUAL de amount_paid/status en la compra % (%). Ver sop.md SOP-017.',
      NEW.id, TG_OP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.amount_paid IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'La compra no puede nacer con amount_paid = %. %', NEW.amount_paid, v_ayuda
        USING ERRCODE = 'check_violation';
    END IF;
    -- Una compra nace `pendiente_pago`. "Ya está pagada" en el alta significa
    -- registrar el pago después de crearla, no nacer con el status puesto.
    IF NEW.status <> 'pendiente_pago' THEN
      RAISE EXCEPTION 'La compra no puede nacer con status = %. %', NEW.status, v_ayuda
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN
    RAISE EXCEPTION 'Escritura directa de amount_paid en la compra % (% → %). %',
      OLD.id, OLD.amount_paid, NEW.amount_paid, v_ayuda
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Escritura directa del status en la compra % (% → %). %',
      OLD.id, OLD.status, NEW.status, v_ayuda
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_amount_paid ON public.business_expenses;
CREATE TRIGGER trg_guard_expense_amount_paid
  BEFORE INSERT OR UPDATE ON public.business_expenses
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_guard_expense_amount_paid();

-- ----------------------------------------------------------------------------
-- 3. Numeración CE- y documents
-- ----------------------------------------------------------------------------
-- Los SIETE valores de la 047 más este. Re-declarado completo.
ALTER TABLE public.numbering_sequences
  DROP CONSTRAINT IF EXISTS numbering_sequences_sequence_type_check;
ALTER TABLE public.numbering_sequences
  ADD CONSTRAINT numbering_sequences_sequence_type_check
  CHECK (sequence_type = ANY (ARRAY[
    'quote','invoice_hon','invoice_reim','credit_note','client','supplier','payment','supplier_payment'
  ]));

INSERT INTO public.numbering_sequences (tenant_id, sequence_type, last_number)
SELECT t.id, 'supplier_payment', 0 FROM public.tenants t
ON CONFLICT (tenant_id, sequence_type) DO NOTHING;

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_entity_type_check;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_entity_type_check
  CHECK (entity_type IN ('client', 'case', 'task', 'comment', 'quote', 'invoice', 'payment', 'supplier_payment'));

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_source_check;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_source_check
  CHECK (source IN (
    'manual',
    'auto_quote_pdf',
    'auto_invoice_pdf',
    'auto_signed_quote_pdf',
    'auto_receipt_pdf',
    'auto_supplier_payment_pdf'
  ));

-- ----------------------------------------------------------------------------
-- 4. El backfill: saldos heredados, NO pagos
-- ----------------------------------------------------------------------------
-- Una fila `migrated_balance` por cada compra `pagado` que no tenga ningún
-- supplier_payment. `amount = total`, `payment_date` = la que tenía o la de la
-- compra. Sin número, sin banco, sin método (el CHECK lo garantiza). Idempotente:
-- la segunda corrida no encuentra compras sin pagos.
--
-- Se hace con el guard apagado por la VÁLVULA y no por el flag del trigger, a
-- propósito: en el log de Postgres tiene que verse que esto fue una migración,
-- no la operación normal. Los WARNING que salgan son la huella esperada.
DO $$
DECLARE
  r     record;
  v_n   integer := 0;
BEGIN
  PERFORM set_config('finanzas.amount_paid_override', 'on', true);
  FOR r IN
    SELECT b.id, b.tenant_id, b.total, COALESCE(b.payment_date, b.expense_date) AS fecha, b.created_by
      FROM public.business_expenses b
     WHERE b.status = 'pagado'
       AND b.total > 0
       AND NOT EXISTS (SELECT 1 FROM public.supplier_payments sp WHERE sp.business_expense_id = b.id)
  LOOP
    INSERT INTO public.supplier_payments
      (tenant_id, business_expense_id, kind, payment_number, payment_date, amount,
       method, payment_account_code, reference, notes, status, created_by)
    VALUES
      (r.tenant_id, r.id, 'migrated_balance', NULL, r.fecha, r.total,
       NULL, NULL, NULL,
       'Saldo heredado de la migración 048: la compra estaba marcada como pagada antes de que existieran los pagos a proveedor. No es un pago registrado.',
       'registrado', r.created_by);
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('finanzas.amount_paid_override', 'off', true);
  RAISE NOTICE '048: % saldos heredados creados (compras que ya estaban pagadas)', v_n;

  -- Y las compras que NO estaban pagadas nacen con amount_paid 0, que ya es el
  -- default. Nada que hacer; el trigger tomará el mando desde el primer pago.
END $$;

-- ----------------------------------------------------------------------------
-- 5. Numeración de pagos, como función (la llama el seed también)
-- ----------------------------------------------------------------------------
-- Numera SOLO kind='payment' con número NULL. Hoy no hay ninguno (los heredados
-- no se numeran nunca); existe por simetría con la 047 y por si un día hace
-- falta. Idempotente.
CREATE OR REPLACE FUNCTION public.backfill_supplier_payment_numbers(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last integer;
  v_max  integer;
  v_n    integer := 0;
  r      record;
BEGIN
  INSERT INTO numbering_sequences (tenant_id, sequence_type, last_number)
  VALUES (p_tenant_id, 'supplier_payment', 0)
  ON CONFLICT (tenant_id, sequence_type) DO NOTHING;

  SELECT last_number INTO v_last
    FROM numbering_sequences
   WHERE tenant_id = p_tenant_id AND sequence_type = 'supplier_payment'
   FOR UPDATE;

  SELECT COALESCE(MAX(substring(payment_number from '^CE-(\d{6})$')::integer), 0)
    INTO v_max
    FROM supplier_payments
   WHERE tenant_id = p_tenant_id AND payment_number ~ '^CE-\d{6}$';
  v_last := GREATEST(v_last, v_max);

  FOR r IN
    SELECT id FROM supplier_payments
     WHERE tenant_id = p_tenant_id AND kind = 'payment' AND payment_number IS NULL
     ORDER BY payment_date, created_at, id
  LOOP
    v_last := v_last + 1;
    UPDATE supplier_payments SET payment_number = 'CE-' || lpad(v_last::text, 6, '0') WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;

  UPDATE numbering_sequences
     SET last_number = v_last, updated_at = now()
   WHERE tenant_id = p_tenant_id AND sequence_type = 'supplier_payment';
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.backfill_supplier_payment_numbers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_supplier_payment_numbers(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. reverse_supplier_payment — espejo + anulado, UNA transacción
-- ----------------------------------------------------------------------------
-- Más corto que reverse_payment (046) porque no hay aplicaciones que
-- fotografiar ni borrar: el trigger T7a' devuelve la compra al anular el pago.
-- Mismas verificaciones: motivo, fecha de hoy, el espejo EXACTO del original.
CREATE OR REPLACE FUNCTION public.reverse_supplier_payment(
  p_tenant_id        uuid,
  p_payment_id       uuid,
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
AS $$
DECLARE
  v_status     text;
  v_kind       text;
  v_expense    uuid;
  v_orig_id    uuid;
  v_orig_nro   bigint;
  v_orig_ref   text;
  v_orig_date  date;
  v_ya_nro     bigint;
  v_dif        int;
  v_entry_id   uuid;
  v_entry_nro  bigint;
  v_exp_status text;
  v_exp_paid   numeric;
BEGIN
  IF p_tenant_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'reverse_supplier_payment: faltan el tenant o el pago';
  END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'La reversión necesita un motivo de al menos 3 caracteres (DE 34/1998 Art. 5.7)';
  END IF;
  IF p_transaction_date IS NULL OR abs(p_transaction_date - current_date) > 1 THEN
    RAISE EXCEPTION 'La reversión lleva la fecha en que se hace (hoy, %), nunca otra: llegó %',
      current_date, coalesce(p_transaction_date::text, 'NULL');
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'reverse_supplier_payment: las líneas del espejo deben venir como un array JSON de al menos 2';
  END IF;

  SELECT status, kind, business_expense_id INTO v_status, v_kind, v_expense
    FROM public.supplier_payments
   WHERE tenant_id = p_tenant_id AND id = p_payment_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago no encontrado';
  END IF;
  IF v_kind = 'migrated_balance' THEN
    RAISE EXCEPTION 'Este movimiento es un saldo heredado de la migración, no un pago registrado: no tiene asiento que reversar. Si la compra no estaba pagada, elimínelo.';
  END IF;
  IF v_status = 'anulado' THEN
    RAISE EXCEPTION 'Este pago ya está anulado.';
  END IF;

  SELECT id, entry_number, reference, transaction_date
    INTO v_orig_id, v_orig_nro, v_orig_ref, v_orig_date
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND source_type = 'pago_proveedor' AND source_id = p_payment_id;
  IF v_orig_id IS NULL THEN
    RAISE EXCEPTION 'Este pago no está en el libro contable, así que no hay nada que reversar. Un pago sin asiento se elimina.';
  END IF;
  IF p_transaction_date < v_orig_date THEN
    RAISE EXCEPTION 'La reversión (%) no puede ser anterior al asiento que revierte (asiento %, %)',
      p_transaction_date, v_orig_nro, v_orig_date;
  END IF;

  SELECT entry_number INTO v_ya_nro
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND reverses_entry_id = v_orig_id
   LIMIT 1;
  IF v_ya_nro IS NOT NULL THEN
    RAISE EXCEPTION 'El asiento % ya fue reversado por el asiento %.', v_orig_nro, v_ya_nro;
  END IF;

  WITH esperado AS (
    SELECT c.code AS code, l.credit AS debit, l.debit AS credit
      FROM public.journal_entry_lines l
      JOIN public.chart_of_accounts c ON c.id = l.account_id
     WHERE l.entry_id = v_orig_id
  ), recibido AS (
    SELECT btrim(x->>'account_code')                      AS code,
           round(coalesce((x->>'debit')::numeric, 0), 2)  AS debit,
           round(coalesce((x->>'credit')::numeric, 0), 2) AS credit
      FROM jsonb_array_elements(p_lines) x
  )
  SELECT count(*) INTO v_dif
    FROM (
      (SELECT code, debit, credit FROM esperado EXCEPT ALL SELECT code, debit, credit FROM recibido)
      UNION ALL
      (SELECT code, debit, credit FROM recibido EXCEPT ALL SELECT code, debit, credit FROM esperado)
    ) d;
  IF v_dif > 0 THEN
    RAISE EXCEPTION
      'Las líneas recibidas no son el espejo exacto del asiento %: se rechaza la reversión para no descuadrar el libro.',
      v_orig_nro;
  END IF;

  v_entry_id := public.post_journal_entry(
    p_tenant_id, p_transaction_date, p_description, 'reversion', p_lines,
    p_payment_id, NULL, v_orig_id, btrim(p_reason), p_created_by, NULL, v_orig_ref, NULL
  );
  SELECT entry_number INTO v_entry_nro FROM public.journal_entries WHERE id = v_entry_id;

  -- Anular el pago: T7a' recalcula la compra (amount_paid, status, payment_date).
  UPDATE public.supplier_payments
     SET status = 'anulado'
   WHERE tenant_id = p_tenant_id AND id = p_payment_id;

  SELECT status, amount_paid INTO v_exp_status, v_exp_paid
    FROM public.business_expenses WHERE id = v_expense;

  RETURN jsonb_build_object(
    'entry_id',              v_entry_id,
    'entry_number',          v_entry_nro,
    'reversed_entry_number', v_orig_nro,
    'transaction_date',      p_transaction_date,
    'expense', jsonb_build_object('id', v_expense, 'status', v_exp_status, 'amount_paid', v_exp_paid)
  );
END $$;

REVOKE EXECUTE ON FUNCTION
  public.reverse_supplier_payment(uuid, uuid, text, date, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.reverse_supplier_payment(uuid, uuid, text, date, text, jsonb, uuid)
  TO service_role;

COMMENT ON FUNCTION public.reverse_supplier_payment IS
  'Reversa un pago a proveedor contabilizado en UNA transacción: postea el espejo (reverses_entry_id + motivo) y marca el pago anulado; el trigger de la 048 devuelve la compra. Rechaza saldos heredados, líneas que no sean el espejo exacto y fechas que no sean hoy. SECURITY DEFINER, EXECUTE solo service_role.';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN RÁPIDA (post-aplicación)
-- ============================================================================
-- SELECT kind, status, COUNT(*), SUM(amount) FROM supplier_payments GROUP BY 1,2;
-- SELECT status, COUNT(*), SUM(total), SUM(amount_paid) FROM business_expenses GROUP BY 1;
-- -- Toda compra 'pagado' tiene amount_paid >= total; toda 'pendiente_pago' tiene 0.
--
-- ROLLBACK (manual, si hiciera falta):
-- DROP FUNCTION IF EXISTS public.reverse_supplier_payment(uuid,uuid,text,date,text,jsonb,uuid);
-- DROP FUNCTION IF EXISTS public.backfill_supplier_payment_numbers(uuid);
-- DROP TRIGGER IF EXISTS trg_guard_expense_amount_paid ON business_expenses;
-- DROP TRIGGER IF EXISTS trg_recalc_expense_amount_paid ON supplier_payments;
-- DROP TABLE IF EXISTS supplier_payments;
-- ALTER TABLE business_expenses DROP COLUMN IF EXISTS amount_paid;
-- (los CHECK vuelven a su lista anterior re-declarándolos: ver 010 y 047)
-- ============================================================================
