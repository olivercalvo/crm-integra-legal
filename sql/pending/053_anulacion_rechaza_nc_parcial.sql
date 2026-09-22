-- ============================================================================
-- 053 — LA ANULACIÓN RECHAZA UNA FACTURA CON NC PARCIAL EN EL LIBRO.
-- ============================================================================
-- Bloque 5, commit 4 (22/09/2026). Se encontró al armar la pantalla: con la
-- NC parcial por líneas (commit 2) y su asiento propio (commit 3, D5) apareció
-- una combinación que la 052 no miraba:
--
--   factura de 1.000 con asiento A · NC parcial de 200 con asiento propio B
--   (DEBE ingreso 200, HABER 100004 200) · alguien la ANULA
--
-- La anulación espeja A COMPLETO (HABER ingreso 1.000) y B ya debitó 200: el
-- ingreso queda revertido por 1.200 sobre una factura de 1.000. Descuadre
-- silencioso en el libro que el contador certifica.
--
-- Regla: **una factura con una NC en el libro ya no se anula**; lo que falta
-- se acredita con OTRA nota de crédito. `cancelInvoice` (app) la rechaza por
-- `credited_total > 0` con 409, y este RPC —que es el permiso— la vuelve a
-- verificar por la existencia de un asiento `nota_credito` de alguna NC de la
-- factura. Se mira el ASIENTO y no `credited_total` porque, cuando el RPC
-- corre, la app ya creó la NC total de esta misma anulación (sin asiento,
-- D5) y `credited_total` ya es el total.
--
-- Se re-declara la función COMPLETA (CREATE OR REPLACE) con el cuerpo de la
-- 052 más el gate. Ningún otro cambio.
--
-- IDEMPOTENCIA: CREATE OR REPLACE. Re-ejecutable.
-- Verificación: sql/tests/verificacion-053-anulacion-con-nc-parcial.sql
-- ============================================================================
BEGIN;

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
  v_nc_en_libro text;
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

  -- 053: una NC PARCIAL con asiento propio ya debitó su parte del ingreso
  -- (D5). Espejar el asiento original COMPLETO lo contaría dos veces. Lo que
  -- falta se acredita con otra NC. (La NC total de esta misma anulación NO
  -- tiene asiento, así que no cae acá.)
  SELECT cn.credit_note_number INTO v_nc_en_libro
    FROM public.credit_notes cn
    JOIN public.journal_entries je
      ON je.tenant_id = cn.tenant_id AND je.source_type = 'nota_credito' AND je.source_id = cn.id
   WHERE cn.tenant_id = p_tenant_id AND cn.invoice_id = p_invoice_id
   LIMIT 1;
  IF v_nc_en_libro IS NOT NULL THEN
    RAISE EXCEPTION 'La factura % ya tiene la nota de crédito % en el libro: no se anula. Lo que falta se acredita con otra nota de crédito.',
      v_number, v_nc_en_libro;
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
  'Anula una factura en UNA transacción: rechaza si el MES de la factura está cerrado (se emite NC) o si alguna NC de la factura ya está en el libro (053: se acredita el resto con otra NC), verifica el espejo de su asiento (EXCEPT ALL) y lo postea como reversión con fecha de hoy si la factura está en el libro, y marca anulada. La NC total la crea la app antes (createCreditNoteFromInvoice); si esto falla, la app la deshace con la válvula finanzas.nc_compensar. SECURITY DEFINER, EXECUTE solo service_role.';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'cancel_invoice_with_reversal';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '053: se esperaba una firma de cancel_invoice_with_reversal, hay %', v_n;
  END IF;
  IF has_function_privilege('anon', 'public.cancel_invoice_with_reversal(uuid, uuid, text, text, date, text, jsonb, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cancel_invoice_with_reversal(uuid, uuid, text, text, date, text, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '053: anon o authenticated pueden ejecutar el RPC';
  END IF;
  IF position('v_nc_en_libro' IN pg_get_functiondef('public.cancel_invoice_with_reversal(uuid, uuid, text, text, date, text, jsonb, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '053: el gate por NC en el libro no quedó en la función';
  END IF;
  RAISE NOTICE '053 ✅ cancel_invoice_with_reversal rechaza una factura con NC parcial en el libro';
END $$;

COMMIT;
