-- ============================================================================
-- VERIFICACIÓN de la 060 — reverse_credit_note()
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja asientos, NC ni correlativo consumido.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-060-reversion-nota-de-credito.sql
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA PROPIEDAD QUE SE PRUEBA
-- ─────────────────────────────────────────────────────────────────────────────
-- `credited_total`, `balance_due` y el `status` de la factura NO se escriben en
-- la reversión: los recalcula `trg_recalc_invoice_credited` a partir de las NC
-- que siguen `emitida`. Así que lo que hay que verificar no es "restó bien",
-- sino que **los tres vuelven exactamente a donde estaban**, incluso cuando hay
-- un pago parcial de por medio o una segunda NC que NO se anula.
--
-- El escenario se CONSTRUYE acá adentro (y se deshace) en vez de depender de lo
-- que haya quedado en staging: así los cinco casos corren siempre.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant     uuid := 'a0000000-0000-0000-0000-000000000001';
  v_factura    uuid;
  v_inv_nro    text;
  v_cliente    uuid;
  v_total      numeric;
  v_pagado     numeric;
  -- foto inicial
  v_cred_0     numeric;
  v_bal_0      numeric;
  v_st_0       text;
  -- después de emitir las NC
  v_cred_1     numeric;
  v_bal_1      numeric;
  v_st_1       text;
  -- después de la reversión
  v_cred_2     numeric;
  v_bal_2      numeric;
  v_st_2       text;
  v_nc_a       uuid := gen_random_uuid();
  v_nc_b       uuid := gen_random_uuid();
  v_asiento_a  uuid;
  v_asiento_b  uuid;
  v_lineas     jsonb;
  v_res        jsonb;
  v_err        text;
  v_n          int;
  v_seq_antes  bigint;
  v_seq_desp   bigint;
  v_nc_st      text;
  v_fecha      date;
  v_deb        numeric;
  v_cre        numeric;
BEGIN
  -- ---- la factura de prueba: emitida, con asiento, sin NC previa -----------
  -- Se prefiere una PARCIALMENTE PAGADA, que es el caso 2 del pedido.
  SELECT i.id, i.invoice_number, i.client_id, i.grand_total, i.amount_paid
    INTO v_factura, v_inv_nro, v_cliente, v_total, v_pagado
    FROM public.invoices i
   WHERE i.tenant_id = v_tenant
     AND i.status IN ('emitida', 'parcialmente_pagada')
     AND i.credited_total = 0
     AND i.grand_total >= 4
     AND EXISTS (SELECT 1 FROM public.journal_entries j
                  WHERE j.source_type = 'factura' AND j.source_id = i.id)
   ORDER BY (i.status = 'parcialmente_pagada') DESC, i.grand_total DESC
   LIMIT 1;

  IF v_factura IS NULL THEN
    RAISE NOTICE '⚠️ No hay factura candidata en staging: nada que verificar.';
    RETURN;
  END IF;

  SELECT credited_total, balance_due, status INTO v_cred_0, v_bal_0, v_st_0
    FROM public.invoices WHERE id = v_factura;

  RAISE NOTICE 'Factura % · total % · pagado % · saldo % · "%"',
    v_inv_nro, v_total, v_pagado, v_bal_0, v_st_0;

  SELECT last_number INTO v_seq_antes
    FROM public.accounting_sequences
   WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';

  -- ══════════════════════════════════════════════════════════════════════════
  -- Montaje: DOS notas de crédito parciales sobre la MISMA factura (caso 3).
  -- Se insertan a mano porque el creador vive en la app; lo que importa acá es
  -- el comportamiento de la base.
  -- ══════════════════════════════════════════════════════════════════════════
  INSERT INTO public.credit_notes
    (id, tenant_id, credit_note_number, invoice_id, client_id, issue_date, reason,
     status, subtotal_total, tax_total, grand_total)
  VALUES
    (v_nc_a, v_tenant, 'NC-TEST-A', v_factura, v_cliente, current_date,
     'Prueba 060 — NC parcial A', 'emitida', 2.00, 0.00, 2.00),
    (v_nc_b, v_tenant, 'NC-TEST-B', v_factura, v_cliente, current_date,
     'Prueba 060 — NC parcial B', 'emitida', 1.00, 0.00, 1.00);

  SELECT credited_total, balance_due, status INTO v_cred_1, v_bal_1, v_st_1
    FROM public.invoices WHERE id = v_factura;

  IF v_cred_1 = 3.00 AND v_bal_1 = v_bal_0 - 3.00 THEN
    RAISE NOTICE '[0] montaje: 2 NC (2.00 + 1.00) ............... ✅ acreditado % · saldo % → %',
      v_cred_1, v_bal_0, v_bal_1;
  ELSE
    RAISE NOTICE '[0] montaje ................................... ❌ acreditado % (esperado 3.00), saldo %',
      v_cred_1, v_bal_1;
  END IF;

  -- Cada NC con su asiento propio (source_type 'nota_credito'), que es lo que
  -- distingue una NC reversable de la que sale de anular una factura.
  v_asiento_a := public.post_journal_entry(
    v_tenant, current_date, 'NC-TEST-A prueba 060', 'nota_credito',
    jsonb_build_array(
      jsonb_build_object('account_code', '400001', 'debit', 2.00, 'credit', 0),
      jsonb_build_object('account_code', '110001', 'debit', 0, 'credit', 2.00)),
    v_nc_a, NULL, NULL, NULL, NULL, NULL, 'NC-TEST-A', NULL);

  v_asiento_b := public.post_journal_entry(
    v_tenant, current_date, 'NC-TEST-B prueba 060', 'nota_credito',
    jsonb_build_array(
      jsonb_build_object('account_code', '400001', 'debit', 1.00, 'credit', 0),
      jsonb_build_object('account_code', '110001', 'debit', 0, 'credit', 1.00)),
    v_nc_b, NULL, NULL, NULL, NULL, NULL, 'NC-TEST-B', NULL);

  -- El espejo de la NC A, armado acá SOLO para la prueba (en la app lo arma
  -- `construirAsientoDeReversion`, y el RPC lo VERIFICA, no lo recalcula).
  SELECT jsonb_agg(jsonb_build_object(
           'account_code', c.code, 'debit', l.credit, 'credit', l.debit,
           'description', 'Reversión') ORDER BY l.line_order)
    INTO v_lineas
    FROM public.journal_entry_lines l
    JOIN public.chart_of_accounts c ON c.id = l.account_id
   WHERE l.entry_id = v_asiento_a;

  -- ══════════════════════════════════════════════════════════════════════════
  -- [1] Rechazos previos: motivo corto, fecha vieja, espejo que no espeja
  -- ══════════════════════════════════════════════════════════════════════════
  BEGIN
    v_res := public.reverse_credit_note(v_tenant, v_nc_a, 'no', current_date, 'x', v_lineas, NULL);
    RAISE NOTICE '[1] motivo de 2 caracteres .................... ⚠️ PASÓ (debía fallar)';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[1] motivo de 2 caracteres .................... ✅ RECHAZADO: %', left(v_err, 60);
  END;

  BEGIN
    v_res := public.reverse_credit_note(v_tenant, v_nc_a, 'motivo válido',
                                        current_date - 30, 'x', v_lineas, NULL);
    RAISE NOTICE '[2] fecha de hace 30 días ..................... ⚠️ PASÓ (debía fallar)';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[2] fecha de hace 30 días ..................... ✅ RECHAZADA: %', left(v_err, 60);
  END;

  BEGIN
    v_res := public.reverse_credit_note(v_tenant, v_nc_a, 'motivo válido', current_date, 'x',
      jsonb_build_array(
        jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 99.00),
        jsonb_build_object('account_code', '110001', 'debit', 99.00, 'credit', 0)), NULL);
    RAISE NOTICE '[3] líneas que no son el espejo ............... ⚠️ PASÓ (debía fallar)';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[3] líneas que no son el espejo ............... ✅ RECHAZADAS: %', left(v_err, 60);
  END;

  -- ══════════════════════════════════════════════════════════════════════════
  -- [4] 🔴 UNA NC SIN ASIENTO PROPIO NO SE REVERSA (la que sale de anular)
  -- ══════════════════════════════════════════════════════════════════════════
  DECLARE v_nc_sin uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.credit_notes
      (id, tenant_id, credit_note_number, invoice_id, client_id, issue_date, reason,
       status, subtotal_total, tax_total, grand_total)
    VALUES (v_nc_sin, v_tenant, 'NC-TEST-SIN', v_factura, v_cliente, current_date,
            'Prueba 060 — sin asiento', 'emitida', 0.00, 0.00, 0.00);
    BEGIN
      v_res := public.reverse_credit_note(v_tenant, v_nc_sin, 'motivo válido', current_date,
                                          'x', v_lineas, NULL);
      RAISE NOTICE '[4] NC sin asiento propio ..................... ⚠️ PASÓ (debía fallar)';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      RAISE NOTICE '[4] NC sin asiento propio ..................... ✅ RECHAZADA: %', left(v_err, 90);
    END;
    -- No se borra: T6 lo impide a propósito («una NC no se elimina, se reversa»)
    -- y no hace falta — va con grand_total 0, así que no mueve `credited_total`,
    -- y el ROLLBACK del final se la lleva igual.
  END;

  -- ══════════════════════════════════════════════════════════════════════════
  -- [5] Falla forzada DESPUÉS del posteo: se deshace todo, correlativo incluido
  -- ══════════════════════════════════════════════════════════════════════════
  -- 🔴 La foto del correlativo se toma ACÁ, no al principio: entre medio el
  --    montaje posteó dos asientos y lo movió. Comparar contra el valor de
  --    arriba diría "56 → 58" y no probaría nada.
  SELECT last_number INTO v_seq_antes
    FROM public.accounting_sequences
   WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';

  BEGIN
    BEGIN
      v_res := public.reverse_credit_note(v_tenant, v_nc_a, 'motivo válido', current_date,
                                          'BOOM', v_lineas, NULL);
      -- Se fuerza la falla DESPUÉS de que el RPC devolvió, dentro del mismo
      -- bloque, para comprobar que el subbloque revierte posteo y correlativo.
      RAISE EXCEPTION 'BOOM simulado después del posteo';
    END;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    SELECT count(*) INTO v_n FROM public.journal_entries
     WHERE tenant_id = v_tenant AND reverses_entry_id = v_asiento_a;
    SELECT last_number INTO v_seq_desp FROM public.accounting_sequences
     WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
    SELECT status INTO v_nc_st FROM public.credit_notes WHERE id = v_nc_a;
    IF v_n = 0 AND v_nc_st = 'emitida' AND v_seq_desp = v_seq_antes THEN
      RAISE NOTICE '[5] falla forzada tras el posteo .............. ✅ TODO DESHECHO (0 espejos, NC sigue "%", correlativo % intacto)',
        v_nc_st, v_seq_desp;
    ELSE
      RAISE NOTICE '[5] falla forzada tras el posteo .............. ❌ QUEDÓ A MEDIAS: % espejo(s), NC "%", correlativo % → %',
        v_n, v_nc_st, v_seq_antes, v_seq_desp;
    END IF;
  END;

  -- ══════════════════════════════════════════════════════════════════════════
  -- [6] LA REVERSIÓN DE VERDAD — NC parcial A, sobre factura con pago parcial
  -- ══════════════════════════════════════════════════════════════════════════
  v_res := public.reverse_credit_note(v_tenant, v_nc_a, 'Prueba 060 — reversión',
                                      current_date, 'Reversión NC-TEST-A', v_lineas, NULL);

  SELECT credited_total, balance_due, status INTO v_cred_2, v_bal_2, v_st_2
    FROM public.invoices WHERE id = v_factura;
  SELECT status INTO v_nc_st FROM public.credit_notes WHERE id = v_nc_a;

  RAISE NOTICE '[6] reversión ................................. ✅ asiento % revierte al %',
    v_res->>'entry_number', v_res->>'reversed_entry_number';

  -- 🔴 EL CORAZÓN: quedó SOLO la NC B (1.00), no cero. Recalculado, no restado.
  IF v_cred_2 = 1.00 AND v_bal_2 = v_bal_0 - 1.00 AND v_nc_st = 'anulada' THEN
    RAISE NOTICE '    ✅ acreditado % → % (queda solo NC-B) · saldo % → % · NC "%"',
      v_cred_1, v_cred_2, v_bal_1, v_bal_2, v_nc_st;
  ELSE
    RAISE NOTICE '    ❌ acreditado % (esperado 1.00) · saldo % (esperado %) · NC "%"',
      v_cred_2, v_bal_2, v_bal_0 - 1.00, v_nc_st;
  END IF;

  -- El status de la factura lo deriva T7a contra el total NETO.
  IF v_st_2 = v_st_1 THEN
    RAISE NOTICE '    ✅ status de la factura "%": lo recalculó el trigger', v_st_2;
  ELSE
    RAISE NOTICE '    ⚠️ status % → %', v_st_1, v_st_2;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- [7] El asiento espejo: cuadra, es 'reversion', lleva la fecha de HOY
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT je.transaction_date, sum(l.debit), sum(l.credit)
    INTO v_fecha, v_deb, v_cre
    FROM public.journal_entries je
    JOIN public.journal_entry_lines l ON l.entry_id = je.id
   WHERE je.id = (v_res->>'entry_id')::uuid
   GROUP BY je.transaction_date;

  SELECT count(*) INTO v_n FROM public.journal_entries
   WHERE id = (v_res->>'entry_id')::uuid
     AND source_type = 'reversion' AND reverses_entry_id = v_asiento_a
     AND source_id = v_nc_a AND reversal_reason IS NOT NULL;

  IF v_n = 1 AND v_fecha = current_date AND v_deb = v_cre AND v_deb = 2.00 THEN
    RAISE NOTICE '[7] el asiento espejo ......................... ✅ reversion · reverses_entry_id · fecha % · cuadra (% = %)',
      v_fecha, v_deb, v_cre;
  ELSE
    RAISE NOTICE '[7] el asiento espejo ......................... ❌ n=% fecha=% debe=% haber=%',
      v_n, v_fecha, v_deb, v_cre;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- [8] Reversar DOS VECES: no duplica nada
  -- ══════════════════════════════════════════════════════════════════════════
  BEGIN
    v_res := public.reverse_credit_note(v_tenant, v_nc_a, 'Prueba 060 — otra vez',
                                        current_date, 'x', v_lineas, NULL);
    RAISE NOTICE '[8] reversar dos veces ........................ ⚠️ PASÓ (debía fallar)';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    SELECT count(*) INTO v_n FROM public.journal_entries
     WHERE tenant_id = v_tenant AND reverses_entry_id = v_asiento_a;
    RAISE NOTICE '[8] reversar dos veces ........................ ✅ RECHAZADA (sigue habiendo % espejo): %',
      v_n, left(v_err, 55);
  END;

  -- ══════════════════════════════════════════════════════════════════════════
  -- [9] La NC B sigue intacta: anular una no toca a la otra
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT status INTO v_nc_st FROM public.credit_notes WHERE id = v_nc_b;
  SELECT count(*) INTO v_n FROM public.journal_entries WHERE reverses_entry_id = v_asiento_b;
  IF v_nc_st = 'emitida' AND v_n = 0 THEN
    RAISE NOTICE '[9] la otra NC parcial ........................ ✅ sigue "%" y sin reversar', v_nc_st;
  ELSE
    RAISE NOTICE '[9] la otra NC parcial ........................ ❌ "%" con % reversión(es)', v_nc_st, v_n;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- [10] Anular la NC B también: el acreditado vuelve a CERO, y el saldo al
  --      valor original. Es el caso "NC total anulada" llevado al final.
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT jsonb_agg(jsonb_build_object(
           'account_code', c.code, 'debit', l.credit, 'credit', l.debit,
           'description', 'Reversión') ORDER BY l.line_order)
    INTO v_lineas
    FROM public.journal_entry_lines l
    JOIN public.chart_of_accounts c ON c.id = l.account_id
   WHERE l.entry_id = v_asiento_b;

  v_res := public.reverse_credit_note(v_tenant, v_nc_b, 'Prueba 060 — reversión B',
                                      current_date, 'Reversión NC-TEST-B', v_lineas, NULL);

  SELECT credited_total, balance_due, status INTO v_cred_2, v_bal_2, v_st_2
    FROM public.invoices WHERE id = v_factura;

  IF v_cred_2 = 0 AND v_bal_2 = v_bal_0 AND v_st_2 = v_st_0 THEN
    RAISE NOTICE '[10] las dos NC anuladas ...................... ✅ acreditado 0 · saldo % (el original) · status "%"',
      v_bal_2, v_st_2;
  ELSE
    RAISE NOTICE '[10] las dos NC anuladas ...................... ❌ acreditado % · saldo % (esperado %) · status % (esperado %)',
      v_cred_2, v_bal_2, v_bal_0, v_st_2, v_st_0;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- [11] La cadena de hash del libro sigue íntegra
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT count(*) INTO v_n FROM (
    SELECT je.id, je.prev_hash,
           lag(je.hash) OVER (PARTITION BY je.tenant_id ORDER BY je.entry_number) AS anterior
      FROM public.journal_entries je WHERE je.tenant_id = v_tenant
  ) s WHERE s.anterior IS NOT NULL AND s.prev_hash IS DISTINCT FROM s.anterior;
  IF v_n = 0 THEN
    RAISE NOTICE '[11] cadena de hash ........................... ✅ ÍNTEGRA';
  ELSE
    RAISE NOTICE '[11] cadena de hash ........................... ❌ % problema(s)', v_n;
  END IF;
END $$;

ROLLBACK;
