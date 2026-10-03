-- ============================================================================
-- Verificación de la 084 (audit_log solo agregar). Todo se deshace al final.
--   node scripts/run-sql.mjs sql/tests/verificacion-084-audit-log-solo-agregar.sql
--
-- Cambia de rol dentro de la transacción para probar como cada uno:
--   · authenticated, con el JWT de un usuario del bufete A (lo que puede hacer
--     el navegador con su sesión);
--   · service_role (lo que usan las 32 rutas que escriben audit_log);
--   · postgres (el SQL Editor; en Supabase no es superusuario).
-- ============================================================================
BEGIN;

CREATE TEMP TABLE _v084 (n int, ok boolean, texto text) ON COMMIT DROP;
GRANT INSERT, SELECT ON _v084 TO authenticated, service_role;

-- ── Preparación (postgres): un segundo bufete con una fila propia ──────────
INSERT INTO tenants (id, name, slug) VALUES ('b0000000-0000-0000-0000-00000000b084', 'Bufete de prueba 084', 'verif-084');
INSERT INTO audit_log (tenant_id, user_id, entity, entity_id, action, field, old_value, new_value)
VALUES ('b0000000-0000-0000-0000-00000000b084', NULL, 'verif_084', gen_random_uuid(), 'create', NULL, NULL, 'otro bufete');
INSERT INTO audit_log (tenant_id, user_id, entity, entity_id, action, field, old_value, new_value)
VALUES ('a0000000-0000-0000-0000-000000000001', NULL, 'verif_084', gen_random_uuid(), 'create', NULL, NULL, 'bufete A');

-- ── 1. Usuario autenticado del bufete A ────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"9e1bf090-a8cf-40ef-92c9-790de6f0d060","role":"authenticated","app_metadata":{"tenant_id":"a0000000-0000-0000-0000-000000000001"}}', true);

DO $$
DECLARE
  v_propias int; v_ajenas int; v_n int;
BEGIN
  SELECT count(*) INTO v_propias FROM audit_log;
  SELECT count(*) INTO v_ajenas  FROM audit_log WHERE tenant_id <> 'a0000000-0000-0000-0000-000000000001';
  INSERT INTO _v084 VALUES (1, v_propias > 0, format('autenticado lee su bufete (%s filas)', v_propias));
  INSERT INTO _v084 VALUES (2, v_ajenas = 0, format('autenticado no ve otro bufete (%s filas ajenas)', v_ajenas));

  BEGIN
    UPDATE audit_log SET new_value = 'editado' WHERE entity = 'verif_084';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _v084 VALUES (3, false, format('autenticado EDITÓ %s fila(s)', v_n));
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _v084 VALUES (3, true, 'autenticado no puede editar (sin permiso)');
  END;

  BEGIN
    DELETE FROM audit_log WHERE entity = 'verif_084';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _v084 VALUES (4, false, format('autenticado BORRÓ %s fila(s)', v_n));
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _v084 VALUES (4, true, 'autenticado no puede borrar (sin permiso)');
  END;

  -- Ninguna ruta inserta con la sesión: sin política de INSERT, RLS lo niega.
  BEGIN
    INSERT INTO audit_log (tenant_id, entity, entity_id, action)
    VALUES ('a0000000-0000-0000-0000-000000000001', 'verif_084', gen_random_uuid(), 'create');
    INSERT INTO _v084 VALUES (5, false, 'autenticado PUDO insertar con su sesión');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _v084 VALUES (5, true, 'autenticado no inserta con su sesión (ninguna ruta lo hace)');
  END;
END $$;

RESET ROLE;

-- ── 2. anon ───────────────────────────────────────────────────────────────
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM 1 FROM audit_log LIMIT 1;
  PERFORM set_config('verif.anon', 'leyo', true);
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM set_config('verif.anon', 'rechazado', true);
END $$;
RESET ROLE;
-- anon no tiene permiso sobre _v084: el resultado lo anota postgres.
INSERT INTO _v084
SELECT 6, current_setting('verif.anon', true) = 'rechazado',
       CASE WHEN current_setting('verif.anon', true) = 'rechazado' THEN 'anon no puede ni leer' ELSE 'anon PUDO leer audit_log' END;

-- ── 3. service_role: lo que usan las rutas ─────────────────────────────────
SET LOCAL ROLE service_role;
DO $$
DECLARE v_n int;
BEGIN
  INSERT INTO audit_log (tenant_id, user_id, entity, entity_id, action, field, old_value, new_value)
  VALUES ('a0000000-0000-0000-0000-000000000001', NULL, 'verif_084', gen_random_uuid(), 'update', 'campo', 'antes', 'después');
  INSERT INTO _v084 VALUES (7, true, 'service_role sigue insertando (las 32 rutas)');

  BEGIN
    UPDATE audit_log SET new_value = 'editado' WHERE entity = 'verif_084';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _v084 VALUES (8, false, format('service_role EDITÓ %s fila(s)', v_n));
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _v084 VALUES (8, true, 'service_role no puede editar (trigger)');
  END;

  BEGIN
    DELETE FROM audit_log WHERE entity = 'verif_084';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _v084 VALUES (9, false, format('service_role BORRÓ %s fila(s)', v_n));
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _v084 VALUES (9, true, 'service_role no puede borrar (trigger)');
  END;
END $$;
RESET ROLE;

-- ── 4. postgres (SQL Editor): tampoco es superusuario en Supabase ──────────
DO $$
BEGIN
  BEGIN
    DELETE FROM audit_log WHERE entity = 'verif_084';
    INSERT INTO _v084 VALUES (10, false, 'postgres PUDO borrar');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _v084 VALUES (10, true, 'postgres no puede borrar (no es superusuario en Supabase)');
  END;
  BEGIN
    TRUNCATE audit_log;
    INSERT INTO _v084 VALUES (11, false, 'postgres PUDO vaciar la tabla');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _v084 VALUES (11, true, 'nadie puede vaciar la tabla (TRUNCATE)');
  END;
END $$;

-- ── Resultado ─────────────────────────────────────────────────────────────
DO $$
DECLARE r record; v_ok int := 0; v_fail int := 0;
BEGIN
  FOR r IN SELECT * FROM _v084 ORDER BY n LOOP
    RAISE NOTICE '[%] % %', r.n, rpad(r.texto, 62, '.'), CASE WHEN r.ok THEN '✅' ELSE '❌' END;
    IF r.ok THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1; END IF;
  END LOOP;
  IF (SELECT count(*) FROM _v084) < 11 THEN
    RAISE NOTICE 'faltan pruebas: % de 11', (SELECT count(*) FROM _v084);
    v_fail := v_fail + (11 - (SELECT count(*) FROM _v084));
  END IF;
  RAISE NOTICE '';
  RAISE NOTICE '======== 084: % ok, % fallas (todo se deshace) ========', v_ok, v_fail;
END $$;

ROLLBACK;
