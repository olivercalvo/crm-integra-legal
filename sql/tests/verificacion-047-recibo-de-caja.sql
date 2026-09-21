-- ============================================================================
-- VERIFICACIÓN de la 047 — recibo de caja: secuencia, backfill, unicidad, documents.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja números, filas ni consume correlativo.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-047-recibo-de-caja.sql
--
-- Presupone la 047 YA APLICADA. Corre sobre el tenant de staging.
-- Diez comprobaciones; cada una imprime ✅ o ❌ y el resumen final cuenta.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant     uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user       uuid;
  v_ok         int := 0;
  v_fail       int := 0;
  v_n          int;
  v_n2         int;
  v_last       int;
  v_last2      int;
  v_max        int;
  v_next       int;
  v_err        text;
  v_ids        uuid[];
  v_nums       text[];
  v_nums2      text[];
  v_cobros     int;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT COUNT(*) INTO v_cobros FROM payments WHERE tenant_id = v_tenant;
  RAISE NOTICE 'Tenant % · % cobros', v_tenant, v_cobros;

  -- [1] El CHECK admite 'payment' y las filas viejas ('client', 'supplier') siguen ahí.
  SELECT COUNT(*) INTO v_n FROM numbering_sequences
   WHERE tenant_id = v_tenant AND sequence_type IN ('client', 'supplier', 'payment');
  IF v_n = 3 THEN
    RAISE NOTICE '[1] secuencias client/supplier/payment ....... ✅ las tres existen';
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[1] secuencias client/supplier/payment ....... ❌ % de 3', v_n;
    v_fail := v_fail + 1;
  END IF;

  -- [2] Ningún cobro sin número, y todos con el formato REC-######.
  SELECT COUNT(*) FILTER (WHERE payment_number IS NULL),
         COUNT(*) FILTER (WHERE payment_number !~ '^REC-\d{6}$')
    INTO v_n, v_n2
    FROM payments WHERE tenant_id = v_tenant;
  IF v_n = 0 AND v_n2 = 0 THEN
    RAISE NOTICE '[2] todos numerados, formato REC-###### ...... ✅ % cobros', v_cobros;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[2] todos numerados, formato REC-###### ...... ❌ % sin número, % con otro formato', v_n, v_n2;
    v_fail := v_fail + 1;
  END IF;

  -- [3] last_number = el mayor asignado.
  SELECT last_number INTO v_last FROM numbering_sequences
   WHERE tenant_id = v_tenant AND sequence_type = 'payment';
  SELECT COALESCE(MAX(substring(payment_number from '^REC-(\d{6})$')::int), 0) INTO v_max
    FROM payments WHERE tenant_id = v_tenant;
  IF v_last = v_max THEN
    RAISE NOTICE '[3] last_number = mayor asignado ............. ✅ %', v_last;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[3] last_number = mayor asignado ............. ❌ last_number % vs máximo %', v_last, v_max;
    v_fail := v_fail + 1;
  END IF;

  -- [4] Orden cronológico: ningún par donde la fecha vaya al revés del número.
  SELECT COUNT(*) INTO v_n
    FROM payments a
    JOIN payments b ON a.tenant_id = b.tenant_id
   WHERE a.tenant_id = v_tenant
     AND a.payment_number < b.payment_number
     AND (a.payment_date, a.created_at, a.id) > (b.payment_date, b.created_at, b.id);
  IF v_n = 0 THEN
    RAISE NOTICE '[4] orden por payment_date, created_at, id ... ✅ sin inversiones';
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[4] orden por payment_date, created_at, id ... ❌ % pares invertidos', v_n;
    v_fail := v_fail + 1;
  END IF;

  -- [5] Idempotencia: sobre una base numerada, la función no hace nada.
  v_n := backfill_payment_numbers(v_tenant);
  SELECT last_number INTO v_last2 FROM numbering_sequences
   WHERE tenant_id = v_tenant AND sequence_type = 'payment';
  IF v_n = 0 AND v_last2 = v_last THEN
    RAISE NOTICE '[5] segunda corrida .......................... ✅ 0 numerados, last_number % intacto', v_last;
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[5] segunda corrida .......................... ❌ numeró %, last_number % → %', v_n, v_last, v_last2;
    v_fail := v_fail + 1;
  END IF;

  -- [6] Determinismo: se borran los DOS últimos números y la función los
  --     devuelve idénticos (mismo orden, arranca desde el mayor que quedó).
  IF v_cobros >= 2 THEN
    SELECT array_agg(id ORDER BY payment_number DESC), array_agg(payment_number ORDER BY payment_number DESC)
      INTO v_ids, v_nums
      FROM (SELECT id, payment_number FROM payments WHERE tenant_id = v_tenant
             ORDER BY payment_number DESC LIMIT 2) u;
    UPDATE payments SET payment_number = NULL WHERE id = ANY(v_ids);
    UPDATE numbering_sequences SET last_number = 0
     WHERE tenant_id = v_tenant AND sequence_type = 'payment';  -- también se recupera solo
    v_n := backfill_payment_numbers(v_tenant);
    SELECT array_agg(payment_number ORDER BY payment_number DESC) INTO v_nums2
      FROM payments WHERE id = ANY(v_ids);
    SELECT last_number INTO v_last2 FROM numbering_sequences
     WHERE tenant_id = v_tenant AND sequence_type = 'payment';
    IF v_n = 2 AND v_nums2 = v_nums AND v_last2 = v_last THEN
      RAISE NOTICE '[6] renumerar los 2 últimos .................. ✅ % y % vuelven iguales; last_number % recuperado', v_nums[1], v_nums[2], v_last;
      v_ok := v_ok + 1;
    ELSE
      RAISE NOTICE '[6] renumerar los 2 últimos .................. ❌ numeró %, % → %, last_number %', v_n, v_nums, v_nums2, v_last2;
      v_fail := v_fail + 1;
    END IF;
  ELSE
    RAISE NOTICE '[6] renumerar los 2 últimos .................. ⚠️ menos de 2 cobros, se omite';
  END IF;

  -- [7] El índice único rechaza un número repetido dentro del tenant.
  IF v_cobros >= 2 THEN
    BEGIN
      UPDATE payments SET payment_number = v_nums[1] WHERE id = v_ids[2];
      RAISE NOTICE '[7] REC- duplicado ........................... ❌ PASÓ (debía fallar)';
      v_fail := v_fail + 1;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE '[7] REC- duplicado ........................... ✅ RECHAZADO por el índice';
      v_ok := v_ok + 1;
    END;
  ELSE
    RAISE NOTICE '[7] REC- duplicado ........................... ⚠️ menos de 2 cobros, se omite';
  END IF;

  -- [8] get_next_sequence_number(tenant, 'payment') devuelve last_number + 1.
  v_next := get_next_sequence_number(v_tenant, 'payment');
  IF v_next = v_last + 1 THEN
    RAISE NOTICE '[8] get_next_sequence_number(''payment'') ..... ✅ % (siguiente REC-%)', v_next, lpad(v_next::text, 6, '0');
    v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[8] get_next_sequence_number(''payment'') ..... ❌ % (esperado %)', v_next, v_last + 1;
    v_fail := v_fail + 1;
  END IF;

  -- [9] documents acepta entity_type='payment' + source='auto_receipt_pdf'.
  BEGIN
    INSERT INTO documents (tenant_id, entity_type, entity_id, file_name, file_path, storage_key,
                           uploaded_by, source, source_version, source_generated_at, source_content_hash)
    VALUES (v_tenant, 'payment', gen_random_uuid(), 'REC-000000.pdf',
            v_tenant || '/receipt_pdf/x/current.pdf', v_tenant || '/receipt_pdf/x/current.pdf',
            v_user, 'auto_receipt_pdf', 1, now(), 'hash-de-prueba');
    RAISE NOTICE '[9] documents payment/auto_receipt_pdf ....... ✅ acepta la fila';
    v_ok := v_ok + 1;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE NOTICE '[9] documents payment/auto_receipt_pdf ....... ❌ %', v_err;
    v_fail := v_fail + 1;
  END;

  -- [10] Y sigue rechazando un source inventado (el CHECK no quedó abierto).
  BEGIN
    INSERT INTO documents (tenant_id, entity_type, entity_id, file_name, file_path, storage_key,
                           uploaded_by, source)
    VALUES (v_tenant, 'payment', gen_random_uuid(), 'x.pdf', 'x', 'x', v_user, 'auto_lo_que_sea');
    RAISE NOTICE '[10] source inventado ......................... ❌ PASÓ (debía fallar)';
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[10] source inventado ......................... ✅ RECHAZADO';
    v_ok := v_ok + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '════════ 047: % ✅ · % ❌ ════════', v_ok, v_fail;
END $$;

ROLLBACK;
