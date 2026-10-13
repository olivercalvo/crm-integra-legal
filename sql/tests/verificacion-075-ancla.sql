-- ============================================================================
-- VERIFICACIÓN de la 075 — el ancla externa de la cadena (R-1b).
-- 🛡️ TODO DENTRO DE UN ROLLBACK: el cierre de prueba, sus anclas y la
--    "reescritura" simulada se deshacen al final.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-075-ancla.sql
--
--   [1] el bufete tiene su ancla inicial y coincide con la cadena
--   [2] cerrar un período graba el ancla con el último asiento, en la misma transacción
--   [3] reabrir NO graba ancla; volver a cerrar graba otra
--   [4] un ancla no se modifica ni se borra
--   [5] anclas de AFUERA que coinciden → cero problemas
--   [6] un hash que no coincide y un asiento inexistente → dos problemas
--   [7] reescritura simulada del asiento anclado → la verificación la delata
--   [8] service_role no puede escribir anclas a mano
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user   uuid;
  v_per    uuid;
  v_nro    bigint;
  v_hash   text;
  v_n      int;
  v_antes  int;
  v_ok     int := 0;
  v_fail   int := 0;
BEGIN
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT entry_number, hash INTO v_nro, v_hash FROM journal_entries
   WHERE tenant_id = v_tenant ORDER BY entry_number DESC LIMIT 1;

  -- [1]
  SELECT count(*) INTO v_n FROM accounting_chain_anchors WHERE tenant_id = v_tenant AND origen = 'inicial';
  IF v_n = 1 AND (SELECT count(*) FROM verify_chain_anchors(v_tenant, NULL)) = 0 THEN
    RAISE NOTICE '[1] ancla inicial y coincide ................... ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[1] ancla inicial ............................. ❌ %', v_n; v_fail := v_fail + 1;
  END IF;

  -- [2] Cerrar un período abierto del año en curso.
  SELECT id INTO v_per FROM accounting_periods
   WHERE tenant_id = v_tenant AND status = 'abierto' AND year = extract(year FROM current_date)::int
   ORDER BY month DESC LIMIT 1;
  SELECT count(*) INTO v_antes FROM accounting_chain_anchors WHERE tenant_id = v_tenant;
  UPDATE accounting_periods SET status = 'cerrado', closed_at = now(), closed_by = v_user WHERE id = v_per;
  IF EXISTS (SELECT 1 FROM accounting_chain_anchors
              WHERE period_id = v_per AND origen = 'cierre' AND entry_number = v_nro AND hash = v_hash) THEN
    RAISE NOTICE '[2] cerrar graba el ancla (asiento %) .......... ✅', v_nro; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[2] cerrar graba el ancla ...................... ❌'; v_fail := v_fail + 1;
  END IF;

  -- [3]
  UPDATE accounting_periods SET status = 'abierto' WHERE id = v_per;
  SELECT count(*) INTO v_n FROM accounting_chain_anchors WHERE tenant_id = v_tenant;
  UPDATE accounting_periods SET status = 'cerrado', closed_at = now(), closed_by = v_user WHERE id = v_per;
  IF v_n = v_antes + 1 AND (SELECT count(*) FROM accounting_chain_anchors WHERE tenant_id = v_tenant) = v_antes + 2 THEN
    RAISE NOTICE '[3] reabrir no ancla; cerrar otra vez sí ........ ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[3] reabrir/cerrar ............................. ❌'; v_fail := v_fail + 1;
  END IF;

  -- [4]
  v_n := 0;
  BEGIN
    UPDATE accounting_chain_anchors SET hash = repeat('0', 64) WHERE tenant_id = v_tenant;
  EXCEPTION WHEN OTHERS THEN v_n := v_n + 1;
  END;
  BEGIN
    DELETE FROM accounting_chain_anchors WHERE tenant_id = v_tenant;
  EXCEPTION WHEN OTHERS THEN v_n := v_n + 1;
  END;
  IF v_n = 2 THEN RAISE NOTICE '[4] un ancla no se modifica ni se borra ......... ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[4] un ancla no se modifica ni se borra ......... ❌ %', v_n; v_fail := v_fail + 1; END IF;

  -- [5]
  SELECT count(*) INTO v_n FROM verify_chain_anchors(v_tenant,
    jsonb_build_array(jsonb_build_object('entry_number', v_nro, 'hash', v_hash)));
  IF v_n = 0 THEN RAISE NOTICE '[5] anclas de afuera que coinciden ............. ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[5] anclas de afuera que coinciden ............. ❌ %', v_n; v_fail := v_fail + 1; END IF;

  -- [6]
  SELECT count(*) INTO v_n FROM verify_chain_anchors(v_tenant, jsonb_build_array(
    jsonb_build_object('entry_number', v_nro, 'hash', repeat('f', 64)),
    jsonb_build_object('entry_number', 999999, 'hash', v_hash)));
  IF v_n = 2 THEN RAISE NOTICE '[6] hash distinto y asiento inexistente ........ ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[6] hash distinto y asiento inexistente ........ ❌ %', v_n; v_fail := v_fail + 1; END IF;

  -- [7] "Reescritura": se cambia el hash del asiento anclado con los triggers apagados.
  ALTER TABLE journal_entries DISABLE TRIGGER USER;
  UPDATE journal_entries SET hash = repeat('e', 64) WHERE tenant_id = v_tenant AND entry_number = v_nro;
  SELECT count(*) INTO v_n FROM verify_chain_anchors(v_tenant, NULL) WHERE nro_asiento = v_nro;
  IF v_n >= 1 THEN RAISE NOTICE '[7] reescritura del asiento anclado: delatada .. ✅'; v_ok := v_ok + 1;
  ELSE RAISE NOTICE '[7] reescritura del asiento anclado ............ ❌'; v_fail := v_fail + 1; END IF;

  -- [8]
  IF NOT has_table_privilege('service_role', 'public.accounting_chain_anchors', 'INSERT') THEN
    RAISE NOTICE '[8] service_role no escribe anclas a mano ....... ✅'; v_ok := v_ok + 1;
  ELSE
    RAISE NOTICE '[8] service_role no escribe anclas a mano ....... ❌'; v_fail := v_fail + 1;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '======== 075: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;
