-- ============================================================================
-- VERIFICACIÓN de la 046 — reverse_payment(): atomicidad, espejo, fecha, T7a.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja asientos ni consume correlativo.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-046-reversion-cobro.sql
--
-- Usa el cobro contabilizado más reciente del tenant de staging. Si no hay
-- ninguno, lo dice y termina sin verificar nada (no inventa uno).
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant    uuid := 'a0000000-0000-0000-0000-000000000001';
  v_pago      uuid;
  v_orig_id   uuid;
  v_orig_nro  bigint;
  v_factura   uuid;
  v_inv_nro   text;
  v_st_antes  text;
  v_paid_antes numeric;
  v_st_desp   text;
  v_paid_desp numeric;
  v_pay_st    text;
  v_seq_antes bigint;
  v_seq_desp  bigint;
  v_lineas    jsonb;
  v_res       jsonb;
  v_err       text;
  v_n         int;
  v_problemas int;
BEGIN
  -- ---- el cobro de prueba: el último con asiento y en 'registrado' ----------
  SELECT p.id, je.id, je.entry_number
    INTO v_pago, v_orig_id, v_orig_nro
    FROM public.payments p
    JOIN public.journal_entries je
      ON je.tenant_id = p.tenant_id AND je.source_type = 'pago' AND je.source_id = p.id
   WHERE p.tenant_id = v_tenant AND p.status = 'registrado'
     AND NOT EXISTS (SELECT 1 FROM public.journal_entries r WHERE r.reverses_entry_id = je.id)
   ORDER BY p.created_at DESC
   LIMIT 1;

  IF v_pago IS NULL THEN
    RAISE NOTICE '⚠️ No hay ningún cobro contabilizado sin reversar en staging: nada que verificar.';
    RETURN;
  END IF;

  SELECT a.invoice_id, i.invoice_number, i.status, i.amount_paid
    INTO v_factura, v_inv_nro, v_st_antes, v_paid_antes
    FROM public.payment_applications a JOIN public.invoices i ON i.id = a.invoice_id
   WHERE a.payment_id = v_pago
   LIMIT 1;

  RAISE NOTICE 'Cobro % · asiento % · factura % (% / pagado %)',
    v_pago, v_orig_nro, v_inv_nro, v_st_antes, v_paid_antes;

  -- El espejo, armado acá SOLO para la prueba (en la app lo arma reversion.ts).
  SELECT jsonb_agg(jsonb_build_object(
           'account_code', c.code, 'debit', l.credit, 'credit', l.debit,
           'description', 'Reversión') ORDER BY l.line_order)
    INTO v_lineas
    FROM public.journal_entry_lines l JOIN public.chart_of_accounts c ON c.id = l.account_id
   WHERE l.entry_id = v_orig_id;

  SELECT last_number INTO v_seq_antes
    FROM public.accounting_sequences WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';

  -- [1] Motivo corto: rechazado antes de tocar nada.
  BEGIN
    PERFORM public.reverse_payment(v_tenant, v_pago, 'no', current_date, 'Reversión', v_lineas, NULL);
    RAISE NOTICE '[1] motivo de 2 caracteres ................... ⚠️ PASÓ (debía fallar)';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[1] motivo de 2 caracteres ................... ✅ RECHAZADO: %', v_err;
  END;

  -- [2] Fecha que no es hoy: rechazada (la reversión lleva la fecha en que se hace).
  BEGIN
    PERFORM public.reverse_payment(v_tenant, v_pago, 'Cheque devuelto', current_date - 30, 'Reversión', v_lineas, NULL);
    RAISE NOTICE '[2] fecha de hace 30 días .................... ⚠️ PASÓ (debía fallar)';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[2] fecha de hace 30 días .................... ✅ RECHAZADA: %', v_err;
  END;

  -- [3] Líneas que NO son el espejo (mismo cuadre, otra cuenta): rechazadas.
  BEGIN
    PERFORM public.reverse_payment(v_tenant, v_pago, 'Cheque devuelto', current_date, 'Reversión',
      jsonb_build_array(
        jsonb_build_object('account_code','100002','debit',0,'credit',(v_lineas->0->>'credit')::numeric),
        jsonb_build_object('account_code','100004','debit',(v_lineas->0->>'credit')::numeric,'credit',0)),
      NULL);
    RAISE NOTICE '[3] líneas que no son el espejo .............. ⚠️ PASÓ (debía fallar)';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[3] líneas que no son el espejo .............. ✅ RECHAZADAS: %', v_err;
  END;

  -- [4] ATOMICIDAD: se fuerza una falla DESPUÉS del posteo (en el INSERT de la
  --     foto) y se comprueba que el asiento espejo NO quedó y que el correlativo
  --     no avanzó. Si esto pasara con tres llamadas desde la app, el asiento ya
  --     estaría escrito y sería imposible de borrar.
  CREATE OR REPLACE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS
    'BEGIN RAISE EXCEPTION ''BOOM simulado después del posteo''; END';
  CREATE TRIGGER trg_boom BEFORE INSERT ON public.payment_reversals
    FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();
  BEGIN
    PERFORM public.reverse_payment(v_tenant, v_pago, 'Cheque devuelto', current_date, 'Reversión', v_lineas, NULL);
    RAISE NOTICE '[4] falla forzada tras el posteo ............. ⚠️ PASÓ (debía fallar)';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    SELECT count(*) INTO v_n FROM public.journal_entries WHERE reverses_entry_id = v_orig_id;
    SELECT last_number INTO v_seq_desp
      FROM public.accounting_sequences WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
    SELECT status INTO v_pay_st FROM public.payments WHERE id = v_pago;
    IF v_n = 0 AND v_seq_desp = v_seq_antes AND v_pay_st = 'registrado' THEN
      RAISE NOTICE '[4] falla forzada tras el posteo ............. ✅ TODO DESHECHO (0 espejos, correlativo % intacto, cobro sigue registrado) — "%"', v_seq_desp, v_err;
    ELSE
      RAISE NOTICE '[4] falla forzada tras el posteo ............. ❌ QUEDÓ A MEDIAS: % espejo(s), correlativo % → %, cobro "%"', v_n, v_seq_antes, v_seq_desp, v_pay_st;
    END IF;
  END;
  DROP TRIGGER trg_boom ON public.payment_reversals;

  -- [5] La reversión buena.
  v_res := public.reverse_payment(v_tenant, v_pago, 'Cheque devuelto por el banco', current_date,
             'Reversión del asiento ' || v_orig_nro, v_lineas, NULL);
  RAISE NOTICE '[5] reversión .................................. ✅ asiento % revierte al % · %',
    v_res->>'entry_number', v_res->>'reversed_entry_number', v_res->'invoices';

  -- [6] Efectos: cobro anulado, sin aplicaciones, foto guardada, factura recalculada por T7a.
  SELECT status INTO v_pay_st FROM public.payments WHERE id = v_pago;
  SELECT count(*) INTO v_n FROM public.payment_applications WHERE payment_id = v_pago;
  SELECT status, amount_paid INTO v_st_desp, v_paid_desp FROM public.invoices WHERE id = v_factura;
  RAISE NOTICE '[6] cobro "%" · % aplicaciones · factura % → % · pagado % → %',
    v_pay_st, v_n, v_st_antes, v_st_desp, v_paid_antes, v_paid_desp;
  IF v_pay_st <> 'anulado' OR v_n <> 0 THEN
    RAISE NOTICE '    ❌ el cobro no quedó anulado y sin aplicaciones';
  END IF;
  SELECT count(*) INTO v_n FROM public.payment_reversals WHERE payment_id = v_pago AND invoice_id = v_factura;
  IF v_n = 1 THEN
    RAISE NOTICE '    ✅ payment_reversals tiene la foto (1 fila)';
  ELSE
    RAISE NOTICE '    ❌ payment_reversals: % filas (esperada 1)', v_n;
  END IF;

  -- [7] El espejo: source_type reversion, apunta al original, mismo source_id, fecha de hoy.
  SELECT count(*) INTO v_n
    FROM public.journal_entries
   WHERE reverses_entry_id = v_orig_id AND source_type = 'reversion'
     AND source_id = v_pago AND transaction_date = current_date
     AND reversal_reason = 'Cheque devuelto por el banco';
  IF v_n = 1 THEN
    RAISE NOTICE '[7] el asiento espejo ......................... ✅ reversion · reverses_entry_id · fecha de hoy · motivo';
  ELSE
    RAISE NOTICE '[7] el asiento espejo ......................... ❌ no cumple (% filas)', v_n;
  END IF;

  -- [8] Segunda reversión del mismo cobro: rechazada.
  BEGIN
    PERFORM public.reverse_payment(v_tenant, v_pago, 'Otra vez', current_date, 'Reversión', v_lineas, NULL);
    RAISE NOTICE '[8] reversar dos veces ....................... ⚠️ PASÓ (debía fallar)';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[8] reversar dos veces ....................... ✅ RECHAZADA: %', v_err;
  END;

  -- [9] La cadena de hash sigue íntegra con el espejo encima.
  SELECT COUNT(*) INTO v_problemas FROM public.verify_accounting_chain(v_tenant);
  IF v_problemas = 0 THEN
    RAISE NOTICE '[9] cadena de hash ............................ ✅ ÍNTEGRA';
  ELSE
    RAISE NOTICE '[9] cadena de hash ............................ ❌ % problema(s)', v_problemas;
  END IF;

  -- [10] La factura vuelve a aceptar un cobro nuevo (no quedó trabada).
  RAISE NOTICE '[10] la factura quedó en "%" con saldo % — lista para un cobro nuevo',
    v_st_desp, (SELECT balance_due FROM public.invoices WHERE id = v_factura);
END $$;

ROLLBACK;
