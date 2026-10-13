-- ============================================================================
-- VERIFICACIÓN de la 100 y la 101 · asiento de apertura y su reversión.
-- 🛡️ TODO DENTRO DE UN ROLLBACK.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-100-101-apertura.sql
--
-- La apertura de prueba va a la fecha EFECTIVA del parámetro (sin parámetro,
-- el día anterior al inicio contable: 30/06/2026). Los casos que cambian la
-- fecha o cierran un mes van en su bloque y se deshacen ahí mismo.
--
-- Casos:
--   [1]  una línea de 100004 sin documento externo: rechazada, sin asiento
--   [2]  apertura al 31/12 (cierre del año) con una cuenta de resultado: rechazada;
--        sólo con cuentas de balance entra (y crea los períodos de ese año)
--   [3]  con el mes de la apertura cerrado: rechazada
--   [4]  la apertura entra: un asiento 'apertura' con número AD-, la fila en
--        aperturas (vigente) y las partidas con documento y fecha
--   [5]  una segunda apertura con una vigente: rechazada
--   [6]  saldo_inicial ya no se edita
--   [7]  la fecha de la apertura no cambia con una vigente
--   [8]  reversar con OTRA fecha: rechazado
--   [9]  reversar con el mes de la apertura CERRADO: rechazado
--   [10] reversar con la misma fecha y el mes abierto: entra, la apertura queda
--        reversada (con motivo y asiento) y se puede cargar otra
--   [11] reverse_journal_entry sigue rechazando el asiento de un documento
--   [12] permisos: authenticated no ejecuta post_apertura
-- ============================================================================
BEGIN;

DO $$
DECLARE
  T         constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_fecha   date;
  v_cli     uuid;
  v_prv     uuid;
  v_lines   jsonb;
  v_r       jsonb;
  v_r2      jsonb;
  v_entry   uuid;
  v_espejo  jsonb;
  v_n       int;
  v_err     text;
  v_ok      int := 0;
  v_fail    int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_fecha := public.finanzas_fecha_apertura(T);
  RAISE NOTICE 'fecha efectiva de la apertura: %', v_fecha;
  IF EXISTS (SELECT 1 FROM aperturas WHERE tenant_id = T AND estado = 'vigente') THEN
    RAISE NOTICE '⚠️ Ya hay una apertura vigente en esta base: la verificación necesita una base sin apertura.';
    RETURN;
  END IF;
  SELECT id INTO v_cli FROM clients WHERE tenant_id = T AND NOT coalesce(es_de_prueba, false) ORDER BY created_at LIMIT 1;
  SELECT id INTO v_prv FROM suppliers WHERE tenant_id = T AND active ORDER BY created_at LIMIT 1;
  IF v_prv IS NULL THEN  -- producción no tiene compras: puede no haber proveedores
    INSERT INTO suppliers (tenant_id, supplier_number, legal_name) VALUES (T, 'PRV-VERIF-100', 'Proveedor de la verificación 100')
    RETURNING id INTO v_prv;
  END IF;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '100004', 'debit', 107, 'credit', 0, 'description', 'Saldo de cliente',
      'client_id', v_cli, 'documento_externo', 'QB-VERIF-1', 'fecha_documento', v_fecha - 20, 'vencimiento', v_fecha + 10),
    jsonb_build_object('account_code', '200001', 'debit', 0, 'credit', 50, 'description', 'Saldo de proveedor',
      'supplier_id', v_prv, 'documento_externo', 'F-VERIF-1', 'fecha_documento', v_fecha - 5),
    jsonb_build_object('account_code', '100001', 'debit', 943, 'credit', 0, 'description', 'Banco'),
    jsonb_build_object('account_code', '300002', 'debit', 0, 'credit', 1000, 'description', 'Resultados acumulados'));

  -- [1] Una línea de 100004 sin documento externo.
  BEGIN
    PERFORM post_apertura(T, NULL, jsonb_set(v_lines, '{0,documento_externo}', '""'), 'apertura.xlsx', 'hash-1', NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [1] entró sin documento externo';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%documento externo%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [1] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [1] otro motivo: %', v_err; END IF;
  END;

  -- [2] Al 31/12 (cierre del año): sin cuentas de resultado.
  BEGIN
    INSERT INTO finanzas_parametros (tenant_id, fecha_apertura) VALUES (T, DATE '2025-12-31')
    ON CONFLICT (tenant_id) DO UPDATE SET fecha_apertura = DATE '2025-12-31';
    BEGIN
      PERFORM post_apertura(T, NULL, v_lines || jsonb_build_array(
        jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 1, 'description', 'x'),
        jsonb_build_object('account_code', '100001', 'debit', 1, 'credit', 0, 'description', 'x')),
        'apertura.xlsx', 'hash-2', NULL);
      v_fail := v_fail + 1; RAISE NOTICE '❌ [2] entró una cuenta de resultado al cierre del año';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%sólo cuentas de balance%400001%' THEN
        v_r := post_apertura(T, NULL, jsonb_set(jsonb_set(v_lines, '{0,fecha_documento}', to_jsonb(DATE '2025-12-01')),
                 '{1,fecha_documento}', to_jsonb(DATE '2025-12-15')), 'apertura.xlsx', 'hash-2b', NULL);
        IF (v_r->>'fecha')::date = DATE '2025-12-31'
           AND EXISTS (SELECT 1 FROM accounting_periods WHERE tenant_id = T AND year = 2025 AND month = 12) THEN
          v_ok := v_ok + 1; RAISE NOTICE '✅ [2] % · sólo balance entra al 31/12/2025 y crea los períodos de 2025', v_err;
        ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [2] la de balance no entró como se esperaba: %', v_r; END IF;
      ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [2] otro motivo: %', v_err; END IF;
    END;
    RAISE EXCEPTION USING ERRCODE = 'P0100', MESSAGE = 'deshacer [2]';
  EXCEPTION WHEN SQLSTATE 'P0100' THEN NULL;
  END;

  -- [3] Con el mes de la apertura cerrado.
  BEGIN
    UPDATE accounting_periods SET status = 'cerrado', closed_at = now()
     WHERE tenant_id = T AND year = extract(year FROM v_fecha) AND month = extract(month FROM v_fecha);
    BEGIN
      PERFORM post_apertura(T, NULL, v_lines, 'apertura.xlsx', 'hash-3', NULL);
      v_fail := v_fail + 1; RAISE NOTICE '❌ [3] entró con el mes cerrado';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE '%cerrado%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [3] %', v_err;
      ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [3] otro motivo: %', v_err; END IF;
    END;
    RAISE EXCEPTION USING ERRCODE = 'P0100', MESSAGE = 'deshacer [3]';
  EXCEPTION WHEN SQLSTATE 'P0100' THEN NULL;
  END;

  -- [4] La apertura entra.
  v_r := post_apertura(T, 'Apertura de la verificación', v_lines, 'apertura.xlsx', 'hash-4', NULL);
  v_entry := (v_r->>'entry_id')::uuid;
  SELECT count(*) INTO v_n FROM apertura_partidas WHERE entry_id = v_entry;
  IF (SELECT source_type FROM journal_entries WHERE id = v_entry) = 'apertura'
     AND (v_r->>'reference') LIKE 'AD-%' AND (v_r->>'fecha')::date = v_fecha
     AND EXISTS (SELECT 1 FROM aperturas WHERE entry_id = v_entry AND estado = 'vigente')
     AND v_n = 2
     AND EXISTS (SELECT 1 FROM apertura_partidas WHERE entry_id = v_entry AND documento_externo = 'QB-VERIF-1'
                    AND fecha_documento = v_fecha - 20 AND vencimiento = v_fecha + 10 AND client_id = v_cli) THEN
    v_ok := v_ok + 1; RAISE NOTICE '✅ [4] apertura % (asiento %), 2 partidas con documento y fecha', v_r->>'reference', v_r->>'entry_number';
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE '❌ [4] %; partidas %', v_r, v_n;
  END IF;

  -- [5] Una segunda con una vigente.
  BEGIN
    PERFORM post_apertura(T, NULL, v_lines, 'apertura.xlsx', 'hash-5', NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [5] entraron dos aperturas vigentes';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_ok := v_ok + 1; RAISE NOTICE '✅ [5] %', v_err;
  END;

  -- [6] saldo_inicial ya no se edita.
  BEGIN
    UPDATE chart_of_accounts SET saldo_inicial = coalesce(saldo_inicial, 0) + 1 WHERE tenant_id = T AND code = '100001';
    v_fail := v_fail + 1; RAISE NOTICE '❌ [6] se editó el saldo inicial con una apertura';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_ok := v_ok + 1; RAISE NOTICE '✅ [6] %', v_err;
  END;

  -- [7] La fecha de la apertura no cambia con una vigente.
  BEGIN
    INSERT INTO finanzas_parametros (tenant_id, fecha_apertura) VALUES (T, v_fecha - 1)
    ON CONFLICT (tenant_id) DO UPDATE SET fecha_apertura = v_fecha - 1;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [7] cambió la fecha con una apertura vigente';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_ok := v_ok + 1; RAISE NOTICE '✅ [7] %', v_err;
  END;

  -- El espejo, como lo arma construirAsientoDeReversion (débito ↔ crédito, con el tercero).
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('account_code', c.code, 'debit', l.credit, 'credit', l.debit,
           'description', 'Reversión', 'client_id', l.client_id, 'supplier_id', l.supplier_id)) ORDER BY l.line_order)
    INTO v_espejo
    FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id WHERE l.entry_id = v_entry;

  -- [8] Con otra fecha.
  BEGIN
    PERFORM reverse_journal_entry(T, v_entry, 'Verificación: otra fecha', v_fecha + 1, 'Reversión de la apertura', v_espejo, NULL);
    v_fail := v_fail + 1; RAISE NOTICE '❌ [8] se reversó con otra fecha';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%misma fecha%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [8] %', v_err;
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [8] otro motivo: %', v_err; END IF;
  END;

  -- [9] Con el mes de la apertura cerrado.
  BEGIN
    UPDATE accounting_periods SET status = 'cerrado', closed_at = now()
     WHERE tenant_id = T AND year = extract(year FROM v_fecha) AND month = extract(month FROM v_fecha);
    BEGIN
      PERFORM reverse_journal_entry(T, v_entry, 'Verificación: mes cerrado', v_fecha, 'Reversión de la apertura', v_espejo, NULL);
      v_fail := v_fail + 1; RAISE NOTICE '❌ [9] se reversó con el mes cerrado';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err ILIKE '%cerrado%' AND EXISTS (SELECT 1 FROM aperturas WHERE entry_id = v_entry AND estado = 'vigente') THEN
        v_ok := v_ok + 1; RAISE NOTICE '✅ [9] %', v_err;
      ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [9] otro motivo: %', v_err; END IF;
    END;
    RAISE EXCEPTION USING ERRCODE = 'P0100', MESSAGE = 'deshacer [9]';
  EXCEPTION WHEN SQLSTATE 'P0100' THEN NULL;
  END;

  -- [10] Misma fecha, mes abierto: entra; la apertura queda reversada y se puede cargar otra.
  v_r2 := reverse_journal_entry(T, v_entry, 'Verificación: corregir la apertura', v_fecha, 'Reversión de la apertura', v_espejo, NULL);
  IF (v_r2->>'transaction_date')::date = v_fecha
     AND EXISTS (SELECT 1 FROM aperturas WHERE entry_id = v_entry AND estado = 'reversada'
                    AND reversal_entry_id = (v_r2->>'entry_id')::uuid AND motivo_reversion = 'Verificación: corregir la apertura') THEN
    v_r := post_apertura(T, NULL, v_lines, 'apertura.xlsx', 'hash-4', NULL);  -- el mismo archivo otra vez
    IF EXISTS (SELECT 1 FROM aperturas WHERE entry_id = (v_r->>'entry_id')::uuid AND estado = 'vigente') THEN
      v_ok := v_ok + 1;
      RAISE NOTICE '✅ [10] reversión % al %, apertura reversada con su motivo; nueva apertura % con el mismo archivo',
        v_r2->>'entry_number', v_fecha, v_r->>'reference';
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [10] no se pudo cargar la nueva: %', v_r; END IF;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE '❌ [10] %', v_r2;
  END IF;

  -- [11] Sigue sin reversar asientos de documentos (si el libro tiene alguno).
  IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE tenant_id = T AND source_type = 'factura') THEN
    RAISE NOTICE '⏭  [11] el libro no tiene asientos de facturas para probar.';
  ELSE
  BEGIN
    PERFORM reverse_journal_entry(T, j.id, 'Verificación', j.transaction_date, 'x', '[]'::jsonb || '[{},{}]'::jsonb, NULL)
      FROM journal_entries j WHERE j.tenant_id = T AND j.source_type = 'factura' LIMIT 1;
    v_fail := v_fail + 1; RAISE NOTICE '❌ [11] reversó el asiento de una factura';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%salió de un documento%' THEN v_ok := v_ok + 1; RAISE NOTICE '✅ [11] el asiento de una factura sigue sin reversarse desde acá';
    ELSE v_fail := v_fail + 1; RAISE NOTICE '❌ [11] otro motivo: %', v_err; END IF;
  END;
  END IF;

  -- [12] Permisos.
  IF has_function_privilege('authenticated', 'public.post_apertura(uuid, text, jsonb, text, text, uuid)', 'EXECUTE') THEN
    v_fail := v_fail + 1; RAISE NOTICE '❌ [12] authenticated puede ejecutar post_apertura';
  ELSE
    v_ok := v_ok + 1; RAISE NOTICE '✅ [12] sólo service_role ejecuta post_apertura';
  END IF;

  RAISE NOTICE '100-101: % bien, % mal', v_ok, v_fail;
  IF v_fail > 0 THEN RAISE EXCEPTION '100-101: % caso(s) fallaron', v_fail; END IF;
END $$;

ROLLBACK;
