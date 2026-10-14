-- ============================================================================
-- VERIFICACIÓN de la 102 PARA PRODUCCIÓN (SQL Editor de Supabase).
-- No deja NADA escrito: todo corre dentro de un sub-bloque que termina SIEMPRE
-- con una excepción centinela (P0102), que deshace cada escritura. No depende
-- de BEGIN/ROLLBACK ni de los NOTICE ni de los comentarios.
-- El tenant sale de los datos: el único bufete con plan de cuentas (100004).
-- Resultado: una fila «102: todos los casos pasaron.» con el log. Si algo
-- falla, el editor muestra un ERROR «102: N caso(s) fallaron.» con el log.
-- ============================================================================
DO $$
DECLARE
  T          uuid;
  v_nt       int;
  v_fecha    date;
  v_cli      uuid;
  v_prv      uuid;
  v_lines    jsonb;
  v_lines2   jsonb;
  v_r        jsonb;
  v_ap1      uuid;
  v_ap2      uuid;
  v_ap3      uuid;
  v_entry    uuid;
  v_espejo   jsonb;
  v_n        int;
  v_saldo    numeric;
  v_err      text;
  v_log      text := '';
  v_fail     int := 0;
BEGIN
  SELECT count(DISTINCT tenant_id) INTO v_nt FROM chart_of_accounts WHERE code = '100004';
  IF v_nt <> 1 THEN
    RAISE EXCEPTION '102: se esperaba un solo bufete con plan de cuentas y hay %. No se probó nada.', v_nt;
  END IF;
  SELECT DISTINCT tenant_id INTO T FROM chart_of_accounts WHERE code = '100004';
  IF to_regprocedure('public.corregir_apertura(uuid, uuid, text, jsonb, jsonb, text, uuid)') IS NULL THEN
    RAISE EXCEPTION '102: la función corregir_apertura no existe. ¿Se aplicó la 102?';
  END IF;

  BEGIN  -- ── todo lo de acá adentro se deshace al final ──
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    v_fecha := public.finanzas_fecha_apertura(T);
    v_log := v_log || E'\n·  bufete ' || T || ', fecha de la apertura ' || v_fecha;

    PERFORM public.ensure_accounting_periods(T, extract(year FROM v_fecha)::int);
    UPDATE accounting_periods SET status = 'abierto', closed_at = NULL
     WHERE tenant_id = T AND year = extract(year FROM v_fecha) AND month = extract(month FROM v_fecha);

    SELECT entry_id INTO v_entry FROM aperturas WHERE tenant_id = T AND estado = 'vigente';
    IF v_entry IS NOT NULL THEN
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit,
               'description', 'Reversión', 'client_id', l.client_id, 'supplier_id', l.supplier_id)) ORDER BY l.line_order)
        INTO v_espejo FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.entry_id = v_entry;
      PERFORM reverse_journal_entry(T, v_entry, 'Verificación 102: partir de cero', v_fecha, 'Reversión', v_espejo, NULL);
      v_log := v_log || E'\n·  había una apertura vigente: se reversó SÓLO dentro de la prueba (se deshace)';
    END IF;

    SELECT id INTO v_cli FROM clients WHERE tenant_id = T AND NOT coalesce(es_de_prueba, false) ORDER BY created_at LIMIT 1;
    SELECT id INTO v_prv FROM suppliers WHERE tenant_id = T AND active ORDER BY created_at LIMIT 1;
    IF v_prv IS NULL THEN
      INSERT INTO suppliers (tenant_id, supplier_number, legal_name) VALUES (T, 'PRV-VERIF-102', 'Proveedor de la verificación 102')
      RETURNING id INTO v_prv;
    END IF;

    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '100004', 'debit', 100000, 'credit', 0, 'description', 'Apertura: QB-102',
        'client_id', v_cli, 'documento_externo', 'QB-102', 'fecha_documento', v_fecha - 20, 'vencimiento', v_fecha + 10),
      jsonb_build_object('account_code', '200001', 'debit', 0, 'credit', 5000, 'description', 'Apertura: F-102',
        'supplier_id', v_prv, 'documento_externo', 'F-102', 'fecha_documento', v_fecha - 5),
      jsonb_build_object('account_code', '100001', 'debit', 5000, 'credit', 0, 'description', 'Apertura: banco'),
      jsonb_build_object('account_code', '300002', 'debit', 0, 'credit', 100000, 'description', 'Apertura: resultados'));
    v_r := post_apertura(T, NULL, v_lines, 'apertura-102.xlsx', 'hash-102-v1', NULL);
    v_ap1 := (v_r->>'apertura_id')::uuid;
    v_entry := (v_r->>'entry_id')::uuid;
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit,
             'description', 'Reversión', 'client_id', l.client_id, 'supplier_id', l.supplier_id)) ORDER BY l.line_order)
      INTO v_espejo FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.entry_id = v_entry;
    v_lines2 := jsonb_set(jsonb_set(v_lines, '{0,debit}', '90000'), '{2,debit}', '15000');

    -- [5] No cuadra: nada cambia.
    BEGIN
      PERFORM corregir_apertura(T, v_ap1, 'Verificación: no cuadra', v_espejo, jsonb_set(v_lines2, '{2,debit}', '5000'), 'h5', NULL);
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [5] entró una corrección que no cuadra';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap1 AND estado = 'vigente')
         AND NOT EXISTS (SELECT 1 FROM journal_entries WHERE reverses_entry_id = v_entry) THEN
        v_log := v_log || E'\n✅ [5] no cuadra: rechazada y sin reversión a medias';
      ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [5] quedó algo a medias: ' || v_err; END IF;
    END;

    -- [6] 100004 sin documento externo.
    BEGIN
      PERFORM corregir_apertura(T, v_ap1, 'Verificación: sin documento', v_espejo, jsonb_set(v_lines2, '{0,documento_externo}', '""'), 'h6', NULL);
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [6] entró 100004 sin documento';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%documento externo%' AND EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap1 AND estado = 'vigente') THEN
        v_log := v_log || E'\n✅ [6] sin documento: rechazada';
      ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [6] otro motivo: ' || v_err; END IF;
    END;

    -- [7] Espejo que no es el del libro.
    BEGIN
      PERFORM corregir_apertura(T, v_ap1, 'Verificación: espejo malo', jsonb_set(v_espejo, '{0,credit}', '1'), v_lines2, 'h7', NULL);
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [7] entró con un espejo falso';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%espejo exacto%' AND EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap1 AND estado = 'vigente') THEN
        v_log := v_log || E'\n✅ [7] espejo falso: rechazada';
      ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [7] otro motivo: ' || v_err; END IF;
    END;

    -- [8] Mes de la apertura cerrado.
    BEGIN
      UPDATE accounting_periods SET status = 'cerrado', closed_at = now()
       WHERE tenant_id = T AND year = extract(year FROM v_fecha) AND month = extract(month FROM v_fecha);
      BEGIN
        PERFORM corregir_apertura(T, v_ap1, 'Verificación: mes cerrado', v_espejo, v_lines2, 'h8', NULL);
        v_fail := v_fail + 1; v_log := v_log || E'\n❌ [8] se corrigió con el mes cerrado';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err LIKE '%cerrado%mes abierto%' THEN v_log := v_log || E'\n✅ [8] mes cerrado: rechazada';
        ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [8] otro motivo: ' || v_err; END IF;
      END;
      RAISE EXCEPTION USING ERRCODE = 'P0100', MESSAGE = 'deshacer [8]';
    EXCEPTION WHEN SQLSTATE 'P0100' THEN NULL;
    END;

    -- [10] Sin motivo.
    BEGIN
      PERFORM corregir_apertura(T, v_ap1, '  ', v_espejo, v_lines2, 'h10', NULL);
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [10] se corrigió sin motivo';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%motivo%' THEN v_log := v_log || E'\n✅ [10] sin motivo: rechazada';
      ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [10] otro motivo: ' || v_err; END IF;
    END;

    -- [1] La corrección buena: CxC 100,000 → 90,000, la diferencia al banco.
    v_r := corregir_apertura(T, v_ap1, 'CxC según QuickBooks: 90,000', v_espejo, v_lines2, 'hash-102-v2', NULL);
    v_ap2 := (v_r->>'apertura_id')::uuid;
    SELECT coalesce(sum(l.debit - l.credit), 0) INTO v_saldo
      FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.entry_id JOIN chart_of_accounts c ON c.id = l.account_id
     WHERE j.tenant_id = T AND c.code = '100004' AND j.transaction_date = v_fecha
       AND (j.id IN (SELECT entry_id FROM aperturas WHERE id IN (v_ap1, v_ap2))
            OR j.reverses_entry_id IN (SELECT entry_id FROM aperturas WHERE id IN (v_ap1, v_ap2)));
    IF EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap1 AND estado = 'reversada')
       AND EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap2 AND estado = 'vigente' AND corrige_apertura_id = v_ap1)
       AND v_saldo = 90000 THEN
      v_log := v_log || E'\n✅ [1] corrección: la v1 reversada, la v2 vigente y ligada; 100004 en el libro = 90000';
    ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [1] ' || v_r::text || ' · saldo 100004 ' || v_saldo; END IF;

    -- [2] Partidas de la vigente (lo que lee la antigüedad).
    SELECT coalesce(sum(p.debit - p.credit), 0), count(*) INTO v_saldo, v_n
      FROM apertura_partidas p JOIN aperturas a ON a.id = p.apertura_id
     WHERE a.tenant_id = T AND a.estado = 'vigente' AND p.account_code = '100004';
    IF v_saldo = 90000 AND v_n = 1 THEN v_log := v_log || E'\n✅ [2] partidas de la vigente en 100004: 90000';
    ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [2] partidas 100004: ' || v_n || ' por ' || v_saldo; END IF;

    -- [3] Segunda corrección seguida.
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit,
             'description', 'Reversión', 'client_id', l.client_id, 'supplier_id', l.supplier_id)) ORDER BY l.line_order)
      INTO v_espejo FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id
     WHERE l.entry_id = (SELECT entry_id FROM aperturas WHERE id = v_ap2);
    v_r := corregir_apertura(T, v_ap2, 'Separar el banco en dos líneas', v_espejo,
             jsonb_set(v_lines2, '{2,debit}', '10000') || jsonb_build_array(
               jsonb_build_object('account_code', '100001', 'debit', 5000, 'credit', 0, 'description', 'Apertura: banco 2')),
             'hash-102-v3', NULL);
    v_ap3 := (v_r->>'apertura_id')::uuid;
    IF EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap3 AND estado = 'vigente' AND corrige_apertura_id = v_ap2 AND lineas = 5)
       AND (SELECT count(*) FROM aperturas WHERE tenant_id = T AND estado = 'vigente') = 1 THEN
      v_log := v_log || E'\n✅ [3] segunda corrección seguida: una sola vigente';
    ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [3] ' || v_r::text; END IF;

    -- [4] Corregir una versión que ya no es la vigente.
    BEGIN
      PERFORM corregir_apertura(T, v_ap2, 'Verificación: versión vieja', v_espejo, v_lines2, 'h4', NULL);
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [4] se corrigió una apertura reversada';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%ya no es la vigente%' THEN v_log := v_log || E'\n✅ [4] versión vieja: rechazada';
      ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [4] otro motivo: ' || v_err; END IF;
    END;

    -- [9] La liga no se escribe por fuera.
    BEGIN
      UPDATE aperturas SET corrige_apertura_id = v_ap1, motivo_correccion = 'a mano' WHERE id = v_ap3;
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [9] se reescribió la liga a mano';
    EXCEPTION WHEN check_violation THEN
      v_log := v_log || E'\n✅ [9] la liga no se escribe a mano';
    END;

    RAISE EXCEPTION USING ERRCODE = 'P0102', MESSAGE = 'deshacer la prueba';
  EXCEPTION
    WHEN SQLSTATE 'P0102' THEN NULL;  -- lo esperado: todo deshecho
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ error inesperado (todo deshecho): ' || v_err;
  END;

  -- [11] Permisos.
  IF has_function_privilege('authenticated', 'public.corregir_apertura(uuid, uuid, text, jsonb, jsonb, text, uuid)', 'EXECUTE') THEN
    v_fail := v_fail + 1; v_log := v_log || E'\n❌ [11] authenticated puede ejecutar corregir_apertura';
  ELSE v_log := v_log || E'\n✅ [11] sólo service_role ejecuta corregir_apertura'; END IF;

  IF v_fail > 0 THEN
    RAISE EXCEPTION E'102: % caso(s) fallaron.%', v_fail, v_log;
  END IF;
  PERFORM set_config('verificacion.resultado', '102: todos los casos pasaron.' || v_log, false);
END $$;

SELECT current_setting('verificacion.resultado', true) AS resultado;
