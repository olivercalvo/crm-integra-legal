-- ============================================================================
-- 052 — ANULAR UNA FACTURA CON REVERSIÓN, y la válvula de compensación de la NC.
-- ============================================================================
-- Bloque 5, commit 3 (22/09/2026). Diseño aprobado (D4, D5):
--
--   · Anular dentro del mes = NC total automática (la crea la app,
--     `createCreditNoteFromInvoice`) + REVERSIÓN del asiento original con la
--     fecha de hoy + `status = anulada`. La reversión y el status van en UNA
--     transacción, acá: RPC `cancel_invoice_with_reversal`. La NC NO se
--     postea aparte: el libro ya cierra con el espejo (D5).
--   · 🔴 Cerrado el MES DE LA FACTURA, no se anula: se emite NC (Josuarth).
--     El RPC lo verifica contra `accounting_periods` por `issue_date`, además
--     de la app (D4). Es distinto del control de `post_journal_entry`, que
--     mira el mes de la fecha de HOY.
--   · Una factura SIN asiento (anterior al cableado del 09/09) se anula sin
--     reversión: `p_lines` NULL, y el RPC solo cambia el status. Con asiento,
--     `p_lines` es obligatorio y tiene que ser el espejo EXACTO (EXCEPT ALL,
--     como reverse_payment).
--
--   · La VÁLVULA DE COMPENSACIÓN de la NC. T6 (`finanzas_no_delete_protected`)
--     rechaza siempre el DELETE de `credit_notes`, y el trigger de líneas
--     también. Correcto para una NC emitida — pero el creador (TS) inserta la
--     NC ANTES de postear su asiento (o de la reversión), y si el posteo falla
--     hay que deshacerla, igual que el DELETE compensatorio de un cobro o un
--     pago (SOP-031). Sin la válvula quedaría una NC con número y sin libro.
--     Condición doble: `finanzas.nc_compensar = 'on'` (la pone SOLO el creador
--     con el cliente de servicio, en el mismo request) Y la NC no tiene
--     asiento `nota_credito`. Con asiento no hay válvula: se reversa.
--
-- 📋 Verificado contra information_schema / pg_constraint el 22/09:
--    accounting_periods(tenant_id, year, month, status) con CHECK status IN
--    ('abierto','cerrado'); invoices.cancellation_reason text, cancelled_at
--    timestamptz (B4); T2 (`finanzas_validate_status_transition`) admite
--    emitida→anulada y parcialmente_pagada→anulada, NO pagada→anulada;
--    T6 es una función compartida por quotes/invoices/credit_notes/payments:
--    se reescribe COMPLETA con los cuatro casos.
--
-- IDEMPOTENCIA: CREATE OR REPLACE. Re-ejecutable.
-- Verificación: sql/tests/verificacion-052-anulacion-con-reversion.sql
-- (ROLLBACK, con falla forzada después del posteo).
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. T6 con la válvula de compensación de la NC (los CUATRO casos, completos)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finanzas_no_delete_protected()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_valvula text := current_setting('finanzas.nc_compensar', true);
  v_asiento bigint;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'quotes' THEN
      IF OLD.status != 'borrador' THEN
        RAISE EXCEPTION 'Cotización % está en status "%": solo se pueden eliminar borradores',
          OLD.quote_number, OLD.status USING ERRCODE = 'check_violation';
      END IF;
    WHEN 'invoices' THEN
      IF OLD.status != 'borrador' THEN
        RAISE EXCEPTION 'Factura % está en status "%": solo se pueden eliminar borradores',
          OLD.invoice_number, OLD.status USING ERRCODE = 'check_violation';
      END IF;
    WHEN 'credit_notes' THEN
      -- La válvula (052): solo el DELETE compensatorio del creador, y solo si
      -- la NC no llegó al libro. Una NC contabilizada no se borra: se reversa.
      IF v_valvula = 'on' THEN
        SELECT entry_number INTO v_asiento FROM public.journal_entries
         WHERE source_type = 'nota_credito' AND source_id = OLD.id LIMIT 1;
        IF v_asiento IS NULL THEN
          RAISE WARNING 'finanzas.nc_compensar: DELETE compensatorio de la nota de crédito % (sin asiento).', OLD.credit_note_number;
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'Nota de crédito % ya está en el libro (asiento %) y no puede eliminarse: se reversa.',
          OLD.credit_note_number, v_asiento USING ERRCODE = 'check_violation';
      END IF;
      RAISE EXCEPTION 'Nota de crédito % no puede eliminarse (es irreversible)',
        OLD.credit_note_number USING ERRCODE = 'check_violation';
    WHEN 'payments' THEN
      IF OLD.status != 'registrado' THEN
        RAISE EXCEPTION 'Pago en status "%" no puede eliminarse (solo "registrado")',
          OLD.status USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'finanzas_no_delete_protected: tabla "%" no soportada', TG_TABLE_NAME;
  END CASE;
  RETURN OLD;
END;
$$;

-- Las líneas: mismo criterio. UPDATE nunca; DELETE solo con la válvula y sin asiento.
CREATE OR REPLACE FUNCTION public.finanzas_credit_note_lines_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_cnum    text;
  v_cn_id   uuid;
  v_valvula text := current_setting('finanzas.nc_compensar', true);
  v_asiento bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_cn_id := OLD.credit_note_id;
    IF v_valvula = 'on' THEN
      SELECT entry_number INTO v_asiento FROM public.journal_entries
       WHERE source_type = 'nota_credito' AND source_id = v_cn_id LIMIT 1;
      IF v_asiento IS NULL THEN
        RETURN OLD;
      END IF;
    END IF;
  ELSE
    v_cn_id := NEW.credit_note_id;
  END IF;
  SELECT credit_note_number INTO v_cnum FROM public.credit_notes WHERE id = v_cn_id;
  RAISE EXCEPTION 'no se puede modificar líneas de nota de crédito %, está en estado emitida',
    v_cnum USING ERRCODE = 'check_violation';
END;
$$;

-- ----------------------------------------------------------------------------
-- 1b. finanzas_compensar_nota_de_credito — la válvula y el DELETE juntos
-- ----------------------------------------------------------------------------
-- `set_config(..., true)` vive en la transacción; desde supabase-js cada
-- llamada es una transacción distinta, así que la válvula y el DELETE tienen
-- que ir en la misma función. Solo service_role, solo sin asiento (lo vuelve a
-- comprobar T6). Devuelve cuántas líneas y cabeceras borró.
CREATE OR REPLACE FUNCTION public.finanzas_compensar_nota_de_credito(
  p_tenant_id      uuid,
  p_credit_note_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lineas int;
  v_cab    int;
BEGIN
  PERFORM set_config('finanzas.nc_compensar', 'on', true);
  DELETE FROM public.credit_note_lines WHERE tenant_id = p_tenant_id AND credit_note_id = p_credit_note_id;
  GET DIAGNOSTICS v_lineas = ROW_COUNT;
  DELETE FROM public.credit_notes WHERE tenant_id = p_tenant_id AND id = p_credit_note_id;
  GET DIAGNOSTICS v_cab = ROW_COUNT;
  PERFORM set_config('finanzas.nc_compensar', 'off', true);
  RETURN jsonb_build_object('lineas', v_lineas, 'cabeceras', v_cab);
END $$;

REVOKE EXECUTE ON FUNCTION public.finanzas_compensar_nota_de_credito(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_compensar_nota_de_credito(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.finanzas_compensar_nota_de_credito IS
  'DELETE compensatorio de una NC recién creada cuyo asiento no pudo postearse (SOP-031): pone la válvula finanzas.nc_compensar y borra líneas y cabecera en la misma transacción. T6 rechaza igual si la NC ya tiene asiento. Solo service_role.';

-- ----------------------------------------------------------------------------
-- 2. cancel_invoice_with_reversal — espejo + anulada, UNA transacción
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_invoice_with_reversal(
  p_tenant_id        uuid,
  p_invoice_id       uuid,
  p_reason           text,
  p_observations     text,
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
  v_issue      date;
  v_number     text;
  v_periodo    text;
  v_orig_id    uuid;
  v_orig_nro   bigint;
  v_orig_ref   text;
  v_orig_date  date;
  v_ya_nro     bigint;
  v_dif        int;
  v_entry_id   uuid;
  v_entry_nro  bigint;
BEGIN
  IF p_tenant_id IS NULL OR p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'cancel_invoice_with_reversal: faltan el tenant o la factura';
  END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'La anulación necesita un motivo de al menos 3 caracteres';
  END IF;

  SELECT status, amount_paid, issue_date, invoice_number
    INTO v_status, v_paid, v_issue, v_number
    FROM public.invoices
   WHERE tenant_id = p_tenant_id AND id = p_invoice_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;
  IF v_status = 'anulada' THEN
    RAISE EXCEPTION 'La factura ya está anulada.';
  END IF;
  IF v_status NOT IN ('emitida', 'parcialmente_pagada') THEN
    RAISE EXCEPTION 'La factura % está en estado "%" y no se puede anular.', v_number, v_status;
  END IF;
  IF coalesce(v_paid, 0) > 0 THEN
    RAISE EXCEPTION 'La factura % tiene B/. % en pagos registrados. Elimine o reverse los pagos primero.', v_number, v_paid;
  END IF;

  -- 🔴 El MES DE LA FACTURA (Josuarth): cerrado → no se anula, se emite NC.
  SELECT status INTO v_periodo FROM public.accounting_periods
   WHERE tenant_id = p_tenant_id
     AND year = EXTRACT(YEAR FROM v_issue)::int AND month = EXTRACT(MONTH FROM v_issue)::int;
  IF v_periodo = 'cerrado' THEN
    RAISE EXCEPTION 'El mes de esta factura (%) está cerrado: no se anula, se emite una nota de crédito con fecha de hoy.',
      to_char(v_issue, 'YYYY-MM');
  END IF;

  -- El asiento original, si lo hay
  SELECT id, entry_number, reference, transaction_date
    INTO v_orig_id, v_orig_nro, v_orig_ref, v_orig_date
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND source_type = 'factura' AND source_id = p_invoice_id;

  IF v_orig_id IS NOT NULL THEN
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
      RAISE EXCEPTION 'La factura % está en el libro (asiento %): la anulación necesita el espejo de su asiento.', v_number, v_orig_nro;
    END IF;
    IF p_transaction_date IS NULL OR abs(p_transaction_date - current_date) > 1 THEN
      RAISE EXCEPTION 'La reversión lleva la fecha en que se hace (hoy, %), nunca otra: llegó %',
        current_date, coalesce(p_transaction_date::text, 'NULL');
    END IF;
    IF p_transaction_date < v_orig_date THEN
      RAISE EXCEPTION 'La reversión (%) no puede ser anterior al asiento que revierte (asiento %, %)',
        p_transaction_date, v_orig_nro, v_orig_date;
    END IF;
    SELECT entry_number INTO v_ya_nro FROM public.journal_entries
     WHERE tenant_id = p_tenant_id AND reverses_entry_id = v_orig_id LIMIT 1;
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
        'Las líneas recibidas no son el espejo exacto del asiento %: se rechaza la anulación para no descuadrar el libro.',
        v_orig_nro;
    END IF;

    v_entry_id := public.post_journal_entry(
      p_tenant_id, p_transaction_date, p_description, 'reversion', p_lines,
      p_invoice_id, NULL, v_orig_id, btrim(p_reason), p_created_by, NULL, v_orig_ref, NULL
    );
    SELECT entry_number INTO v_entry_nro FROM public.journal_entries WHERE id = v_entry_id;
  ELSIF p_lines IS NOT NULL AND jsonb_typeof(p_lines) = 'array' AND jsonb_array_length(p_lines) > 0 THEN
    RAISE EXCEPTION 'La factura % no está en el libro: no hay asiento que reversar (llegaron líneas).', v_number;
  END IF;

  -- La anulación. T2 valida la transición; T7a no toca una anulada.
  UPDATE public.invoices
     SET status = 'anulada',
         cancellation_reason = btrim(p_reason),
         cancelled_at = now()
   WHERE tenant_id = p_tenant_id AND id = p_invoice_id;

  RETURN jsonb_build_object(
    'invoice_id',            p_invoice_id,
    'entry_id',              v_entry_id,
    'entry_number',          v_entry_nro,
    'reversed_entry_number', v_orig_nro,
    'transaction_date',      p_transaction_date
  );
END $$;

REVOKE EXECUTE ON FUNCTION
  public.cancel_invoice_with_reversal(uuid, uuid, text, text, date, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.cancel_invoice_with_reversal(uuid, uuid, text, text, date, text, jsonb, uuid)
  TO service_role;

COMMENT ON FUNCTION public.cancel_invoice_with_reversal IS
  'Anula una factura en UNA transacción: rechaza si el MES de la factura está cerrado (se emite NC), verifica el espejo de su asiento (EXCEPT ALL) y lo postea como reversión con fecha de hoy si la factura está en el libro, y marca anulada. La NC total la crea la app antes (createCreditNoteFromInvoice); si esto falla, la app la deshace con la válvula finanzas.nc_compensar. SECURITY DEFINER, EXECUTE solo service_role.';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'cancel_invoice_with_reversal';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '052: se esperaba una firma de cancel_invoice_with_reversal, hay %', v_n;
  END IF;
  IF has_function_privilege('anon', 'public.cancel_invoice_with_reversal(uuid, uuid, text, text, date, text, jsonb, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cancel_invoice_with_reversal(uuid, uuid, text, text, date, text, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '052: anon o authenticated pueden ejecutar el RPC';
  END IF;
  IF has_function_privilege('authenticated', 'public.finanzas_compensar_nota_de_credito(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '052: authenticated puede ejecutar la compensación';
  END IF;
  RAISE NOTICE '052 ✅ cancel_invoice_with_reversal, finanzas_compensar_nota_de_credito, T6 y el trigger de líneas con la válvula';
END $$;

COMMIT;
