-- ============================================================================
-- VERIFICACIÓN de la 071 — motor v4: AD-, referencia externa y tercero
-- obligatorio en las cuentas control (Bloque 1, E3).
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja asientos, no consume correlativos.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-071-motor-v4.sql
--
--   [1]  asiento de diario contra 100004 SIN cliente → rechazado
--   [2]  asiento de diario con texto en p_reference → rechazado
--   [3]  asiento de diario con terceros → AD- propio y referencia externa
--   [4]  dos seguidos → AD- consecutivos
--   [5]  uno que falla (descuadrado) NO consume AD-
--   [6]  HASH v4: se recalcula desde la fila y coincide; sin la referencia
--        externa NO coincide (o sea: está adentro)
--   [7]  la reversión hereda la referencia externa (llamada de 13 argumentos)
--   [8]  `gasto` contra 200001 sin proveedor → RECHAZADO (01/10: sin excepción)
--   [9]  un CLIENTE en 200001 → rechazado
--   [10] `factura` contra 100004 sin cliente → rechazado (vale para todo tipo)
--   [11] lote de importación: AD- consecutivos y la referencia del Excel en
--        referencia_externa; un lote que falla no consume AD-
--   [12] purchase_number: formato, y una vez asignado no cambia
--   [13] gasto de trámite asentado: completar el N.º de factura del proveedor
--        se puede; cambiarlo, no
--   [14] la NC de compra numera NC-CO-
--   [15] verify_accounting_chain sin roturas (la cadena vieja sigue verde)
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user    uuid;
  v_cli     uuid;
  v_prov    uuid;
  v_e1      uuid;
  v_e2      uuid;
  v_rev     uuid;
  v_seq0    bigint;
  v_seq1    bigint;
  v_ref     text;
  v_ref2    text;
  v_ext     text;
  v_res     jsonb;
  v_gasto   uuid;
  v_n       int;
  v_err     text;
  v_ok      int := 0;
  v_fail    int := 0;
  v_row     record;
  v_lineas  text;
  v_v4      text;
  v_sin_ext text;
  v_buenas  jsonb;
BEGIN
  SELECT id INTO v_user FROM users     WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT id INTO v_cli  FROM clients   WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT id INTO v_prov FROM suppliers WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  IF v_cli IS NULL OR v_prov IS NULL THEN
    RAISE NOTICE '⚠️ Hace falta al menos un cliente y un proveedor en staging.';
    RETURN;
  END IF;

  v_buenas := jsonb_build_array(
    jsonb_build_object('account_code','100004','debit',10,'credit',0,'description','Ajuste CxC','client_id',v_cli),
    jsonb_build_object('account_code','200001','debit',0,'credit',10,'description','Ajuste CxP','supplier_id',v_prov)
  );

  -- [1] 100004 sin cliente.
  BEGIN
    PERFORM post_journal_entry(v_tenant, current_date, 'Verificación 071 sin cliente', 'manual',
      jsonb_build_array(
        jsonb_build_object('account_code','100004','debit',5,'credit',0),
        jsonb_build_object('account_code','200001','debit',0,'credit',5,'supplier_id',v_prov)
      ), NULL, NULL, NULL, NULL, v_user);
    RAISE NOTICE '[1] 100004 sin cliente ......................... ❌ PASÓ (debía fallar)'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%cuenta de clientes necesita el cliente%línea 1 (100004)%' THEN
      RAISE NOTICE '[1] 100004 sin cliente ......................... ✅ RECHAZADO'; v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[1] 100004 sin cliente ......................... ❌ otro error: %', v_err; v_fail := v_fail + 1;
    END IF;
  END;

  -- [2] Texto en p_reference de un asiento de diario.
  BEGIN
    PERFORM post_journal_entry(v_tenant, current_date, 'Verificación 071 ref vieja', 'manual', v_buenas,
      NULL, NULL, NULL, NULL, v_user, NULL, 'CHEQUE 123', NULL);
    RAISE NOTICE '[2] p_reference en asiento de diario ........... ❌ PASÓ (debía fallar)'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%(AD-) lo asigna el sistema%' THEN
      RAISE NOTICE '[2] p_reference en asiento de diario ........... ✅ RECHAZADO'; v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[2] p_reference en asiento de diario ........... ❌ otro error: %', v_err; v_fail := v_fail + 1;
    END IF;
  END;

  -- [3] Con terceros: AD- y referencia externa.
  SELECT last_number INTO v_seq0 FROM numbering_sequences
   WHERE tenant_id = v_tenant AND sequence_type = 'manual_entry';
  v_e1 := post_journal_entry(v_tenant, current_date, 'Verificación 071 uno', 'manual', v_buenas,
    NULL, NULL, NULL, NULL, v_user, NULL, NULL, NULL, '  CHEQUE 123  ');
  SELECT reference, referencia_externa INTO v_ref, v_ext FROM journal_entries WHERE id = v_e1;
  IF v_ref = 'AD-' || lpad((v_seq0 + 1)::text, 6, '0') AND v_ext = 'CHEQUE 123' THEN
    RAISE NOTICE '[3] AD- propio y referencia externa ............ ✅ % / %', v_ref, v_ext; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[3] AD- propio y referencia externa ............ ❌ % / % (secuencia en %)', v_ref, v_ext, v_seq0;
    v_fail := v_fail + 1;
  END IF;

  -- [4] El siguiente, consecutivo.
  v_e2 := post_journal_entry(v_tenant, current_date, 'Verificación 071 dos', 'manual', v_buenas,
    NULL, NULL, NULL, NULL, v_user);
  SELECT reference INTO v_ref2 FROM journal_entries WHERE id = v_e2;
  IF v_ref2 = 'AD-' || lpad((v_seq0 + 2)::text, 6, '0') THEN
    RAISE NOTICE '[4] AD- consecutivos ........................... ✅ %', v_ref2; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[4] AD- consecutivos ........................... ❌ %', v_ref2; v_fail := v_fail + 1;
  END IF;

  -- [5] Uno que falla no consume AD-.
  BEGIN
    PERFORM post_journal_entry(v_tenant, current_date, 'Verificación 071 descuadrado', 'manual',
      jsonb_build_array(
        jsonb_build_object('account_code','100004','debit',10,'credit',0,'client_id',v_cli),
        jsonb_build_object('account_code','200001','debit',0,'credit',9,'supplier_id',v_prov)
      ), NULL, NULL, NULL, NULL, v_user);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  SELECT last_number INTO v_seq1 FROM numbering_sequences
   WHERE tenant_id = v_tenant AND sequence_type = 'manual_entry';
  IF v_seq1 = v_seq0 + 2 THEN
    RAISE NOTICE '[5] el que falla no consume AD- ................ ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[5] el que falla no consume AD- ................ ❌ % → %', v_seq0 + 2, v_seq1; v_fail := v_fail + 1;
  END IF;

  -- [6] Hash v4 recalculado desde la fila.
  SELECT * INTO v_row FROM journal_entries WHERE id = v_e1;
  SELECT string_agg(
           concat_ws(':', c.code, l.debit::text, l.credit::text, coalesce(l.line_description, ''),
                     coalesce(l.client_id::text, ''), coalesce(l.supplier_id::text, '')),
           '|' ORDER BY l.line_order)
    INTO v_lineas
    FROM journal_entry_lines l JOIN chart_of_accounts c ON c.id = l.account_id
   WHERE l.entry_id = v_e1;
  v_v4 := encode(sha256(convert_to(concat_ws('|',
    v_row.tenant_id::text, v_row.entry_number::text, v_row.transaction_date::text, v_row.record_date::text,
    v_row.description, v_row.source_type, coalesce(v_row.source_id::text, ''), coalesce(v_row.source_cufe, ''),
    coalesce(v_row.reverses_entry_id::text, ''), coalesce(v_row.reversal_reason, ''),
    coalesce(v_row.reference, ''), coalesce(v_row.referencia_externa, ''), v_lineas), 'UTF8')), 'hex');
  v_sin_ext := encode(sha256(convert_to(concat_ws('|',
    v_row.tenant_id::text, v_row.entry_number::text, v_row.transaction_date::text, v_row.record_date::text,
    v_row.description, v_row.source_type, coalesce(v_row.source_id::text, ''), coalesce(v_row.source_cufe, ''),
    coalesce(v_row.reverses_entry_id::text, ''), coalesce(v_row.reversal_reason, ''),
    coalesce(v_row.reference, ''), v_lineas), 'UTF8')), 'hex');
  IF v_v4 = v_row.content_hash AND v_sin_ext <> v_row.content_hash THEN
    RAISE NOTICE '[6] hash v4 con la referencia externa .......... ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[6] hash v4 con la referencia externa .......... ❌ v4=% sin_ext=%',
      v_v4 = v_row.content_hash, v_sin_ext = v_row.content_hash;
    v_fail := v_fail + 1;
  END IF;

  -- [7] Reversión con la llamada de 13 argumentos (la de los RPC): hereda.
  v_rev := post_journal_entry(v_tenant, current_date, 'Reversión verificación 071', 'reversion',
    jsonb_build_array(
      jsonb_build_object('account_code','100004','debit',0,'credit',10,'client_id',v_cli),
      jsonb_build_object('account_code','200001','debit',10,'credit',0,'supplier_id',v_prov)
    ), NULL, NULL, v_e1, 'Prueba de la 071', v_user, NULL, v_ref, NULL);
  SELECT reference, referencia_externa INTO v_ref2, v_ext FROM journal_entries WHERE id = v_rev;
  IF v_ref2 = v_ref AND v_ext = 'CHEQUE 123' THEN
    RAISE NOTICE '[7] la reversión hereda la referencia externa .. ✅ % / %', v_ref2, v_ext; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[7] la reversión hereda la referencia externa .. ❌ % / %', v_ref2, v_ext; v_fail := v_fail + 1;
  END IF;

  -- [8] `gasto` contra 200001 sin proveedor: rechazado (sin excepción).
  BEGIN
    PERFORM post_journal_entry(v_tenant, current_date, 'Compra sin proveedor 071', 'gasto',
      jsonb_build_array(
        jsonb_build_object('account_code','130003','debit',4,'credit',0),
        jsonb_build_object('account_code','200001','debit',0,'credit',4)
      ), NULL, NULL, NULL, NULL, v_user, NULL, 'FAC-CO-999998', NULL, 'F-123');
    RAISE NOTICE '[8] gasto sin proveedor ........................ ❌ PASÓ (debía fallar)'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err LIKE '%cuenta de proveedores necesita el proveedor%' THEN
      RAISE NOTICE '[8] gasto sin proveedor ........................ ✅ RECHAZADO'; v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[8] gasto sin proveedor ........................ ❌ otro error: %', v_err; v_fail := v_fail + 1;
    END IF;
  END;

  -- [9] Un CLIENTE en 200001.
  BEGIN
    PERFORM post_journal_entry(v_tenant, current_date, 'Tercero equivocado 071', 'gasto',
      jsonb_build_array(
        jsonb_build_object('account_code','130003','debit',4,'credit',0),
        jsonb_build_object('account_code','200001','debit',0,'credit',4,'client_id',v_cli)
      ), NULL, NULL, NULL, NULL, v_user);
    RAISE NOTICE '[9] cliente en 200001 .......................... ❌ PASÓ (debía fallar)'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[9] cliente en 200001 .......................... ✅ RECHAZADO'; v_ok := v_ok + 1;
  END;

  -- [10] `factura` contra 100004 sin cliente.
  BEGIN
    PERFORM post_journal_entry(v_tenant, current_date, 'Factura sin cliente 071', 'factura',
      jsonb_build_array(
        jsonb_build_object('account_code','100004','debit',4,'credit',0),
        jsonb_build_object('account_code','130003','debit',0,'credit',4)
      ), NULL, NULL, NULL, NULL, v_user, NULL, 'FAC-HON-999999', NULL);
    RAISE NOTICE '[10] factura sin cliente en 100004 ............. ❌ PASÓ (debía fallar)'; v_fail := v_fail + 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[10] factura sin cliente en 100004 ............. ✅ RECHAZADO'; v_ok := v_ok + 1;
  END;

  -- [11] El lote.
  SELECT last_number INTO v_seq0 FROM numbering_sequences
   WHERE tenant_id = v_tenant AND sequence_type = 'manual_entry';
  v_res := post_journal_entries_batch(v_tenant, 'verificacion-071.xlsx', 'hash-verificacion-071', 4,
    jsonb_build_array(
      jsonb_build_object('group_label','1','first_row',2,'transaction_date',current_date,
        'description','Lote 071 uno','reference','EXT-1','lines',v_buenas),
      jsonb_build_object('group_label','2','first_row',4,'transaction_date',current_date,
        'description','Lote 071 dos','reference',NULL,'lines',v_buenas)
    ), v_user);
  SELECT count(*) INTO v_n FROM journal_entries
   WHERE tenant_id = v_tenant AND idempotency_key LIKE 'imp:' || (v_res->>'import_id') || ':%'
     AND reference IN ('AD-' || lpad((v_seq0 + 1)::text, 6, '0'), 'AD-' || lpad((v_seq0 + 2)::text, 6, '0'));
  SELECT referencia_externa INTO v_ext FROM journal_entries
   WHERE tenant_id = v_tenant AND idempotency_key = 'imp:' || (v_res->>'import_id') || ':1';
  BEGIN
    PERFORM post_journal_entries_batch(v_tenant, 'verificacion-071b.xlsx', 'hash-verificacion-071b', 4,
      jsonb_build_array(
        jsonb_build_object('group_label','1','first_row',2,'transaction_date',current_date,
          'description','Lote malo uno','lines',v_buenas),
        jsonb_build_object('group_label','2','first_row',4,'transaction_date',current_date,
          'description','Lote malo dos','lines', jsonb_build_array(
            jsonb_build_object('account_code','100004','debit',3,'credit',0),
            jsonb_build_object('account_code','200001','debit',0,'credit',3,'supplier_id',v_prov)))
      ), v_user);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  SELECT last_number INTO v_seq1 FROM numbering_sequences
   WHERE tenant_id = v_tenant AND sequence_type = 'manual_entry';
  IF v_n = 2 AND v_ext = 'EXT-1' AND v_seq1 = v_seq0 + 2 THEN
    RAISE NOTICE '[11] lote: AD- seguidos, ref. externa, sin huecos ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[11] lote ...................................... ❌ asientos=% ext=% secuencia % → %',
      v_n, v_ext, v_seq0 + 2, v_seq1;
    v_fail := v_fail + 1;
  END IF;

  -- [12] purchase_number.
  SELECT id INTO v_gasto FROM business_expenses WHERE tenant_id = v_tenant AND purchase_number IS NULL LIMIT 1;
  IF v_gasto IS NULL THEN
    RAISE NOTICE '[12] purchase_number ........................... (sin compras sin número: se salta)';
  ELSE
    v_n := 0;
    BEGIN
      UPDATE business_expenses SET purchase_number = 'COMPRA-1' WHERE id = v_gasto;
    EXCEPTION WHEN check_violation THEN v_n := v_n + 1;
    END;
    UPDATE business_expenses SET purchase_number = 'FAC-CO-999997' WHERE id = v_gasto;
    BEGIN
      UPDATE business_expenses SET purchase_number = 'FAC-CO-999996' WHERE id = v_gasto;
    EXCEPTION WHEN OTHERS THEN v_n := v_n + 1;
    END;
    IF v_n = 2 THEN
      RAISE NOTICE '[12] purchase_number: formato e inmutable ....... ✅'; v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[12] purchase_number: formato e inmutable ....... ❌ % de 2 rechazos', v_n; v_fail := v_fail + 1;
    END IF;
  END IF;

  -- [13] Gasto de trámite asentado: completar sí, cambiar no.
  SELECT e.id INTO v_gasto FROM expenses e
   WHERE e.tenant_id = v_tenant AND e.supplier_invoice_number IS NULL
     AND gasto_tramite_tiene_asiento(e.id) IS NOT NULL
   LIMIT 1;
  IF v_gasto IS NULL THEN
    RAISE NOTICE '[13] factura del proveedor congelada ........... (sin gastos asentados sin número: se salta)';
  ELSE
    v_n := 0;
    BEGIN
      UPDATE expenses SET supplier_invoice_number = 'F-071' WHERE id = v_gasto;
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      UPDATE expenses SET supplier_invoice_number = 'F-072' WHERE id = v_gasto;
    EXCEPTION WHEN OTHERS THEN v_n := v_n + 1;
    END;
    IF v_n = 2 THEN
      RAISE NOTICE '[13] factura del proveedor: completar sí, cambiar no ✅'; v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[13] factura del proveedor congelada ........... ❌ % de 2', v_n; v_fail := v_fail + 1;
    END IF;
  END IF;

  -- [14] NC-CO-.
  IF position('''NC-CO-''' IN pg_get_functiondef(
       'public.create_supplier_credit_note(uuid,uuid,text,date,text,text,date,jsonb,jsonb,uuid)'::regprocedure)) > 0 THEN
    RAISE NOTICE '[14] NC de compra numera NC-CO- ................ ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[14] NC de compra numera NC-CO- ................ ❌'; v_fail := v_fail + 1;
  END IF;

  -- [15] La cadena entera, vieja y nueva.
  SELECT count(*) INTO v_n FROM verify_accounting_chain(v_tenant);
  IF v_n = 0 THEN
    RAISE NOTICE '[15] verify_accounting_chain sin roturas ....... ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[15] verify_accounting_chain sin roturas ....... ❌ % roturas', v_n; v_fail := v_fail + 1;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '======== 071: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;
