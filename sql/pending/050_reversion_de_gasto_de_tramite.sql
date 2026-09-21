-- ============================================================================
-- 050 — REVERSAR UN GASTO DE TRÁMITE CONTABILIZADO: RPC reverse_expense_tramite.
-- ============================================================================
-- Bloque 4 (21/09/2026), commit 2. Va ANTES del posteo automático (D6 de
-- Oliver): "no quiero que la inmutabilidad exista un solo commit sin salida".
-- Desde la 038 un gasto de trámite con asiento no se edita ni se borra; hasta
-- hoy la única corrección era un asiento manual a mano. Esto es la salida.
--
-- Espejo de reverse_payment (046) y reverse_supplier_payment (048/049):
--   · motivo obligatorio (DE 34/1998 Art. 5.7), fecha de HOY, líneas que sean
--     el espejo EXACTO del original (EXCEPT ALL en los dos sentidos: el RPC
--     verifica, no construye);
--   · post_journal_entry del espejo con source_type 'reversion', source_id = el
--     gasto, reverses_entry_id = el asiento original;
--   · `expenses.status = 'anulado'`, con la llave finanzas.tramite_anular que
--     el guard de la 049 reconoce. El recálculo de pagos no lo pisa.
--   · UNA transacción: si algo falla después del posteo, se deshace todo,
--     incluido el correlativo.
--
-- 🔴 Un gasto CON PAGOS REGISTRADOS no se reversa: primero se eliminan (sin
--    asiento) o se reversan (con asiento) sus pagos. Reversar el gasto con la
--    plata ya salida dejaría 200001 debitado por un pago de una deuda que el
--    libro dice que no existió.
--
-- Qué NO hace: no borra el gasto ni sus líneas (038), no toca posted_entry_id
-- (sigue apuntando al asiento original: es la trazabilidad), no devuelve el
-- comprobante. El gasto queda visible como ANULADO con su espejo.
--
-- 📋 Verificado contra information_schema el 21/09: expenses.status y
--    amount_paid existen desde la 049; journal_entries tiene reverses_entry_id,
--    reversal_reason, reference (046/039). Firma de post_journal_entry: 13
--    parámetros (039).
--
-- IDEMPOTENCIA: CREATE OR REPLACE. Re-ejecutable.
-- Verificación: sql/tests/verificacion-050-reversion-de-gasto-de-tramite.sql
-- (ROLLBACK, con falla forzada después del posteo).
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.reverse_expense_tramite(
  p_tenant_id        uuid,
  p_expense_id       uuid,
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
  v_paid       numeric;
  v_pagos      int;
  v_orig_id    uuid;
  v_orig_nro   bigint;
  v_orig_ref   text;
  v_orig_date  date;
  v_ya_nro     bigint;
  v_dif        int;
  v_entry_id   uuid;
  v_entry_nro  bigint;
BEGIN
  IF p_tenant_id IS NULL OR p_expense_id IS NULL THEN
    RAISE EXCEPTION 'reverse_expense_tramite: faltan el tenant o el gasto';
  END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'La reversión necesita un motivo de al menos 3 caracteres (DE 34/1998 Art. 5.7)';
  END IF;
  IF p_transaction_date IS NULL OR abs(p_transaction_date - current_date) > 1 THEN
    RAISE EXCEPTION 'La reversión lleva la fecha en que se hace (hoy, %), nunca otra: llegó %',
      current_date, coalesce(p_transaction_date::text, 'NULL');
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'reverse_expense_tramite: las líneas del espejo deben venir como un array JSON de al menos 2';
  END IF;

  SELECT status, amount_paid INTO v_status, v_paid
    FROM public.expenses
   WHERE tenant_id = p_tenant_id AND id = p_expense_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gasto no encontrado';
  END IF;
  IF v_status = 'anulado' THEN
    RAISE EXCEPTION 'Este gasto ya está anulado.';
  END IF;

  SELECT count(*) INTO v_pagos
    FROM public.supplier_payments
   WHERE tenant_id = p_tenant_id AND expense_id = p_expense_id AND status = 'registrado';
  IF v_pagos > 0 OR coalesce(v_paid, 0) > 0 THEN
    RAISE EXCEPTION 'Este gasto tiene % pago(s) registrado(s) por B/. %. Primero elimine (sin asiento) o reverse (con asiento) los pagos; después se reversa el gasto.',
      v_pagos, v_paid;
  END IF;

  SELECT id, entry_number, reference, transaction_date
    INTO v_orig_id, v_orig_nro, v_orig_ref, v_orig_date
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND source_type = 'gasto_tramite' AND source_id = p_expense_id;
  IF v_orig_id IS NULL THEN
    RAISE EXCEPTION 'Este gasto no está en el libro contable, así que no hay nada que reversar. Un gasto sin asiento se edita o se elimina.';
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
    p_expense_id, NULL, v_orig_id, btrim(p_reason), p_created_by, NULL, v_orig_ref, NULL
  );
  SELECT entry_number INTO v_entry_nro FROM public.journal_entries WHERE id = v_entry_id;

  -- Anular el gasto. La llave es la de la 049; el trigger de la 038 no congela status.
  PERFORM set_config('finanzas.tramite_anular', 'on', true);
  UPDATE public.expenses
     SET status = 'anulado'
   WHERE tenant_id = p_tenant_id AND id = p_expense_id;
  PERFORM set_config('finanzas.tramite_anular', 'off', true);

  RETURN jsonb_build_object(
    'entry_id',              v_entry_id,
    'entry_number',          v_entry_nro,
    'reversed_entry_number', v_orig_nro,
    'transaction_date',      p_transaction_date,
    'expense', jsonb_build_object('id', p_expense_id, 'status', 'anulado')
  );
END $$;

REVOKE EXECUTE ON FUNCTION
  public.reverse_expense_tramite(uuid, uuid, text, date, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.reverse_expense_tramite(uuid, uuid, text, date, text, jsonb, uuid)
  TO service_role;

COMMENT ON FUNCTION public.reverse_expense_tramite IS
  'Reversa un gasto de trámite contabilizado en UNA transacción: postea el espejo (reverses_entry_id + motivo, fecha de hoy) y marca el gasto anulado (llave finanzas.tramite_anular de la 049). Rechaza gastos con pagos registrados, líneas que no sean el espejo exacto y fechas que no sean hoy. SECURITY DEFINER, EXECUTE solo service_role: confía en p_tenant_id, que la ruta saca del usuario autenticado.';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'reverse_expense_tramite';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '050: se esperaba una firma de reverse_expense_tramite, hay %', v_n;
  END IF;
  IF has_function_privilege('anon', 'public.reverse_expense_tramite(uuid, uuid, text, date, text, jsonb, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reverse_expense_tramite(uuid, uuid, text, date, text, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '050: anon o authenticated pueden ejecutar el RPC; solo service_role debe poder';
  END IF;
  RAISE NOTICE '050 ✅ reverse_expense_tramite creada, EXECUTE solo service_role';
END $$;

COMMIT;
