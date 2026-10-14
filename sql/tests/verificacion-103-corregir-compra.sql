-- ============================================================================
-- VERIFICACIÓN de la 103 · corregir una compra contabilizada (staging).
-- 🛡️ TODO DENTRO DE UN ROLLBACK. Misma lógica que verificacion-103-produccion.sql
-- (que además se deshace sola con una excepción centinela).
--
--   node scripts/run-sql.mjs sql/tests/verificacion-103-corregir-compra.sql
--
-- Casos: [1] corrección con fecha de registro, monto y cuenta nuevos; [2] otra
-- seguida; [3] versión vieja; [4] asiento que no corresponde; [5] espejo falso;
-- [6] sin motivo; [7] mes del asiento cerrado; [8] con pago; [9] fecha nueva en
-- un mes cerrado; [10] con nota de crédito; [11] historial inmutable; [12] un
-- asiento por documento fuera de una corrección; [13] permisos.
-- ============================================================================
BEGIN;
DO $$
DECLARE
  T          uuid;
  v_nt       int;
  v_hoy      date := (now() AT TIME ZONE 'America/Panama')::date;
  v_nueva    date;
  v_prv      uuid;
  v_cta1     text;
  v_cta2     text;
  v_tax      uuid;
  v_rate     numeric;
  v_taxcta   text;
  v_compra   uuid;
  v_e1       uuid;
  v_e2       uuid;
  v_e3       uuid;
  v_espejo   jsonb;
  v_cab      jsonb;
  v_lin      jsonb;
  v_as       jsonb;
  v_r        jsonb;
  v_n        int;
  v_saldo    numeric;
  v_imp      numeric;
  v_err      text;
  v_log      text := '';
  v_fail     int := 0;
  v_nc_compra uuid;
  v_nc_entry  uuid;
BEGIN
  SELECT count(DISTINCT tenant_id) INTO v_nt FROM chart_of_accounts WHERE code = '100004';
  IF v_nt <> 1 THEN
    RAISE EXCEPTION '103: se esperaba un solo bufete con plan de cuentas y hay %. No se probó nada.', v_nt;
  END IF;
  SELECT DISTINCT tenant_id INTO T FROM chart_of_accounts WHERE code = '100004';
  IF to_regprocedure('public.corregir_compra(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid)') IS NULL THEN
    RAISE EXCEPTION '103: la función corregir_compra no existe. ¿Se aplicó la 103?';
  END IF;

  BEGIN  -- ── todo lo de acá adentro se deshace al final ──
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    IF v_hoy < public.finanzas_inicio_contable(T) THEN
      RAISE EXCEPTION 'hoy (%) es anterior al inicio contable: la prueba necesita una compra desde el inicio', v_hoy;
    END IF;
    PERFORM public.ensure_accounting_periods(T, extract(year FROM v_hoy)::int);
    UPDATE accounting_periods SET status = 'abierto', closed_at = NULL
     WHERE tenant_id = T AND year = extract(year FROM v_hoy) AND month = extract(month FROM v_hoy);
    v_nueva := CASE WHEN extract(day FROM v_hoy) > 1 THEN v_hoy - 1 ELSE v_hoy END;

    SELECT id INTO v_prv FROM suppliers WHERE tenant_id = T AND active ORDER BY created_at LIMIT 1;
    IF v_prv IS NULL THEN
      INSERT INTO suppliers (tenant_id, supplier_number, legal_name) VALUES (T, 'PRV-VERIF-103', 'Proveedor de la verificación 103')
      RETURNING id INTO v_prv;
    END IF;
    SELECT code INTO v_cta1 FROM chart_of_accounts WHERE tenant_id = T AND active AND account_type = 'expense'
      AND cuenta_control IS NULL ORDER BY (code = '610005') DESC, code LIMIT 1;
    SELECT code INTO v_cta2 FROM chart_of_accounts WHERE tenant_id = T AND active AND account_type = 'expense'
      AND cuenta_control IS NULL AND code <> v_cta1 ORDER BY code LIMIT 1;
    SELECT id, rate, coalesce(account_code, '200003') INTO v_tax, v_rate, v_taxcta
      FROM tax_codes WHERE tenant_id = T AND active AND rate > 0 ORDER BY (code = 'ITBMS_7') DESC LIMIT 1;
    IF v_cta1 IS NULL OR v_cta2 IS NULL OR v_tax IS NULL THEN
      RAISE EXCEPTION 'faltan dos cuentas de gasto activas o una tasa con impuesto para armar la compra de prueba';
    END IF;
    v_log := v_log || E'\n·  bufete ' || T || ', hoy ' || v_hoy || ', cuentas ' || v_cta1 || ' y ' || v_cta2;

    -- La compra de prueba, contabilizada como lo hace el alta (100 + impuesto).
    v_imp := round(100 * v_rate, 2);
    INSERT INTO business_expenses (tenant_id, purchase_number, expense_date, accounting_date, due_date, supplier_id,
                                   description, subtotal, tax_rate, tax_amount, status)
    VALUES (T, 'FAC-CO-9910300', v_hoy, v_hoy, v_hoy, v_prv, 'Verificación 103', 100, v_rate, v_imp, 'pendiente_pago')
    RETURNING id INTO v_compra;
    INSERT INTO expense_lines (tenant_id, business_expense_id, line_order, description, chart_account_code, amount, tax_code_id, tax_rate, tax_amount)
    VALUES (T, v_compra, 1, 'Línea de prueba', v_cta1, 100, v_tax, v_rate, v_imp);
    v_e1 := post_journal_entry(T, v_hoy, 'Compra Verificación 103', 'gasto',
      jsonb_build_array(
        jsonb_build_object('account_code', v_cta1, 'debit', 100, 'credit', 0, 'description', 'Línea de prueba'),
        jsonb_build_object('account_code', v_taxcta, 'debit', v_imp, 'credit', 0, 'description', 'ITBMS'),
        jsonb_build_object('account_code', '200001', 'debit', 0, 'credit', 100 + v_imp, 'supplier_id', v_prv)),
      v_compra, NULL, NULL, NULL, NULL, NULL, 'FAC-CO-9910300', 'compra:' || v_compra, NULL);

    -- La corrección: fecha de registro nueva, 120 en vez de 100, y otra cuenta.
    v_imp := round(120 * v_rate, 2);
    v_cab := jsonb_build_object('expense_date', v_hoy, 'accounting_date', v_nueva, 'due_date', v_hoy, 'supplier_id', v_prv,
               'description', 'Verificación 103 corregida', 'subtotal', 120, 'tax_rate', v_rate, 'tax_amount', v_imp,
               'supplier_invoice_number', 'F-103');
    v_lin := jsonb_build_array(jsonb_build_object('description', 'Línea corregida', 'chart_account_code', v_cta2,
               'amount', 120, 'tax_code_id', v_tax, 'tax_rate', v_rate, 'tax_amount', v_imp));
    v_as := jsonb_build_object('transaction_date', v_nueva, 'description', 'Compra Verificación 103 corregida', 'lines',
      jsonb_build_array(
        jsonb_build_object('account_code', v_cta2, 'debit', 120, 'credit', 0, 'description', 'Línea corregida'),
        jsonb_build_object('account_code', v_taxcta, 'debit', v_imp, 'credit', 0, 'description', 'ITBMS'),
        jsonb_build_object('account_code', '200001', 'debit', 0, 'credit', 120 + v_imp, 'supplier_id', v_prv)));
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit,
             'description', 'Reversión', 'supplier_id', l.supplier_id)) ORDER BY l.line_order)
      INTO v_espejo FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.entry_id = v_e1;

    -- [4] Un asiento que no es el de la compra corregida: nada cambia.
    BEGIN
      PERFORM corregir_compra(T, v_compra, v_e1, 'Verificación: asiento ajeno', v_cab, v_lin, v_espejo,
        jsonb_set(v_as, '{lines,2,credit}', to_jsonb(119 + v_imp)), NULL);
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [4] entró un asiento que no corresponde';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE reverses_entry_id = v_e1)
         AND (SELECT subtotal FROM business_expenses WHERE id = v_compra) = 100 THEN
        v_log := v_log || E'\n✅ [4] asiento que no corresponde: rechazado y la compra sigue igual';
      ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [4] quedó algo a medias: ' || v_err; END IF;
    END;

    -- [5] Espejo falso.
    BEGIN
      PERFORM corregir_compra(T, v_compra, v_e1, 'Verificación: espejo malo', v_cab, v_lin,
        jsonb_set(v_espejo, '{0,debit}', '1'), v_as, NULL);
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [5] entró con un espejo falso';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%espejo exacto%' THEN v_log := v_log || E'\n✅ [5] espejo falso: rechazado';
      ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [5] otro motivo: ' || v_err; END IF;
    END;

    -- [6] Sin motivo.
    BEGIN
      PERFORM corregir_compra(T, v_compra, v_e1, ' ', v_cab, v_lin, v_espejo, v_as, NULL);
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [6] se corrigió sin motivo';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%motivo%' THEN v_log := v_log || E'\n✅ [6] sin motivo: rechazada';
      ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [6] otro motivo: ' || v_err; END IF;
    END;

    -- [7] El mes del asiento de la compra cerrado.
    BEGIN
      UPDATE accounting_periods SET status = 'cerrado', closed_at = now()
       WHERE tenant_id = T AND year = extract(year FROM v_hoy) AND month = extract(month FROM v_hoy);
      BEGIN
        PERFORM corregir_compra(T, v_compra, v_e1, 'Verificación: mes cerrado', v_cab, v_lin, v_espejo, v_as, NULL);
        v_fail := v_fail + 1; v_log := v_log || E'\n❌ [7] se corrigió con el mes cerrado';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err LIKE '%mes del asiento de la compra%cerrado%' THEN v_log := v_log || E'\n✅ [7] mes del asiento cerrado: rechazada';
        ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [7] otro motivo: ' || v_err; END IF;
      END;
      RAISE EXCEPTION USING ERRCODE = 'P0100', MESSAGE = 'deshacer [7]';
    EXCEPTION WHEN SQLSTATE 'P0100' THEN NULL;
    END;

    -- [8] Un pago registrado (un saldo heredado basta): primero se reversa.
    BEGIN
      INSERT INTO supplier_payments (tenant_id, business_expense_id, kind, payment_date, amount, status)
      VALUES (T, v_compra, 'migrated_balance', v_hoy, 1, 'registrado');
      BEGIN
        PERFORM corregir_compra(T, v_compra, v_e1, 'Verificación: con pago', v_cab, v_lin, v_espejo, v_as, NULL);
        v_fail := v_fail + 1; v_log := v_log || E'\n❌ [8] se corrigió una compra con pago';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err LIKE '%pago(s) registrado(s)%' THEN v_log := v_log || E'\n✅ [8] con pago: rechazada y dice qué reversar';
        ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [8] otro motivo: ' || v_err; END IF;
      END;
      RAISE EXCEPTION USING ERRCODE = 'P0100', MESSAGE = 'deshacer [8]';
    EXCEPTION
      WHEN SQLSTATE 'P0100' THEN NULL;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        v_log := v_log || E'\n⏭  [8] no se pudo crear el pago de prueba: ' || v_err;
    END;

    -- [1] La corrección buena.
    v_r := corregir_compra(T, v_compra, v_e1, 'Factura del proveedor por 120, no 100', v_cab, v_lin, v_espejo, v_as, NULL);
    v_e2 := (v_r->>'entry_id')::uuid;
    SELECT coalesce(sum(l.credit - l.debit), 0) INTO v_saldo
      FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.entry_id JOIN chart_of_accounts c ON c.id = l.account_id
     WHERE j.tenant_id = T AND j.source_id = v_compra AND c.code = '200001';
    IF (v_r->>'version')::int = 2
       AND (SELECT transaction_date FROM journal_entries WHERE id = (v_r->>'reversal_entry_id')::uuid) = v_hoy
       AND (SELECT transaction_date FROM journal_entries WHERE id = v_e2) = v_nueva
       AND (SELECT accounting_date FROM business_expenses WHERE id = v_compra) = v_nueva
       AND (SELECT chart_account_code FROM expense_lines WHERE business_expense_id = v_compra) = v_cta2
       AND (SELECT purchase_number FROM business_expenses WHERE id = v_compra) = 'FAC-CO-9910300'
       AND EXISTS (SELECT 1 FROM compra_correcciones WHERE business_expense_id = v_compra AND version = 2
                     AND entry_anterior_id = v_e1 AND motivo = 'Factura del proveedor por 120, no 100')
       AND v_saldo = 120 + v_imp THEN
      v_log := v_log || E'\n✅ [1] corrección v2: reversión al ' || v_hoy || ', asiento nuevo al ' || v_nueva
               || ' con la cuenta ' || v_cta2 || '; 200001 de la compra = ' || v_saldo;
    ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [1] ' || v_r::text || ' · 200001 ' || v_saldo; END IF;

    -- [2] Segunda corrección seguida (v3): vuelve a la primera cuenta.
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit,
             'description', 'Reversión', 'supplier_id', l.supplier_id)) ORDER BY l.line_order)
      INTO v_espejo FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.entry_id = v_e2;
    v_r := corregir_compra(T, v_compra, v_e2, 'La cuenta era la primera', v_cab,
             jsonb_set(v_lin, '{0,chart_account_code}', to_jsonb(v_cta1)), v_espejo,
             jsonb_set(v_as, '{lines,0,account_code}', to_jsonb(v_cta1)), NULL);
    v_e3 := (v_r->>'entry_id')::uuid;
    SELECT count(*) INTO v_n FROM journal_entries je
     WHERE je.tenant_id = T AND je.source_type = 'gasto' AND je.source_id = v_compra
       AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = je.id);
    IF (v_r->>'version')::int = 3 AND v_n = 1
       AND (SELECT count(*) FROM compra_correcciones WHERE business_expense_id = v_compra) = 2 THEN
      v_log := v_log || E'\n✅ [2] segunda corrección: v3, un solo asiento vigente';
    ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [2] ' || v_r::text || ' · vigentes ' || v_n; END IF;

    -- [3] Corregir sobre una versión vieja.
    BEGIN
      PERFORM corregir_compra(T, v_compra, v_e2, 'Verificación: versión vieja', v_cab, v_lin, v_espejo, v_as, NULL);
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [3] se corrigió sobre una versión vieja';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%cambió mientras la corregías%' THEN v_log := v_log || E'\n✅ [3] versión vieja: rechazada';
      ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [3] otro motivo: ' || v_err; END IF;
    END;

    -- [9] La fecha de registro nueva en un mes cerrado (el anterior al actual, si es desde el inicio).
    IF date_trunc('month', v_hoy)::date - 1 >= public.finanzas_inicio_contable(T) THEN
      BEGIN
        PERFORM public.ensure_accounting_periods(T, extract(year FROM (date_trunc('month', v_hoy)::date - 1))::int);
        UPDATE accounting_periods SET status = 'cerrado', closed_at = now()
         WHERE tenant_id = T AND year = extract(year FROM (date_trunc('month', v_hoy)::date - 1))
           AND month = extract(month FROM (date_trunc('month', v_hoy)::date - 1));
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit,
                 'description', 'Reversión', 'supplier_id', l.supplier_id)) ORDER BY l.line_order)
          INTO v_espejo FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.entry_id = v_e3;
        BEGIN
          PERFORM corregir_compra(T, v_compra, v_e3, 'Verificación: mes nuevo cerrado',
            jsonb_set(v_cab, '{accounting_date}', to_jsonb(date_trunc('month', v_hoy)::date - 1)), v_lin, v_espejo,
            jsonb_set(v_as, '{transaction_date}', to_jsonb(date_trunc('month', v_hoy)::date - 1)), NULL);
          v_fail := v_fail + 1; v_log := v_log || E'\n❌ [9] se corrigió hacia un mes cerrado';
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
          IF v_err LIKE '%fecha de registro nueva%cerrado%' THEN v_log := v_log || E'\n✅ [9] fecha nueva en un mes cerrado: rechazada';
          ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [9] otro motivo: ' || v_err; END IF;
        END;
        RAISE EXCEPTION USING ERRCODE = 'P0100', MESSAGE = 'deshacer [9]';
      EXCEPTION WHEN SQLSTATE 'P0100' THEN NULL;
      END;
    ELSE
      v_log := v_log || E'\n⏭  [9] el mes anterior es anterior al inicio contable: no aplica';
    END IF;

    -- [10] Una compra con nota de crédito (si el bufete tiene alguna).
    SELECT n.business_expense_id INTO v_nc_compra FROM supplier_credit_notes n
     WHERE n.tenant_id = T AND n.status = 'emitida' AND n.business_expense_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM supplier_payments p WHERE p.business_expense_id = n.business_expense_id AND p.status = 'registrado')
     LIMIT 1;
    IF v_nc_compra IS NULL THEN
      v_log := v_log || E'\n⏭  [10] no hay compras con nota de crédito sin pagos para probar';
    ELSE
      SELECT je.id INTO v_nc_entry FROM journal_entries je
       WHERE je.tenant_id = T AND je.source_type = 'gasto' AND je.source_id = v_nc_compra
         AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = je.id);
      BEGIN
        PERFORM corregir_compra(T, v_nc_compra, v_nc_entry, 'Verificación: con NC', v_cab, v_lin, v_espejo, v_as, NULL);
        v_fail := v_fail + 1; v_log := v_log || E'\n❌ [10] se corrigió una compra con nota de crédito';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err LIKE '%nota(s) de crédito%' THEN v_log := v_log || E'\n✅ [10] con nota de crédito: rechazada';
        ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [10] otro motivo: ' || v_err; END IF;
      END;
    END IF;

    -- [11] El historial no se edita.
    BEGIN
      UPDATE compra_correcciones SET motivo = 'a mano' WHERE business_expense_id = v_compra;
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [11] se editó el historial';
    EXCEPTION WHEN check_violation THEN
      v_log := v_log || E'\n✅ [11] el historial no se edita';
    END;

    -- [12] Fuera de una corrección, sigue habiendo UN asiento por documento.
    BEGIN
      PERFORM post_journal_entry(T, v_hoy, 'Duplicado', 'gasto',
        jsonb_build_array(jsonb_build_object('account_code', v_cta1, 'debit', 1, 'credit', 0),
                          jsonb_build_object('account_code', '200001', 'debit', 0, 'credit', 1, 'supplier_id', v_prv)),
        v_compra, NULL, NULL, NULL, NULL, NULL, NULL, 'compra-duplicada:' || v_compra, NULL);
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [12] entró un segundo asiento de la compra sin ser corrección';
    EXCEPTION WHEN unique_violation THEN
      v_log := v_log || E'\n✅ [12] un segundo asiento de la compra fuera de una corrección: rechazado';
    END;

    RAISE EXCEPTION USING ERRCODE = 'P0103', MESSAGE = 'deshacer la prueba';
  EXCEPTION
    WHEN SQLSTATE 'P0103' THEN NULL;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ error inesperado (todo deshecho): ' || v_err;
  END;

  -- [13] Permisos.
  IF has_function_privilege('authenticated', 'public.corregir_compra(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid)', 'EXECUTE') THEN
    v_fail := v_fail + 1; v_log := v_log || E'\n❌ [13] authenticated puede ejecutar corregir_compra';
  ELSE v_log := v_log || E'\n✅ [13] sólo service_role ejecuta corregir_compra'; END IF;

  IF v_fail > 0 THEN
    RAISE EXCEPTION E'103: % caso(s) fallaron.%', v_fail, v_log;
  END IF;
  PERFORM set_config('verificacion.resultado', '103: todos los casos pasaron.' || v_log, false);
END $$;

SELECT current_setting('verificacion.resultado', true) AS resultado;

ROLLBACK;
