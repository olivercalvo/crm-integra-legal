-- ============================================================================
-- VERIFICACIÓN de la 102 · corregir la apertura (reversa + nueva, una transacción)
-- 🛡️ TODO DENTRO DE UN ROLLBACK.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-102-corregir-apertura.sql
--
-- Patrón de producción: no depende de leer los NOTICE. Cada caso escribe una
-- línea en v_log; si alguno falla, el bloque termina con RAISE EXCEPTION y el
-- log completo en el mensaje. Si todos pasan, el log sale en el SELECT final.
--
-- Si el bufete ya tiene una apertura vigente, se reversa ACÁ (dentro del
-- ROLLBACK) para partir de una apertura conocida.
--
-- Casos:
--   [1]  corregir 100004 de 100,000 a 90,000 y mandar la diferencia a 100001:
--        la vieja queda reversada con «Corrección de la apertura: …», la nueva
--        vigente y ligada, y el saldo de 100004 al corte es 90,000
--   [2]  las partidas de la vigente (las que lee la antigüedad) suman 90,000
--   [3]  una segunda corrección seguida: entra, tres versiones encadenadas
--   [4]  corregir una versión que ya no es la vigente: rechazado
--   [5]  líneas que no cuadran: rechazado y NADA cambia (la reversión se deshace)
--   [6]  100004 sin documento externo: rechazado y nada cambia
--   [7]  un espejo que no es el del libro: rechazado y nada cambia
--   [8]  con diciembre (el mes de la apertura) cerrado: rechazado con el mensaje
--        del ajuste en un mes abierto, y nada cambia
--   [9]  la liga no se escribe por fuera de corregir_apertura
--   [10] sin motivo: rechazado
--   [11] permisos: authenticated no ejecuta corregir_apertura
-- ============================================================================
BEGIN;

DO $$
DECLARE
  T          constant uuid := 'a0000000-0000-0000-0000-000000000001';
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
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_fecha := public.finanzas_fecha_apertura(T);

  -- El mes de la apertura, abierto (se deshace con el ROLLBACK).
  PERFORM public.ensure_accounting_periods(T, extract(year FROM v_fecha)::int);
  UPDATE accounting_periods SET status = 'abierto', closed_at = NULL
   WHERE tenant_id = T AND year = extract(year FROM v_fecha) AND month = extract(month FROM v_fecha);

  -- Partir sin apertura vigente: si hay una, se reversa acá.
  SELECT entry_id INTO v_entry FROM aperturas WHERE tenant_id = T AND estado = 'vigente';
  IF v_entry IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit,
             'description', 'Reversión', 'client_id', l.client_id, 'supplier_id', l.supplier_id)) ORDER BY l.line_order)
      INTO v_espejo FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.entry_id = v_entry;
    PERFORM reverse_journal_entry(T, v_entry, 'Verificación 102: partir de cero', v_fecha, 'Reversión', v_espejo, NULL);
    v_log := v_log || E'\n·  la apertura vigente de la base se reversó dentro del ROLLBACK';
  END IF;

  SELECT id INTO v_cli FROM clients WHERE tenant_id = T AND NOT coalesce(es_de_prueba, false) ORDER BY created_at LIMIT 1;
  SELECT id INTO v_prv FROM suppliers WHERE tenant_id = T AND active ORDER BY created_at LIMIT 1;
  IF v_prv IS NULL THEN
    INSERT INTO suppliers (tenant_id, supplier_number, legal_name) VALUES (T, 'PRV-VERIF-102', 'Proveedor de la verificación 102')
    RETURNING id INTO v_prv;
  END IF;

  -- Versión 1: CxC 100,000.
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

  -- Versión 2: CxC 90,000 y la diferencia (10,000) al banco.
  v_lines2 := jsonb_set(jsonb_set(v_lines, '{0,debit}', '90000'), '{2,debit}', '15000');

  -- [5] Antes de la buena: unas líneas que no cuadran. Nada cambia.
  BEGIN
    PERFORM corregir_apertura(T, v_ap1, 'Verificación: no cuadra', v_espejo, jsonb_set(v_lines2, '{2,debit}', '5000'), 'h5', NULL);
    v_fail := v_fail + 1; v_log := v_log || E'\n❌ [5] entró una corrección que no cuadra';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap1 AND estado = 'vigente')
       AND NOT EXISTS (SELECT 1 FROM journal_entries WHERE reverses_entry_id = v_entry) THEN
      v_log := v_log || E'\n✅ [5] no cuadra: «' || v_err || '»; la apertura sigue vigente y sin reversión';
    ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [5] quedó algo a medias: ' || v_err; END IF;
  END;

  -- [6] 100004 sin documento externo. Nada cambia.
  BEGIN
    PERFORM corregir_apertura(T, v_ap1, 'Verificación: sin documento', v_espejo, jsonb_set(v_lines2, '{0,documento_externo}', '""'), 'h6', NULL);
    v_fail := v_fail + 1; v_log := v_log || E'\n❌ [6] entró 100004 sin documento';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%documento externo%' AND EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap1 AND estado = 'vigente') THEN
      v_log := v_log || E'\n✅ [6] ' || v_err;
    ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [6] otro motivo: ' || v_err; END IF;
  END;

  -- [7] Un espejo que no es el del libro. Nada cambia.
  BEGIN
    PERFORM corregir_apertura(T, v_ap1, 'Verificación: espejo malo', jsonb_set(v_espejo, '{0,credit}', '1'), v_lines2, 'h7', NULL);
    v_fail := v_fail + 1; v_log := v_log || E'\n❌ [7] entró con un espejo falso';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%espejo exacto%' AND EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap1 AND estado = 'vigente') THEN
      v_log := v_log || E'\n✅ [7] ' || v_err;
    ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [7] otro motivo: ' || v_err; END IF;
  END;

  -- [8] Diciembre (el mes de la apertura) cerrado. Nada cambia.
  BEGIN
    UPDATE accounting_periods SET status = 'cerrado', closed_at = now()
     WHERE tenant_id = T AND year = extract(year FROM v_fecha) AND month = extract(month FROM v_fecha);
    BEGIN
      PERFORM corregir_apertura(T, v_ap1, 'Verificación: mes cerrado', v_espejo, v_lines2, 'h8', NULL);
      v_fail := v_fail + 1; v_log := v_log || E'\n❌ [8] se corrigió con el mes cerrado';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%cerrado%mes abierto%' AND EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap1 AND estado = 'vigente') THEN
        v_log := v_log || E'\n✅ [8] ' || v_err;
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
    IF v_err LIKE '%motivo%' THEN v_log := v_log || E'\n✅ [10] ' || v_err;
    ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [10] otro motivo: ' || v_err; END IF;
  END;

  -- [1] La corrección buena.
  v_r := corregir_apertura(T, v_ap1, 'CxC según QuickBooks: 90,000', v_espejo, v_lines2, 'hash-102-v2', NULL);
  v_ap2 := (v_r->>'apertura_id')::uuid;
  -- Saldo de 100004 en el libro al corte: v1 + su reversión + v2.
  SELECT coalesce(sum(l.debit - l.credit), 0) INTO v_saldo
    FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.entry_id JOIN chart_of_accounts c ON c.id = l.account_id
   WHERE j.tenant_id = T AND c.code = '100004' AND j.transaction_date = v_fecha
     AND (j.id IN (SELECT entry_id FROM aperturas WHERE id IN (v_ap1, v_ap2))
          OR j.reverses_entry_id IN (SELECT entry_id FROM aperturas WHERE id IN (v_ap1, v_ap2)));
  IF EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap1 AND estado = 'reversada'
               AND motivo_reversion = 'Corrección de la apertura: CxC según QuickBooks: 90,000')
     AND EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap2 AND estado = 'vigente' AND corrige_apertura_id = v_ap1
                   AND motivo_correccion = 'CxC según QuickBooks: 90,000' AND file_name = 'Corrección en pantalla')
     AND (SELECT transaction_date FROM journal_entries WHERE id = (v_r->>'reversion_entry_id')::uuid) = v_fecha
     AND v_saldo = 90000 THEN
    v_log := v_log || E'\n✅ [1] ' || (v_r->>'reference') || ' corrige la v1 (reversión ' || (v_r->>'reversion_entry_number')
             || '); 100004 en el libro al ' || v_fecha || ': ' || v_saldo;
  ELSE
    v_fail := v_fail + 1; v_log := v_log || E'\n❌ [1] ' || v_r::text || ' · saldo 100004 ' || v_saldo;
  END IF;

  -- [2] Las partidas de la vigente: lo que lee la antigüedad.
  SELECT coalesce(sum(p.debit - p.credit), 0), count(*) INTO v_saldo, v_n
    FROM apertura_partidas p JOIN aperturas a ON a.id = p.apertura_id
   WHERE a.tenant_id = T AND a.estado = 'vigente' AND p.account_code = '100004';
  IF v_saldo = 90000 AND v_n = 1 THEN
    v_log := v_log || E'\n✅ [2] partidas de la vigente en 100004: 1 documento por 90000 (la antigüedad al corte cuadra)';
  ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [2] partidas 100004: ' || v_n || ' por ' || v_saldo; END IF;

  -- [3] Una segunda corrección seguida (v3: el banco a 100001 en dos líneas).
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
     AND EXISTS (SELECT 1 FROM aperturas WHERE id = v_ap2 AND estado = 'reversada')
     AND (SELECT count(*) FROM aperturas WHERE tenant_id = T AND estado = 'vigente') = 1 THEN
    v_log := v_log || E'\n✅ [3] segunda corrección: v1 → v2 → v3 (' || (v_r->>'reference') || '), una sola vigente';
  ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [3] ' || v_r::text; END IF;

  -- [4] Corregir una versión que ya no es la vigente.
  BEGIN
    PERFORM corregir_apertura(T, v_ap2, 'Verificación: versión vieja', v_espejo, v_lines2, 'h4', NULL);
    v_fail := v_fail + 1; v_log := v_log || E'\n❌ [4] se corrigió una apertura reversada';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%ya no es la vigente%' THEN v_log := v_log || E'\n✅ [4] ' || v_err;
    ELSE v_fail := v_fail + 1; v_log := v_log || E'\n❌ [4] otro motivo: ' || v_err; END IF;
  END;

  -- [9] La liga no se escribe por fuera.
  BEGIN
    UPDATE aperturas SET corrige_apertura_id = v_ap1, motivo_correccion = 'a mano' WHERE id = v_ap3;
    v_fail := v_fail + 1; v_log := v_log || E'\n❌ [9] se reescribió la liga a mano';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_log := v_log || E'\n✅ [9] ' || v_err;
  END;

  -- [11] Permisos.
  IF has_function_privilege('authenticated', 'public.corregir_apertura(uuid, uuid, text, jsonb, jsonb, text, uuid)', 'EXECUTE') THEN
    v_fail := v_fail + 1; v_log := v_log || E'\n❌ [11] authenticated puede ejecutar corregir_apertura';
  ELSE
    v_log := v_log || E'\n✅ [11] sólo service_role ejecuta corregir_apertura';
  END IF;

  IF v_fail > 0 THEN
    RAISE EXCEPTION E'102: % caso(s) fallaron.%', v_fail, v_log;
  END IF;
  PERFORM set_config('verificacion.resultado', '102: todos los casos pasaron.' || v_log, true);
  RAISE NOTICE '%', current_setting('verificacion.resultado');
END $$;

SELECT current_setting('verificacion.resultado', true) AS resultado;

ROLLBACK;
