-- ============================================================================
-- VERIFICACIÓN de la 072 — hash v5 y verificador que recalcula el contenido.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. Las "adulteraciones" se hacen con los
--    triggers de la 023 apagados DENTRO de esta transacción y se deshacen al
--    final: el libro de staging no cambia.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-072-hash-v5-verificador.sql
--
--   [1] un asiento nuevo nace con hash_version = 5
--   [2] su content_hash se reproduce desde las columnas (misma función)
--   [3] el verificador da CERO problemas sobre el libro entero (v1 a v5)
--   [4] la ambigüedad del separador: en v4 "a|b"+"c" = "a"+"b|c"; en v5 NO
--   [5] adulterar el MONTO de una línea vieja (v2) → "contenido alterado (v2)"
--   [6] adulterar la REFERENCIA EXTERNA de un asiento v5 → "contenido alterado (v5)"
--   [7] adulterar también el content_hash → lo detecta el eslabón
--   [8] un asiento sin tramo ni versión → "sin versión de fórmula"
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user   uuid;
  v_cli    uuid;
  v_e      uuid;
  v_nro    bigint;
  v_ver    smallint;
  v_n      int;
  v_txt    text;
  v_viejo  uuid;
  v_viejo_nro bigint;
  v_ok     int := 0;
  v_fail   int := 0;
BEGIN
  SELECT id INTO v_user FROM users   WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT id INTO v_cli  FROM clients WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;

  -- [1] y [2]
  v_e := post_journal_entry(v_tenant, current_date, 'Verificación 072', 'manual',
    jsonb_build_array(
      jsonb_build_object('account_code','100004','debit',12.5,'credit',0,'description','Línea con | y : adentro','client_id',v_cli),
      jsonb_build_object('account_code','400001','debit',0,'credit',12.5)
    ), NULL, NULL, NULL, NULL, v_user, NULL, NULL, NULL, 'REF|072');
  SELECT entry_number, hash_version INTO v_nro, v_ver FROM journal_entries WHERE id = v_e;
  IF v_ver = 5 THEN
    RAISE NOTICE '[1] nace con hash_version = 5 ................. ✅ (asiento %)', v_nro; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[1] nace con hash_version = 5 ................. ❌ %', v_ver; v_fail := v_fail + 1;
  END IF;

  IF (SELECT content_hash FROM journal_entries WHERE id = v_e)
     = finanzas_hash_de_contenido(finanzas_contenido_de_asiento(v_e, 5)) THEN
    RAISE NOTICE '[2] el contenido v5 se reproduce de las columnas ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[2] el contenido v5 se reproduce de las columnas ❌'; v_fail := v_fail + 1;
  END IF;

  -- [3]
  SELECT count(*), string_agg(format('%s: %s', nro_asiento, problema), '; ')
    INTO v_n, v_txt FROM verify_accounting_chain(v_tenant);
  IF v_n = 0 THEN
    RAISE NOTICE '[3] verificador: cero problemas (v1 a v5) ...... ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[3] verificador: cero problemas ................ ❌ %', left(v_txt, 300); v_fail := v_fail + 1;
  END IF;

  -- [4] La ambigüedad, con los dos formatos.
  IF concat_ws('|', 'a|b', 'c') = concat_ws('|', 'a', 'b|c')
     AND finanzas_contenido_v5(v_tenant, 1, current_date, current_date, 'a|b', 'manual', NULL, NULL, NULL, NULL, 'c', NULL, '[]')
      <> finanzas_contenido_v5(v_tenant, 1, current_date, current_date, 'a', 'manual', NULL, NULL, NULL, NULL, 'b|c', NULL, '[]') THEN
    RAISE NOTICE '[4] v4 ambigua con "|", v5 no .................. ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[4] v4 ambigua con "|", v5 no .................. ❌'; v_fail := v_fail + 1;
  END IF;

  -- Desde acá, los triggers de inmutabilidad apagados SOLO en esta transacción.
  ALTER TABLE journal_entry_lines DISABLE TRIGGER USER;
  ALTER TABLE journal_entries DISABLE TRIGGER USER;

  -- [5] Un asiento VIEJO (tramo v2): se cambia el monto de sus dos líneas.
  SELECT e.id, e.entry_number INTO v_viejo, v_viejo_nro
    FROM journal_entries e
    JOIN accounting_hash_versions h ON h.tenant_id = e.tenant_id AND h.version = 2
     AND e.entry_number BETWEEN h.desde AND h.hasta
   WHERE e.tenant_id = v_tenant ORDER BY e.entry_number LIMIT 1;
  UPDATE journal_entry_lines
     SET debit = CASE WHEN debit > 0 THEN debit + 1 ELSE 0 END,
         credit = CASE WHEN credit > 0 THEN credit + 1 ELSE 0 END
   WHERE entry_id = v_viejo;
  SELECT string_agg(problema, '; ') INTO v_txt FROM verify_accounting_chain(v_tenant) WHERE nro_asiento = v_viejo_nro;
  IF v_txt LIKE '%contenido alterado%v2%' THEN
    RAISE NOTICE '[5] monto cambiado en un asiento v2 ........... ✅ detectado en el %', v_viejo_nro; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[5] monto cambiado en un asiento v2 ........... ❌ %', coalesce(v_txt, 'no detectado'); v_fail := v_fail + 1;
  END IF;

  -- [6] La referencia externa del asiento v5.
  UPDATE journal_entries SET referencia_externa = 'REF' WHERE id = v_e;
  SELECT string_agg(problema, '; ') INTO v_txt FROM verify_accounting_chain(v_tenant) WHERE nro_asiento = v_nro;
  IF v_txt LIKE '%contenido alterado%v5%' THEN
    RAISE NOTICE '[6] referencia externa cambiada en un v5 ....... ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[6] referencia externa cambiada en un v5 ....... ❌ %', coalesce(v_txt, 'no detectado'); v_fail := v_fail + 1;
  END IF;

  -- [7] Además se "arregla" el content_hash: lo delata el eslabón.
  UPDATE journal_entries
     SET content_hash = finanzas_hash_de_contenido(finanzas_contenido_de_asiento(v_e, 5))
   WHERE id = v_e;
  SELECT string_agg(problema, '; ') INTO v_txt FROM verify_accounting_chain(v_tenant) WHERE nro_asiento = v_nro;
  IF v_txt LIKE '%hash no corresponde%' THEN
    RAISE NOTICE '[7] content_hash rehecho: lo delata el eslabón ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[7] content_hash rehecho ....................... ❌ %', coalesce(v_txt, 'no detectado'); v_fail := v_fail + 1;
  END IF;

  -- [8] Sin versión: se le saca la columna al asiento v5.
  UPDATE journal_entries SET hash_version = NULL WHERE id = v_e;
  SELECT string_agg(problema, '; ') INTO v_txt FROM verify_accounting_chain(v_tenant) WHERE nro_asiento = v_nro;
  IF v_txt LIKE '%sin versión de fórmula%' THEN
    RAISE NOTICE '[8] sin versión: lo dice, no lo inventa ........ ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[8] sin versión .............................. ❌ %', coalesce(v_txt, 'no detectado'); v_fail := v_fail + 1;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '======== 072: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;
