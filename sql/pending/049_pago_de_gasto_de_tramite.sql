-- ============================================================================
-- 049 — EL PAGO DE UN GASTO DE TRÁMITE: arco exclusivo en supplier_payments,
--       amount_paid/status derivados en `expenses`, RPC ramificado, y la 038
--       deja de congelar `supplier_id`.
-- ============================================================================
-- Bloque 4 (21/09/2026), commit 1. Diseño aprobado por Oliver (P1-P5, D1-D6):
--
--   · Josuarth: registrar el gasto y pagarlo son DOS transacciones, aunque
--     ocurran el mismo día. El gasto de trámite ya postea (038: DEBE 130003 /
--     HABER 200001). Faltaba el pago: HABER banco / DEBE 200001.
--   · El pago YA existe como entidad para las compras (`supplier_payments`,
--     048). Se REUTILIZA con un ARCO EXCLUSIVO —el mismo patrón que
--     `expense_lines` en la 036—: un pago apunta a una compra
--     (`business_expense_id`) O a un gasto de trámite (`expense_id`), nunca a
--     los dos ni a ninguno. UNA sola serie `CE-`, un solo comprobante de
--     egreso, un solo RPC de reversión.
--   · `expenses.amount_paid` y `expenses.status` se DERIVAN de los pagos por
--     trigger, con guard, igual que `business_expenses` en la 048 e
--     `invoices` en la 032: la columna no se escribe, se escribe el PAGO.
--   · `expenses.status` admite además `anulado`: es el estado de máquina que
--     escribe el RPC `reverse_expense_tramite` (migración 050, commit 2). El
--     recálculo no lo pisa y el guard lo deja pasar solo con su llave.
--
-- 🔴 `expenses.payment_account_code` (036) NO SE TOCA NI SE ESCRIBE. Es un
--    resto: nadie lo escribe, la 038 lo congela en cuanto hay asiento, y el
--    banco es del PAGO (FND-009). Sigue congelado en el trigger de la 038 a
--    propósito. Se dropea en una migración posterior (D3 de Oliver).
--
-- ⚠️ La FK `supplier_payments.expense_id → expenses` es NO ACTION, como la de
--    compras: un gasto con pagos no se borra; primero se eliminan (sin asiento)
--    o se reversan (con asiento). Consecuencia a saber: `expenses.case_id` tiene
--    ON DELETE CASCADE, así que borrar un CASO con un gasto pagado va a fallar
--    en esta FK. Es lo correcto —un caso con plata movida no se borra en
--    cascada— y se anota acá para que no se lea como un bug.
--
-- 📋 Columnas verificadas contra information_schema el 21/09 (regla de FND-009):
--   supplier_payments: business_expense_id uuid NOT NULL (FK
--     supplier_payments_business_expense_id_fkey), kind, payment_number,
--     payment_date, amount, currency, method, payment_account_code, reference,
--     notes, status, created_by, created_at, updated_at. Sin expense_id.
--   expenses: id, tenant_id, case_id, amount numeric, concept, date,
--     registered_by, created_at, expense_type, receipt_url, receipt_filename,
--     supplier_id, due_date, payment_account_code, posted_entry_id. Sin
--     amount_paid, sin status. CHECK expenses_expense_type_check
--     ('tramite','administrativo'). 0 gastos con amount <= 0 en staging.
--   Triggers hoy: trg_expenses_no_edit_si_asentado (038) en expenses;
--     trg_recalc_expense_amount_paid, trg_supplier_payment_status_transition,
--     trg_supplier_payments_updated_at en supplier_payments.
--
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS, DROP+ADD de CHECK, CREATE OR REPLACE
-- de funciones (misma firma del RPC: los GRANT de la 048 se conservan).
-- Re-ejecutable.
--
-- 📋 Pre-flight contra PRODUCCIÓN, el día que vaya (SELECT puros; NO en este bloque):
--   SELECT COUNT(*) FROM expenses WHERE amount <= 0;            -- tiene que dar 0
--   SELECT COUNT(*) FROM supplier_payments;                     -- todos con compra
--   Va DESPUÉS de la 036 (expenses.supplier_id/posted_entry_id), la 038 (el
--   trigger que acá se reescribe) y la 048 (supplier_payments).
--
-- Verificación: sql/tests/verificacion-049-pago-de-gasto-de-tramite.sql (ROLLBACK,
-- con falla forzada después del posteo).
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Arco exclusivo: un pago es de UNA compra o de UN gasto de trámite
-- ----------------------------------------------------------------------------
ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS expense_id uuid NULL REFERENCES public.expenses(id);

ALTER TABLE public.supplier_payments
  ALTER COLUMN business_expense_id DROP NOT NULL;

ALTER TABLE public.supplier_payments
  DROP CONSTRAINT IF EXISTS supplier_payments_destino_exclusivo;
ALTER TABLE public.supplier_payments
  ADD CONSTRAINT supplier_payments_destino_exclusivo
  CHECK (num_nonnulls(business_expense_id, expense_id) = 1);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_tramite
  ON public.supplier_payments(tenant_id, expense_id)
  WHERE expense_id IS NOT NULL;

COMMENT ON COLUMN public.supplier_payments.expense_id IS
  'Gasto de TRÁMITE que paga (módulo Legal, tabla expenses). Arco exclusivo con business_expense_id (049): exactamente uno de los dos.';
COMMENT ON COLUMN public.supplier_payments.business_expense_id IS
  'COMPRA del bufete que paga. Desde la 049 es NULL cuando el pago es de un gasto de trámite (expense_id).';

-- ----------------------------------------------------------------------------
-- 2. expenses.amount_paid + status derivados, y su guard
-- ----------------------------------------------------------------------------
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pendiente_pago';

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_amount_paid_range_check;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_amount_paid_range_check CHECK (amount_paid >= 0);

-- Los CUATRO valores: los tres derivados de los pagos + `anulado`, que es
-- estado de máquina (lo escribe el RPC de la 050, nunca el recálculo).
ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_status_check;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_status_check
  CHECK (status IN ('pendiente_pago', 'parcialmente_pagado', 'pagado', 'anulado'));

COMMENT ON COLUMN public.expenses.amount_paid IS
  'DERIVADA (049): SUM(supplier_payments.amount) con expense_id = este gasto y status registrado. No se escribe: se registra el PAGO.';
COMMENT ON COLUMN public.expenses.status IS
  'pendiente_pago / parcialmente_pagado / pagado los DERIVA el trigger de la 049 desde los pagos. anulado lo escribe reverse_expense_tramite (050) y el recálculo no lo pisa.';

-- El recálculo del lado TRÁMITE. Espejo de finanzas_recalc_one_expense_amount_paid
-- (048), con dos diferencias: el total es `expenses.amount` (no hay `total`
-- generado), y un gasto `anulado` conserva el estado (solo se actualiza el monto).
CREATE OR REPLACE FUNCTION public.finanzas_recalc_one_tramite_amount_paid(p_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_paid       numeric(12,2);
  v_total      numeric(12,2);
  v_status     text;
  v_new_status text;
BEGIN
  SELECT COALESCE(SUM(amount), 0)
    INTO v_paid
    FROM public.supplier_payments
   WHERE expense_id = p_expense_id AND status = 'registrado';

  SELECT amount, status INTO v_total, v_status
    FROM public.expenses WHERE id = p_expense_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_status = 'anulado' THEN
    v_new_status := 'anulado';
  ELSIF v_paid <= 0 THEN
    v_new_status := 'pendiente_pago';
  ELSIF v_paid >= v_total THEN
    v_new_status := 'pagado';
  ELSE
    v_new_status := 'parcialmente_pagado';
  END IF;

  PERFORM set_config('finanzas.recalc', 'on', true);
  UPDATE public.expenses
     SET amount_paid = v_paid,
         status      = v_new_status
   WHERE id = p_expense_id;
  PERFORM set_config('finanzas.recalc', 'off', true);
END;
$$;

COMMENT ON FUNCTION public.finanzas_recalc_one_tramite_amount_paid IS
  'T7a de gastos de trámite (049). ÚNICA vía normal para escribir expenses.amount_paid y derivar status. Se anuncia ante el guard con finanzas.recalc. Un gasto anulado conserva el estado.';

-- El trigger de supplier_payments se RAMIFICA por destino. Reemplaza al de la
-- 048 (misma función, mismo nombre de trigger): compra → recálculo de la 048;
-- gasto de trámite → el de arriba. Un UPDATE que mueva el pago de destino
-- recalcula los dos lados.
CREATE OR REPLACE FUNCTION public.finanzas_trg_recalc_expense_amount_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_compra  uuid := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.business_expense_id END;
  v_new_compra  uuid := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.business_expense_id END;
  v_old_tramite uuid := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.expense_id END;
  v_new_tramite uuid := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.expense_id END;
BEGIN
  IF v_old_compra IS NOT NULL AND v_old_compra IS DISTINCT FROM v_new_compra THEN
    PERFORM public.finanzas_recalc_one_expense_amount_paid(v_old_compra);
  END IF;
  IF v_new_compra IS NOT NULL THEN
    PERFORM public.finanzas_recalc_one_expense_amount_paid(v_new_compra);
  END IF;
  IF v_old_tramite IS NOT NULL AND v_old_tramite IS DISTINCT FROM v_new_tramite THEN
    PERFORM public.finanzas_recalc_one_tramite_amount_paid(v_old_tramite);
  END IF;
  IF v_new_tramite IS NOT NULL THEN
    PERFORM public.finanzas_recalc_one_tramite_amount_paid(v_new_tramite);
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_expense_amount_paid ON public.supplier_payments;
CREATE TRIGGER trg_recalc_expense_amount_paid
  AFTER INSERT OR UPDATE OR DELETE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_trg_recalc_expense_amount_paid();

-- El guard del lado trámite (T4b''). amount_paid y status NO se escriben a mano.
-- Tres llaves: finanzas.recalc (el trigger), finanzas.amount_paid_override
-- (restauraciones, SOP-017) y finanzas.tramite_anular (SOLO el RPC de la 050,
-- SOLO para poner 'anulado').
CREATE OR REPLACE FUNCTION public.finanzas_guard_tramite_amount_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_recalc   text := current_setting('finanzas.recalc', true);
  v_override text := current_setting('finanzas.amount_paid_override', true);
  v_anular   text := current_setting('finanzas.tramite_anular', true);
  v_ayuda    text :=
    '`expenses.amount_paid` y su `status` se DERIVAN de `supplier_payments` (049). '
    'Para pagar un gasto de trámite NO se escribe esta columna ni el status: se registra el PAGO '
    '(INSERT en `supplier_payments` con expense_id) y el trigger los deriva. '
    'Si esto es una restauración autorizada, la válvula es finanzas.amount_paid_override (SOP-017).';
BEGIN
  IF v_recalc = 'on' THEN
    RETURN NEW;
  END IF;
  IF v_override = 'on' THEN
    RAISE WARNING 'finanzas.amount_paid_override: escritura MANUAL de amount_paid/status en el gasto de trámite % (%). Ver sop.md SOP-017.',
      NEW.id, TG_OP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.amount_paid IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'El gasto de trámite no puede nacer con amount_paid = %. %', NEW.amount_paid, v_ayuda
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'pendiente_pago' THEN
      RAISE EXCEPTION 'El gasto de trámite no puede nacer con status = %. %', NEW.status, v_ayuda
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN
    RAISE EXCEPTION 'Escritura directa de amount_paid en el gasto de trámite % (% → %). %',
      OLD.id, OLD.amount_paid, NEW.amount_paid, v_ayuda
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- La única transición manual admitida: → anulado, y solo con la llave del RPC.
    IF NEW.status = 'anulado' AND v_anular = 'on' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Escritura directa del status en el gasto de trámite % (% → %). %',
      OLD.id, OLD.status, NEW.status, v_ayuda
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_tramite_amount_paid ON public.expenses;
CREATE TRIGGER trg_guard_tramite_amount_paid
  BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_guard_tramite_amount_paid();

-- ----------------------------------------------------------------------------
-- 3. reverse_supplier_payment ramificado por destino
-- ----------------------------------------------------------------------------
-- Misma firma que en la 048 (los GRANT/REVOKE se conservan con CREATE OR
-- REPLACE). Cambia: lee los dos destinos, y el objeto `expense` de la respuesta
-- dice de cuál se trata (`kind: 'compra' | 'tramite'`) y trae el estado del
-- documento correcto. El resto —motivo, fecha de hoy, espejo exacto, una sola
-- transacción— es idéntico.
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
  v_compra     uuid;
  v_tramite    uuid;
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

  SELECT status, kind, business_expense_id, expense_id
    INTO v_status, v_kind, v_compra, v_tramite
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

  -- Anular el pago: el trigger recalcula el documento que corresponda.
  UPDATE public.supplier_payments
     SET status = 'anulado'
   WHERE tenant_id = p_tenant_id AND id = p_payment_id;

  IF v_compra IS NOT NULL THEN
    SELECT status, amount_paid INTO v_exp_status, v_exp_paid
      FROM public.business_expenses WHERE id = v_compra;
    RETURN jsonb_build_object(
      'entry_id',              v_entry_id,
      'entry_number',          v_entry_nro,
      'reversed_entry_number', v_orig_nro,
      'transaction_date',      p_transaction_date,
      'expense', jsonb_build_object('kind', 'compra', 'id', v_compra, 'status', v_exp_status, 'amount_paid', v_exp_paid)
    );
  ELSE
    SELECT status, amount_paid INTO v_exp_status, v_exp_paid
      FROM public.expenses WHERE id = v_tramite;
    RETURN jsonb_build_object(
      'entry_id',              v_entry_id,
      'entry_number',          v_entry_nro,
      'reversed_entry_number', v_orig_nro,
      'transaction_date',      p_transaction_date,
      'expense', jsonb_build_object('kind', 'tramite', 'id', v_tramite, 'status', v_exp_status, 'amount_paid', v_exp_paid)
    );
  END IF;
END $$;

COMMENT ON FUNCTION public.reverse_supplier_payment IS
  'Reversa un pago a proveedor contabilizado en UNA transacción: postea el espejo (reverses_entry_id + motivo) y marca el pago anulado; el trigger devuelve el documento (compra o gasto de trámite, 049). Rechaza saldos heredados, líneas que no sean el espejo exacto y fechas que no sean hoy. SECURITY DEFINER, EXECUTE solo service_role.';

-- ----------------------------------------------------------------------------
-- 4. La 038 deja de congelar `supplier_id` (D2). `payment_account_code` SIGUE
--    congelado: nadie debe escribirle el banco (va en el pago).
-- ----------------------------------------------------------------------------
-- El proveedor no cambia el asiento del gasto (el crédito va a 200001 sin
-- auxiliar), y un gasto que nació sin ficha tiene que poder recibirla después
-- para los anexos de renta. `amount_paid` y `status` no están en esta lista
-- porque los escribe el trigger de arriba (y los protege su propio guard).
CREATE OR REPLACE FUNCTION public.reject_expense_mutation_si_asentado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_asiento bigint;
BEGIN
  v_asiento := public.gasto_tramite_tiene_asiento(OLD.id);
  IF v_asiento IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'El gasto % ya está registrado en el libro contable (asiento %) y no se puede borrar. Para corregirlo hace falta un asiento de reversión.',
      OLD.id, v_asiento
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Lo congelado con el gasto ya asentado: lo que el asiento lee, más
  -- payment_account_code (resto de la 036 que NO se escribe: el banco es del
  -- pago). Editables: comprobante, posted_entry_id, supplier_id (049),
  -- amount_paid y status (derivados, 049).
  IF ROW(
       NEW.case_id, NEW.amount, NEW.concept, NEW.date, NEW.expense_type,
       NEW.due_date, NEW.payment_account_code, NEW.tenant_id
     ) IS DISTINCT FROM ROW(
       OLD.case_id, OLD.amount, OLD.concept, OLD.date, OLD.expense_type,
       OLD.due_date, OLD.payment_account_code, OLD.tenant_id
     )
  THEN
    RAISE EXCEPTION
      'El gasto % ya está registrado en el libro contable (asiento %) y no se puede modificar. Solo se admite adjuntar o reemplazar el comprobante y asignar el proveedor. Para corregirlo hace falta un asiento de reversión.',
      OLD.id, v_asiento
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Verificación de cierre
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_col int; v_chk int; v_trg int; v_null int; v_arco int;
BEGIN
  SELECT count(*) INTO v_col FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'supplier_payments' AND column_name = 'expense_id')
       OR (table_name = 'expenses' AND column_name IN ('amount_paid', 'status')));
  SELECT count(*) INTO v_chk FROM pg_constraint
   WHERE conname IN ('supplier_payments_destino_exclusivo', 'expenses_status_check', 'expenses_amount_paid_range_check');
  SELECT count(*) INTO v_trg FROM pg_trigger
   WHERE tgname IN ('trg_recalc_expense_amount_paid', 'trg_guard_tramite_amount_paid', 'trg_expenses_no_edit_si_asentado');
  SELECT count(*) INTO v_null FROM information_schema.columns
   WHERE table_name = 'supplier_payments' AND column_name = 'business_expense_id' AND is_nullable = 'YES';
  SELECT count(*) INTO v_arco FROM supplier_payments WHERE num_nonnulls(business_expense_id, expense_id) <> 1;
  IF v_col <> 3 OR v_chk <> 3 OR v_trg <> 3 OR v_null <> 1 OR v_arco <> 0 THEN
    RAISE EXCEPTION '049: verificación fallida (columnas %, checks %, triggers %, business_expense_id nullable %, pagos fuera del arco %)',
      v_col, v_chk, v_trg, v_null, v_arco;
  END IF;
  RAISE NOTICE '049 ✅ arco exclusivo, expenses.amount_paid/status derivados, guard, RPC ramificado, 038 reabierta para supplier_id (% pagos existentes, todos con un solo destino)',
    (SELECT count(*) FROM supplier_payments);
END $$;

COMMIT;
