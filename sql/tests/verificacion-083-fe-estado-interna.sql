-- Verificación de la 083. Todo dentro de una transacción que se deshace.
--   node scripts/run-sql.mjs sql/tests/verificacion-083-fe-estado-interna.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_nc_no  uuid;
  v_nc_aut uuid;
  v_inv    uuid;
  v_ok     int := 0;
  v_fail   int := 0;
BEGIN
  SELECT id INTO v_nc_no  FROM credit_notes WHERE tenant_id = v_tenant AND fe_estado = 'no_emitida' LIMIT 1;
  SELECT id INTO v_nc_aut FROM credit_notes WHERE tenant_id = v_tenant AND fe_estado = 'authorized' LIMIT 1;
  SELECT id INTO v_inv    FROM invoices     WHERE tenant_id = v_tenant AND status = 'emitida' AND fe_estado = 'no_emitida' LIMIT 1;

  -- [1] no_emitida → interna
  UPDATE credit_notes SET fe_estado = 'interna' WHERE id = v_nc_no;
  UPDATE invoices     SET fe_estado = 'interna' WHERE id = v_inv;
  RAISE NOTICE '[1] no_emitida → interna (NC y factura) ......... ✅'; v_ok := v_ok + 1;

  -- [2] interna es terminal
  BEGIN
    UPDATE credit_notes SET fe_estado = 'pending' WHERE id = v_nc_no;
    RAISE NOTICE '[2] interna → pending ........................... ❌ pasó'; v_fail := v_fail + 1;
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE '[2] interna → pending: rechazado ................ ✅'; v_ok := v_ok + 1;
  END;

  -- [3] authorized → interna no
  IF v_nc_aut IS NOT NULL THEN
    BEGIN
      UPDATE credit_notes SET fe_estado = 'interna' WHERE id = v_nc_aut;
      RAISE NOTICE '[3] authorized → interna ........................ ❌ pasó'; v_fail := v_fail + 1;
    EXCEPTION WHEN raise_exception THEN
      RAISE NOTICE '[3] authorized → interna: rechazado ............ ✅'; v_ok := v_ok + 1;
    END;
  ELSE
    RAISE NOTICE '[3] sin NC autorizada en staging: se omite';
  END IF;

  -- [4] un valor fuera del CHECK sigue rechazado
  BEGIN
    UPDATE invoices SET fe_estado = 'otra_cosa' WHERE id = v_inv;
    RAISE NOTICE '[4] valor inventado ............................. ❌ pasó'; v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation OR raise_exception THEN
    RAISE NOTICE '[4] valor inventado: rechazado .................. ✅'; v_ok := v_ok + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '======== 083: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;
