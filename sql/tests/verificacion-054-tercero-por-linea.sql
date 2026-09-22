-- ============================================================================
-- VERIFICACIÓN de la 054 — el tercero de cada línea del libro.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja asientos ni consume correlativo.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-054-tercero-por-linea.sql
--
-- Nueve comprobaciones, incluida la falla forzada DESPUÉS de postear.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant   uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user     uuid;
  v_cli      uuid;
  v_prov     uuid;
  v_otro_t   uuid;
  v_cli_otro uuid;
  v_ok       int := 0;
  v_fail     int := 0;
  v_n        int;
  v_err      text;
  v_entry    uuid;
  v_nro      bigint;
  v_hash     text;
  v_hash2    text;
  v_seq      bigint;
  v_lineas   jsonb;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT id INTO v_cli  FROM clients   WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT id INTO v_prov FROM suppliers WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  IF v_cli IS NULL OR v_prov IS NULL THEN
    RAISE NOTICE '⚠️ Hace falta al menos un cliente y un proveedor en staging.';
    RETURN;
  END IF;

  -- [1] El asiento con tercero se postea y las líneas lo guardan.
  v_lineas := jsonb_build_array(
    jsonb_build_object('account_code','100004','debit',10,'credit',0,'description','Ajuste CxC','client_id',v_cli),
    jsonb_build_object('account_code','200001','debit',0,'credit',10,'description','Ajuste CxP','supplier_id',v_prov)
  );
  v_entry := post_journal_entry(v_tenant, current_date, 'Verificación 054', 'manual', v_lineas,
                                NULL, NULL, NULL, NULL, v_user, NULL, 'VER-054', NULL);
  SELECT count(*) INTO v_n FROM journal_entry_lines
   WHERE entry_id = v_entry AND (client_id = v_cli OR supplier_id = v_prov);
  IF v_n = 2 THEN
    RAISE NOTICE '[1] el tercero se guarda por línea .............. ✅';
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[1] el tercero se guarda por línea .............. ❌ % líneas con tercero', v_n;
    v_fail := v_fail + 1;
  END IF;

  -- [2] Una línea SIN tercero sigue siendo válida (D3: es opcional).
  SELECT entry_number, hash INTO v_nro, v_hash FROM journal_entries WHERE id = v_entry;
  BEGIN
    PERFORM post_journal_entry(v_tenant, current_date, 'Verificación 054 sin tercero', 'manual',
      jsonb_build_array(
        jsonb_build_object('account_code','100004','debit',5,'credit',0),
        jsonb_build_object('account_code','200001','debit',0,'credit',5)
      ), NULL, NULL, NULL, NULL, v_user, NULL, NULL, NULL);
    RAISE NOTICE '[2] sin tercero se postea igual ................ ✅';
    v_ok := v_ok + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[2] sin tercero se postea igual ................ ❌ %', v_err;
    v_fail := v_fail + 1;
  END;

  -- [3] Cliente Y proveedor en la misma línea → rechazado por el motor.
  BEGIN
    PERFORM post_journal_entry(v_tenant, current_date, 'Verificación 054 dos terceros', 'manual',
      jsonb_build_array(
        jsonb_build_object('account_code','100004','debit',5,'credit',0,'client_id',v_cli,'supplier_id',v_prov),
        jsonb_build_object('account_code','200001','debit',0,'credit',5)
      ), NULL, NULL, NULL, NULL, v_user, NULL, NULL, NULL);
    RAISE NOTICE '[3] cliente Y proveedor en una línea ........... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[3] cliente Y proveedor en una línea ........... ✅ RECHAZADO: %', left(v_err, 60);
    v_ok := v_ok + 1;
  END;

  -- [4] Un cliente de OTRO bufete no entra al libro de este.
  SELECT t.id INTO v_otro_t FROM tenants t WHERE t.id <> v_tenant LIMIT 1;
  IF v_otro_t IS NOT NULL THEN
    SELECT id INTO v_cli_otro FROM clients WHERE tenant_id = v_otro_t LIMIT 1;
  END IF;
  IF v_cli_otro IS NULL THEN
    -- Sin segundo tenant sembrado, se prueba con un uuid que no existe: el
    -- rechazo es el mismo camino (`NOT EXISTS ... AND tenant_id = p_tenant_id`).
    v_cli_otro := '00000000-0000-0000-0000-0000000000ff';
  END IF;
  BEGIN
    PERFORM post_journal_entry(v_tenant, current_date, 'Verificación 054 tercero ajeno', 'manual',
      jsonb_build_array(
        jsonb_build_object('account_code','100004','debit',5,'credit',0,'client_id',v_cli_otro),
        jsonb_build_object('account_code','200001','debit',0,'credit',5)
      ), NULL, NULL, NULL, NULL, v_user, NULL, NULL, NULL);
    RAISE NOTICE '[4] cliente de otro bufete ..................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[4] cliente de otro bufete ..................... ✅ RECHAZADO: %', left(v_err, 60);
    v_ok := v_ok + 1;
  END;

  -- [5] El CHECK de la tabla también lo impide (defensa en profundidad):
  --     un UPDATE directo a la línea lo rechaza… y además lo rechaza el trigger
  --     de inmutabilidad. Se verifica que el CHECK exista y su definición.
  SELECT pg_get_constraintdef(oid) INTO v_err FROM pg_constraint
   WHERE conrelid = 'journal_entry_lines'::regclass AND conname = 'jel_tercero_unico';
  IF v_err ILIKE '%num_nonnulls%<= 1%' THEN
    RAISE NOTICE '[5] CHECK jel_tercero_unico .................... ✅ %', v_err;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[5] CHECK jel_tercero_unico .................... ❌ %', coalesce(v_err, '(no existe)');
    v_fail := v_fail + 1;
  END IF;

  -- [6] 🔴 La FK NO deja borrar un cliente nombrado en el libro.
  BEGIN
    DELETE FROM clients WHERE id = v_cli;
    RAISE NOTICE '[6] borrar un cliente del libro ................ ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '[6] borrar un cliente del libro ................ ✅ RECHAZADO por la FK';
    v_ok := v_ok + 1;
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[6] borrar un cliente del libro ................ ⚠️ otro error: %', left(v_err, 70);
    v_fail := v_fail + 1;
  END;

  -- [7] El tercero ENTRA al hash: el mismo asiento con y sin tercero da
  --     content_hash distinto.
  SELECT content_hash INTO v_hash FROM journal_entries WHERE id = v_entry;
  v_entry := post_journal_entry(v_tenant, current_date, 'Verificación 054', 'manual',
    jsonb_build_array(
      jsonb_build_object('account_code','100004','debit',10,'credit',0,'description','Ajuste CxC'),
      jsonb_build_object('account_code','200001','debit',0,'credit',10,'description','Ajuste CxP')
    ), NULL, NULL, NULL, NULL, v_user, NULL, 'VER-054', NULL);
  SELECT content_hash INTO v_hash2 FROM journal_entries WHERE id = v_entry;
  IF v_hash IS DISTINCT FROM v_hash2 THEN
    RAISE NOTICE '[7] el tercero cambia el content_hash .......... ✅';
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[7] el tercero cambia el content_hash .......... ❌ el hash no lo incluye';
    v_fail := v_fail + 1;
  END IF;

  -- [8] La cadena sigue íntegra con el verificador que ya existe.
  -- La función devuelve una fila POR PROBLEMA (nro_asiento, problema): cero filas = cadena sana.
  SELECT count(*) INTO v_n FROM verify_accounting_chain(v_tenant);
  IF v_n = 0 THEN
    RAISE NOTICE '[8] verify_accounting_chain sin roturas ........ ✅';
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[8] verify_accounting_chain sin roturas ........ ❌ % asiento(s) rotos', v_n;
    v_fail := v_fail + 1;
  END IF;

  -- [9] 🔴 FALLA FORZADA DESPUÉS DE POSTEAR: el correlativo y la cadena vuelven.
  SELECT last_number INTO v_seq FROM accounting_sequences
   WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
  BEGIN
    PERFORM post_journal_entry(v_tenant, current_date, 'Verificación 054 falla forzada', 'manual',
      jsonb_build_array(
        jsonb_build_object('account_code','100004','debit',7,'credit',0,'client_id',v_cli),
        jsonb_build_object('account_code','200001','debit',0,'credit',7)
      ), NULL, NULL, NULL, NULL, v_user, NULL, NULL, NULL);
    RAISE EXCEPTION 'falla forzada después de postear' USING ERRCODE = 'P0054';
  EXCEPTION WHEN SQLSTATE 'P0054' THEN
    NULL;
  END;
  SELECT last_number INTO v_n FROM accounting_sequences
   WHERE tenant_id = v_tenant AND sequence_type = 'journal_entry';
  IF v_n = v_seq THEN
    RAISE NOTICE '[9] falla después de postear: correlativo vuelve ✅ (quedó en %)', v_n;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[9] falla después de postear: correlativo vuelve ❌ % → %', v_seq, v_n;
    v_fail := v_fail + 1;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '======== 054: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;
