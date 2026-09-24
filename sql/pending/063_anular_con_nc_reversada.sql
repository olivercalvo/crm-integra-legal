-- ============================================================================
-- 063 — UNA FACTURA SE BLOQUEA POR SUS NC VIGENTES, NO POR SU HISTORIA
-- ============================================================================
-- Bloque 9C (24/09/2026). Corrige la consecuencia que la `060` dejó anotada y
-- sin resolver: **una factura cuya nota de crédito se reversó seguía sin poder
-- anularse, para siempre.**
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ PASABA
-- ─────────────────────────────────────────────────────────────────────────────
-- La `053` bloquea la anulación cuando la factura tiene una NC con asiento
-- propio en el libro. La razón es buena y sigue valiendo: una NC parcial YA
-- debitó su parte del ingreso (D5), así que espejar el asiento original
-- COMPLETO lo contaría dos veces — el descuadre de 1.200 sobre 1.000.
--
-- El problema es que miraba la EXISTENCIA del asiento, y los asientos son
-- inmutables: no se borran nunca. Así que una NC reversada —cuyo débito ya fue
-- cancelado por su propio espejo, y cuyo ingreso volvió a estar entero en el
-- libro— seguía bloqueando la factura como si nada hubiera pasado. La factura
-- quedaba sin salida: ni anular, ni volver al estado anterior.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA REGLA NUEVA
-- ─────────────────────────────────────────────────────────────────────────────
-- Bloquea sólo una NC **VIGENTE**: con asiento propio y **sin reversar**.
--
--   · NC vigente                     → bloqueada (nada cambia)
--   · su única NC reversada          → sigue la matriz normal de
--                                      `decidirAccionFiscal()`: 182 h y mes abierto
--   · una vigente y otra reversada   → bloqueada, por la vigente
--
-- 🔴 SE MIRA EL ASIENTO, NO `credit_notes.status`, y es a propósito. Cuando
--    este RPC corre **ya existe la NC total de esta misma anulación**: está
--    `emitida` y no tiene asiento (D5: contabilizarla aparte sería contar dos
--    veces). Si el filtro mirara el status, esa NC se bloquearía a sí misma y
--    NINGUNA factura se podría anular. El comentario de la `053` ya lo decía;
--    acá se conserva y se le suma la condición de reversión.
--
-- ⚠️ El lado de la APP no cambia. `cancelInvoice` rechaza por
--    `credited_total > 0`, y esa columna es `SUM(grand_total) WHERE status =
--    'emitida'` desde la `051`: una NC anulada ya sale de la cuenta sola. Las
--    dos mitades quedan diciendo lo mismo, cada una por su camino.
--
-- 📋 Verificado contra pg_proc / pg_indexes el 24/09/2026 en staging:
--    · `cancel_invoice_with_reversal` tiene UNA firma de 8 parámetros.
--    · `journal_entries.reverses_entry_id` es uuid NULL, y
--      `journal_entries_una_reversion_por_asiento` (055) garantiza que el
--      `NOT EXISTS` de abajo no pueda encontrar dos reversiones del mismo
--      asiento.
--
-- La función se re-declara COMPLETA (no hay forma de parchear un cuerpo de
-- plpgsql), a partir del `pg_get_functiondef` del esquema real. El único
-- cambio es la cláusula marcada `063`.
--
-- IDEMPOTENCIA: CREATE OR REPLACE FUNCTION.
-- Verificación: sql/tests/verificacion-063-anular-con-nc-reversada.sql
-- 🛑 SOLO STAGING.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_invoice_with_reversal(p_tenant_id uuid, p_invoice_id uuid, p_reason text, p_observations text, p_transaction_date date, p_description text, p_lines jsonb, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  --
  -- 🔴 063: PERO SÓLO SI SIGUE VIGENTE. Una NC cuyo asiento ya fue REVERSADO
  --    no debitó nada: su débito y el espejo se cancelan entre sí, y el
  --    ingreso volvió a estar entero en el libro. Bloquear por ella dejaba a
  --    la factura sin salida para siempre, porque los asientos no se borran.
  --    Se mira el ASIENTO y no `credit_notes.status` a propósito: cuando este
  --    RPC corre ya existe la NC total de esta misma anulación, `emitida` y
  --    sin asiento, y mirar el status la haría bloquearse a sí misma.
  SELECT cn.credit_note_number INTO v_nc_en_libro
    FROM public.credit_notes cn
    JOIN public.journal_entries je
      ON je.tenant_id = cn.tenant_id AND je.source_type = 'nota_credito' AND je.source_id = cn.id
   WHERE cn.tenant_id = p_tenant_id AND cn.invoice_id = p_invoice_id
     AND NOT EXISTS (
       SELECT 1 FROM public.journal_entries r
        WHERE r.tenant_id = je.tenant_id AND r.reverses_entry_id = je.id
     )
   LIMIT 1;
  IF v_nc_en_libro IS NOT NULL THEN
    RAISE EXCEPTION 'La factura % ya tiene la nota de crédito % vigente en el libro: no se anula. Lo que falta se acredita con otra nota de crédito.',
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
END $function$;

REVOKE EXECUTE ON FUNCTION
  public.cancel_invoice_with_reversal(uuid, uuid, text, text, date, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.cancel_invoice_with_reversal(uuid, uuid, text, text, date, text, jsonb, uuid)
  TO service_role;

COMMENT ON FUNCTION public.cancel_invoice_with_reversal IS
  'Anula una factura: NC total automática + reversión del asiento con fecha de hoy, en UNA transacción. Desde la 063 bloquea sólo por notas de crédito VIGENTES (con asiento propio y sin reversar): una NC reversada ya no debitó nada. SECURITY DEFINER, EXECUTE solo service_role.';

-- ----------------------------------------------------------------------------
-- Verificación de la migración
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_n int; v_def text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'cancel_invoice_with_reversal';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '063: se esperaba una firma de cancel_invoice_with_reversal, hay %', v_n;
  END IF;
  IF has_function_privilege('anon', 'public.cancel_invoice_with_reversal(uuid, uuid, text, text, date, text, jsonb, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cancel_invoice_with_reversal(uuid, uuid, text, text, date, text, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '063: anon o authenticated pueden ejecutar la anulación';
  END IF;

  SELECT pg_get_functiondef('public.cancel_invoice_with_reversal(uuid, uuid, text, text, date, text, jsonb, uuid)'::regprocedure) INTO v_def;

  -- La condición nueva quedó.
  IF position('reverses_entry_id = je.id' IN v_def) = 0 THEN
    RAISE EXCEPTION '063: el filtro de NC vigentes (NOT EXISTS de la reversión) no quedó en la función';
  END IF;

  -- 🔴 Y lo que NO debe pasar: que alguien lo "simplifique" mirando el status.
  --    La NC total de esta misma anulación está `emitida` y sin asiento, así
  --    que un filtro por status bloquearía TODAS las anulaciones.
  IF position('cn.status' IN v_def) > 0 THEN
    RAISE EXCEPTION '063: el filtro mira credit_notes.status; tiene que mirar el ASIENTO (ver el encabezado)';
  END IF;

  -- El resto de los gates sigue en pie.
  IF position('pagos registrados' IN v_def) = 0 THEN
    RAISE EXCEPTION '063: se perdió el gate de pagos al re-declarar la función';
  END IF;
  IF position('accounting_periods' IN v_def) = 0 THEN
    RAISE EXCEPTION '063: se perdió el gate de período cerrado al re-declarar la función';
  END IF;

  RAISE NOTICE '063 ✅ la anulación bloquea sólo por notas de crédito VIGENTES';
END $$;

COMMIT;
