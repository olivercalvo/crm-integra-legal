-- ============================================================================
-- VERIFICACIÓN de la 057 — cuenta por defecto y persona de contacto.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja proveedores ni consume correlativo.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-057-proveedor-campos.sql
--
-- Diez comprobaciones, incluida la falla forzada DESPUÉS de insertar.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_ok      int := 0;
  v_fail    int := 0;
  v_n       int;
  v_id      uuid;
  v_err     text;

  -- Un nombre por prueba: `suppliers_tenant_legal_name_unique` es sobre
  -- lower(btrim(legal_name)), así que dos pruebas con el mismo nombre chocarían
  -- entre sí y el fallo parecería del CHECK que se está probando.
  v_sufijo  text := to_char(clock_timestamp(), 'HH24MISSMS');
BEGIN
  RAISE NOTICE '════════ VERIFICACIÓN 057 ════════';

  -- ── 1. Las cuatro columnas existen ───────────────────────────────────────
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='suppliers'
     AND column_name IN ('default_chart_account_code','contact_name','contact_phone','contact_email');
  IF v_n = 4 THEN v_ok := v_ok + 1; RAISE NOTICE '  ok  1. las 4 columnas existen';
  ELSE v_fail := v_fail + 1; RAISE WARNING ' FALLA 1. columnas: % de 4', v_n; END IF;

  -- ── 2. Las cuatro son NULLABLE (son opcionales) ──────────────────────────
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='suppliers'
     AND column_name IN ('default_chart_account_code','contact_name','contact_phone','contact_email')
     AND is_nullable = 'YES';
  IF v_n = 4 THEN v_ok := v_ok + 1; RAISE NOTICE '  ok  2. las 4 son nullable';
  ELSE v_fail := v_fail + 1; RAISE WARNING ' FALLA 2. nullable: % de 4', v_n; END IF;

  -- ── 3. Los cuatro CHECK existen ──────────────────────────────────────────
  SELECT count(*) INTO v_n FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
   WHERE r.relname='suppliers' AND c.contype='c'
     AND c.conname IN ('suppliers_default_account_length','suppliers_contact_name_length',
                       'suppliers_contact_phone_length','suppliers_contact_email_length');
  IF v_n = 4 THEN v_ok := v_ok + 1; RAISE NOTICE '  ok  3. los 4 CHECK existen';
  ELSE v_fail := v_fail + 1; RAISE WARNING ' FALLA 3. CHECK: % de 4', v_n; END IF;

  -- ── 4. `phone`/`email` de la EMPRESA no se tocaron ───────────────────────
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='suppliers' AND column_name IN ('phone','email');
  IF v_n = 2 THEN v_ok := v_ok + 1; RAISE NOTICE '  ok  4. phone/email de la empresa siguen ahí';
  ELSE v_fail := v_fail + 1; RAISE WARNING ' FALLA 4. phone/email: % de 2', v_n; END IF;

  -- ── 5. Un proveedor con las cuatro en NULL se acepta ─────────────────────
  BEGIN
    INSERT INTO public.suppliers (tenant_id, supplier_number, legal_name)
    VALUES (v_tenant, 'PRV-T5' || v_sufijo, 'Prueba 057 nulos ' || v_sufijo)
    RETURNING id INTO v_id;
    v_ok := v_ok + 1; RAISE NOTICE '  ok  5. las cuatro en NULL se aceptan (son opcionales)';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_fail := v_fail + 1; RAISE WARNING ' FALLA 5. rechazó los NULL: %', v_err;
  END;

  -- ── 6. Un proveedor con las cuatro cargadas se acepta ────────────────────
  BEGIN
    INSERT INTO public.suppliers (tenant_id, supplier_number, legal_name,
                                  phone, email,
                                  default_chart_account_code,
                                  contact_name, contact_phone, contact_email)
    VALUES (v_tenant, 'PRV-T6' || v_sufijo, 'Prueba 057 completo ' || v_sufijo,
            '507-300-0000', 'central@proveedor.test',
            '610003',
            'Ana Pérez', '507-6000-0000', 'ana.perez@proveedor.test')
    RETURNING id INTO v_id;
    v_ok := v_ok + 1; RAISE NOTICE '  ok  6. las cuatro cargadas se aceptan';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    v_fail := v_fail + 1; RAISE WARNING ' FALLA 6. rechazó datos válidos: %', v_err;
  END;

  -- ── 7. El contacto es INDEPENDIENTE de la empresa ────────────────────────
  SELECT count(*) INTO v_n FROM public.suppliers
   WHERE id = v_id AND phone <> contact_phone AND email <> contact_email;
  IF v_n = 1 THEN v_ok := v_ok + 1; RAISE NOTICE '  ok  7. contact_phone/email conviven con los de la empresa';
  ELSE v_fail := v_fail + 1; RAISE WARNING ' FALLA 7. el contacto no quedó separado de la empresa'; END IF;

  -- ── 8. Los CHECK rechazan lo que tienen que rechazar ─────────────────────
  -- 8a. contact_name de 1 carácter
  BEGIN
    INSERT INTO public.suppliers (tenant_id, supplier_number, legal_name, contact_name)
    VALUES (v_tenant, 'PRV-T8a' || v_sufijo, 'Prueba 057 corto ' || v_sufijo, 'A');
    v_fail := v_fail + 1; RAISE WARNING ' FALLA 8a. aceptó contact_name de 1 carácter';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1; RAISE NOTICE '  ok  8a. rechaza contact_name de 1 carácter';
  END;

  -- 8b. contact_email de 4 caracteres
  BEGIN
    INSERT INTO public.suppliers (tenant_id, supplier_number, legal_name, contact_email)
    VALUES (v_tenant, 'PRV-T8b' || v_sufijo, 'Prueba 057 mail ' || v_sufijo, 'a@b');
    v_fail := v_fail + 1; RAISE WARNING ' FALLA 8b. aceptó contact_email de 3 caracteres';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1; RAISE NOTICE '  ok  8b. rechaza contact_email demasiado corto';
  END;

  -- 8c. default_chart_account_code de 21 caracteres
  BEGIN
    INSERT INTO public.suppliers (tenant_id, supplier_number, legal_name, default_chart_account_code)
    VALUES (v_tenant, 'PRV-T8c' || v_sufijo, 'Prueba 057 cuenta ' || v_sufijo, repeat('9', 21));
    v_fail := v_fail + 1; RAISE WARNING ' FALLA 8c. aceptó un código de 21 caracteres';
  EXCEPTION WHEN check_violation THEN
    v_ok := v_ok + 1; RAISE NOTICE '  ok  8c. rechaza default_chart_account_code de 21 caracteres';
  END;

  -- ── 9. NO hay FK real hacia chart_of_accounts (es lógico, a propósito) ───
  SELECT count(*) INTO v_n
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
   WHERE r.relname='suppliers' AND c.contype='f'
     AND pg_get_constraintdef(c.oid) ILIKE '%chart_of_accounts%';
  IF v_n = 0 THEN
    v_ok := v_ok + 1;
    RAISE NOTICE '  ok  9. sin FK real a chart_of_accounts (FK lógico, ver el encabezado)';
  ELSE
    v_fail := v_fail + 1;
    RAISE WARNING ' FALLA 9. apareció un FK real a chart_of_accounts: la 057 lo decidió al revés';
  END IF;

  RAISE NOTICE '──────── % correctas, % fallidas ────────', v_ok, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION '057: % comprobación(es) fallida(s).', v_fail;
  END IF;
END $$;

-- ── 10. FALLA FORZADA: lo insertado arriba NO debe sobrevivir ──────────────
-- Se cuenta antes y después del ROLLBACK desde fuera de la transacción. Acá
-- dentro sólo se deja constancia de cuántas filas hay a mitad de camino.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.suppliers WHERE legal_name LIKE 'Prueba 057%';
  RAISE NOTICE '  ·  dentro de la transacción hay % proveedor(es) de prueba', v_n;
  IF v_n = 0 THEN
    RAISE EXCEPTION '057: no se insertó ninguno, la prueba de rollback no probaría nada.';
  END IF;
END $$;

ROLLBACK;

-- ============================================================================
-- Después del ROLLBACK: la tabla tiene que estar como estaba.
-- ============================================================================
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.suppliers WHERE legal_name LIKE 'Prueba 057%';
  IF v_n = 0 THEN
    RAISE NOTICE '  ok 10. el ROLLBACK dejó la tabla intacta: 0 proveedores de prueba';
    RAISE NOTICE '════════ 057 VERIFICADA — 10/10 ════════';
  ELSE
    RAISE EXCEPTION '057: el ROLLBACK no limpió: quedaron % proveedor(es) de prueba.', v_n;
  END IF;
END $$;
