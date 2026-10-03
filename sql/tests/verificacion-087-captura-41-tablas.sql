-- ============================================================================
-- VERIFICACIÓN de la 087 (+ 089): las 41 tablas con captura, operación por
-- operación. 🔴 OBLIGATORIA antes de cualquier ventana de producción
-- (docs/runbooks/despliegue-025-055.md, paso −1), contra staging con el mismo
-- esquema que va a producción.
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja filas, ni en las tablas ni en las bitácoras.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-087-captura-41-tablas.sql
--
-- Por qué existe: la 087 se simuló tocando clientes y casos, y la rama de
-- tareas, comentarios y cobros del caso de auditoria.documento_de tenía un error
-- de tipos que sólo aparecía al ejecutarla (PL/pgSQL prepara cada consulta
-- recién al usarla). Como la captura falla cerrado, eso dejó a staging sin poder
-- guardar comentarios (03/10/2026, corregido por la 089). Esta prueba ejecuta
-- TODAS las ramas con filas reales.
--
-- Qué hace, en cada una de las 41 tablas con trg_auditoria:
--   · INSERT, UPDATE y DELETE sobre una fila que crea la propia prueba (si la
--     tabla no tiene filas en staging, igual: la prueba no depende de ellas).
--   · Cada operación tiene que dejar su fila en la bitácora que le toca, con el
--     usuario de la sesión, origen «usuario», la acción esperada (al crear y al
--     borrar) y la columna cambiada (al editar). Y NO dejarla en la otra.
--   · Las mixtas se prueban por los dos lados: un cambio fiscal va a las dos,
--     uno que no lo es sólo a la legal.
--   · Donde una regla de negocio rechaza la operación (el libro, una NC emitida,
--     una aplicación), se anota el rechazo con su mensaje. Si el error viene de
--     una función de `auditoria`, es FALLA siempre.
-- Termina con EXCEPTION si una sola operación falla o si alguna de las 41
-- tablas quedó sin una operación capturada.
-- ============================================================================
BEGIN;

CREATE TEMP TABLE resultados (n serial, tabla text, op text, ok boolean, detalle text) ON COMMIT DROP;
CREATE TEMP TABLE ref (clave text PRIMARY KEY, valor text) ON COMMIT DROP;

-- Una operación: la ejecuta, y mira qué quedó en cada bitácora.
--   p_regla: 'debe_entrar' | 'puede_rechazarse' | 'debe_rechazarse'
CREATE FUNCTION pg_temp.probar(p_tabla text, p_op text, p_sql text, p_modulos text[],
                               p_accion text, p_columna text, p_regla text DEFAULT 'debe_entrar')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_actor uuid := (SELECT valor::uuid FROM ref WHERE clave = 'actor');
  v_c0 bigint := (SELECT coalesce(max(id), 0) FROM auditoria.bitacora_contable);
  v_l0 bigint := (SELECT coalesce(max(id), 0) FROM auditoria.bitacora_legal);
  v_id text; v_msg text; v_ctx text; m text; v_bien int; v_todas int; v_err text := '';
BEGIN
  BEGIN
    EXECUTE p_sql INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    IF v_ctx ILIKE '%auditoria.%' THEN
      INSERT INTO resultados (tabla, op, ok, detalle) VALUES (p_tabla, p_op, false, 'ROMPIÓ LA BITÁCORA: ' || v_msg);
    ELSIF p_regla <> 'debe_entrar' THEN
      INSERT INTO resultados (tabla, op, ok, detalle) VALUES (p_tabla, p_op, true, 'rechazada por regla de negocio: ' || v_msg);
    ELSE
      INSERT INTO resultados (tabla, op, ok, detalle) VALUES (p_tabla, p_op, false, 'la operación de prueba no entró: ' || v_msg);
    END IF;
    RETURN NULL;
  END;
  IF v_id IS NULL THEN
    INSERT INTO resultados (tabla, op, ok, detalle) VALUES (p_tabla, p_op, false, 'la sentencia no afectó ninguna fila');
    RETURN NULL;
  END IF;
  IF p_regla = 'debe_rechazarse' THEN
    INSERT INTO resultados (tabla, op, ok, detalle) VALUES (p_tabla, p_op, false, 'debía rechazarse y entró');
    RETURN v_id;
  END IF;

  FOREACH m IN ARRAY ARRAY['contable', 'legal'] LOOP
    EXECUTE format(
      'SELECT count(*) FILTER (WHERE usuario_id = $3 AND origen = ''usuario''
                                 AND ($4::text IS NULL OR accion = $4) AND ($5::text IS NULL OR cambios ? $5)),
              count(*)
         FROM auditoria.%I WHERE id > $1 AND tabla = $2 AND registro_id = $6',
      'bitacora_' || m)
      INTO v_bien, v_todas
      USING CASE m WHEN 'contable' THEN v_c0 ELSE v_l0 END, p_tabla, v_actor, p_accion, p_columna, v_id;
    IF m = ANY (p_modulos) AND v_bien = 0 THEN
      v_err := v_err || format(' falta en la %s (filas: %s);', m, v_todas);
    ELSIF NOT (m = ANY (p_modulos)) AND v_todas > 0 THEN
      v_err := v_err || format(' no debía ir a la %s;', m);
    END IF;
  END LOOP;
  INSERT INTO resultados (tabla, op, ok, detalle)
  VALUES (p_tabla, p_op, v_err = '', CASE WHEN v_err = '' THEN 'en ' || array_to_string(p_modulos, ' y ') ELSE trim(v_err) END);
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.r(p text) RETURNS text LANGUAGE sql AS $$ SELECT valor FROM ref WHERE clave = p $$;

DO $$
DECLARE
  T  constant uuid := 'a0000000-0000-0000-0000-000000000001';
  C  constant text := '{contable}';
  L  constant text := '{legal}';
  CL constant text := '{contable,legal}';
  sfx text := to_char(clock_timestamp(), 'HH24MISSUS');
  hoy date := (now() AT TIME ZONE 'America/Panama')::date;
  v_admin uuid; v_cli uuid; v_prov uuid; v_serv uuid; v_tax uuid; v_banco text; v_fac uuid; v_cli_fac uuid;
  v_ab2 uuid; v_asis uuid; v_je1 uuid; v_je2 uuid; v_cta_gasto text; v_cta_ing text;
  v_id text; v_caso text; v_fact text; v_nc text; v_cob text; v_comp text; v_gasto text; v_cot text; v_ncp text;
  v_usr uuid := gen_random_uuid(); v_imp jsonb; v_row jsonb;
BEGIN
  -- ── Referencias de staging ────────────────────────────────────────────────
  SELECT id INTO v_admin FROM users WHERE tenant_id = T AND role = 'admin' AND active ORDER BY created_at LIMIT 1;
  SELECT id INTO v_ab2 FROM users WHERE tenant_id = T AND role = 'abogada' ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO v_asis FROM users WHERE tenant_id = T AND role = 'asistente' LIMIT 1;
  SELECT id INTO v_cli FROM clients WHERE tenant_id = T AND client_status = 'active' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_prov FROM suppliers WHERE tenant_id = T AND active ORDER BY created_at LIMIT 1;
  SELECT id INTO v_serv FROM services_catalog WHERE tenant_id = T AND active AND service_type = 'honorarios' ORDER BY code LIMIT 1;
  SELECT id INTO v_tax FROM tax_codes WHERE tenant_id = T AND code = 'ITBMS_7';
  SELECT payment_account_code INTO v_banco FROM payments WHERE tenant_id = T AND payment_account_code IS NOT NULL LIMIT 1;
  SELECT id, client_id INTO v_fac, v_cli_fac FROM invoices
   WHERE tenant_id = T AND status IN ('emitida', 'parcialmente_pagada') AND balance_due >= 5 ORDER BY created_at LIMIT 1;
  SELECT id INTO v_je1 FROM journal_entries WHERE tenant_id = T ORDER BY entry_number LIMIT 1;
  SELECT id INTO v_je2 FROM journal_entries WHERE tenant_id = T ORDER BY entry_number DESC LIMIT 1;
  SELECT code INTO v_cta_gasto FROM chart_of_accounts WHERE tenant_id = T AND active AND account_type = 'expense' AND cuenta_control IS NULL ORDER BY code LIMIT 1;
  SELECT revenue_account INTO v_cta_ing FROM services_catalog WHERE id = v_serv;
  IF v_admin IS NULL OR v_cli IS NULL OR v_prov IS NULL OR v_serv IS NULL OR v_tax IS NULL OR v_banco IS NULL
     OR v_fac IS NULL OR v_je1 IS NULL OR v_cta_gasto IS NULL OR v_ab2 IS NULL OR v_asis IS NULL THEN
    RAISE EXCEPTION 'Faltan datos de referencia en staging (admin, abogada, asistente, cliente, proveedor, servicio, ITBMS_7, banco, factura emitida con saldo, asiento, cuenta de gasto)';
  END IF;
  INSERT INTO ref VALUES ('actor', v_admin::text);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.headers', json_build_object('x-actor-id', v_admin)::text, true);

  -- ── LEGAL ─────────────────────────────────────────────────────────────────
  v_caso := pg_temp.probar('cases', 'INSERT', format(
    $q$INSERT INTO cases (tenant_id, client_id, case_code, description) VALUES (%L, %L, %L, 'Caso de la verificación 087') RETURNING id::text$q$,
    T, v_cli, 'AUD-' || sfx), L::text[], 'crear', NULL);
  PERFORM pg_temp.probar('cases', 'UPDATE', format($q$UPDATE cases SET observations = 'editado' WHERE id = %L RETURNING id::text$q$, v_caso), L::text[], NULL, 'observations');

  v_id := pg_temp.probar('tasks', 'INSERT', format(
    $q$INSERT INTO tasks (tenant_id, case_id, description, created_by) VALUES (%L, %L, 'Tarea 087', %L) RETURNING id::text$q$, T, v_caso, v_admin), L::text[], 'crear', NULL);
  PERFORM pg_temp.probar('tasks', 'UPDATE', format($q$UPDATE tasks SET status = 'cumplida', completed_at = now() WHERE id = %L RETURNING id::text$q$, v_id), L::text[], NULL, 'status');
  PERFORM pg_temp.probar('tasks', 'DELETE', format($q$DELETE FROM tasks WHERE id = %L RETURNING id::text$q$, v_id), L::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('comments', 'INSERT', format(
    $q$INSERT INTO comments (tenant_id, case_id, text, user_id) VALUES (%L, %L, 'Comentario 087', %L) RETURNING id::text$q$, T, v_caso, v_admin), L::text[], 'crear', NULL);
  PERFORM pg_temp.probar('comments', 'UPDATE', format($q$UPDATE comments SET text = 'Comentario 087 editado' WHERE id = %L RETURNING id::text$q$, v_id), L::text[], NULL, 'text');
  PERFORM pg_temp.probar('comments', 'DELETE', format($q$DELETE FROM comments WHERE id = %L RETURNING id::text$q$, v_id), L::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('client_payments', 'INSERT', format(
    $q$INSERT INTO client_payments (tenant_id, case_id, amount, registered_by) VALUES (%L, %L, 10, %L) RETURNING id::text$q$, T, v_caso, v_admin), L::text[], 'crear', NULL);
  PERFORM pg_temp.probar('client_payments', 'UPDATE', format($q$UPDATE client_payments SET amount = 12 WHERE id = %L RETURNING id::text$q$, v_id), L::text[], NULL, 'amount');
  PERFORM pg_temp.probar('client_payments', 'DELETE', format($q$DELETE FROM client_payments WHERE id = %L RETURNING id::text$q$, v_id), L::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('documents', 'INSERT', format(
    $q$INSERT INTO documents (tenant_id, entity_type, entity_id, file_name, file_path, storage_key, uploaded_by)
       VALUES (%L, 'case', %L, 'verificacion-087.pdf', 'x/verificacion-087.pdf', 'x/verificacion-087.pdf', %L) RETURNING id::text$q$, T, v_caso, v_admin), L::text[], 'crear', NULL);
  PERFORM pg_temp.probar('documents', 'UPDATE', format($q$UPDATE documents SET file_name = 'verificacion-087-b.pdf' WHERE id = %L RETURNING id::text$q$, v_id), L::text[], NULL, 'file_name');
  PERFORM pg_temp.probar('documents', 'DELETE', format($q$DELETE FROM documents WHERE id = %L RETURNING id::text$q$, v_id), L::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('cat_classifications', 'INSERT', format(
    $q$INSERT INTO cat_classifications (tenant_id, name, prefix) VALUES (%L, 'Clasificación 087', 'A87') RETURNING id::text$q$, T), L::text[], 'crear', NULL);
  PERFORM pg_temp.probar('cat_classifications', 'UPDATE', format($q$UPDATE cat_classifications SET name = 'Clasificación 087 b' WHERE id = %L RETURNING id::text$q$, v_id), L::text[], NULL, 'name');
  PERFORM pg_temp.probar('cat_classifications', 'DELETE', format($q$DELETE FROM cat_classifications WHERE id = %L RETURNING id::text$q$, v_id), L::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('cat_institutions', 'INSERT', format(
    $q$INSERT INTO cat_institutions (tenant_id, name) VALUES (%L, 'Institución 087') RETURNING id::text$q$, T), L::text[], 'crear', NULL);
  PERFORM pg_temp.probar('cat_institutions', 'UPDATE', format($q$UPDATE cat_institutions SET active = false WHERE id = %L RETURNING id::text$q$, v_id), L::text[], NULL, 'active');
  PERFORM pg_temp.probar('cat_institutions', 'DELETE', format($q$DELETE FROM cat_institutions WHERE id = %L RETURNING id::text$q$, v_id), L::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('cat_statuses', 'INSERT', format(
    $q$INSERT INTO cat_statuses (tenant_id, name) VALUES (%L, 'Estado 087') RETURNING id::text$q$, T), L::text[], 'crear', NULL);
  PERFORM pg_temp.probar('cat_statuses', 'UPDATE', format($q$UPDATE cat_statuses SET name = 'Estado 087 b' WHERE id = %L RETURNING id::text$q$, v_id), L::text[], NULL, 'name');
  PERFORM pg_temp.probar('cat_statuses', 'DELETE', format($q$DELETE FROM cat_statuses WHERE id = %L RETURNING id::text$q$, v_id), L::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('cat_team', 'INSERT', format(
    $q$INSERT INTO cat_team (tenant_id, name, role) VALUES (%L, 'Integrante 087', 'abogada') RETURNING id::text$q$, T), L::text[], 'crear', NULL);
  PERFORM pg_temp.probar('cat_team', 'UPDATE', format($q$UPDATE cat_team SET name = 'Integrante 087 b' WHERE id = %L RETURNING id::text$q$, v_id), L::text[], NULL, 'name');
  PERFORM pg_temp.probar('cat_team', 'DELETE', format($q$DELETE FROM cat_team WHERE id = %L RETURNING id::text$q$, v_id), L::text[], 'eliminar', NULL);

  -- ── MIXTAS ────────────────────────────────────────────────────────────────
  -- clients: alta y baja a las dos; un dato fiscal a las dos; uno que no lo es, sólo a la legal.
  v_id := pg_temp.probar('clients', 'INSERT', format(
    $q$INSERT INTO clients (tenant_id, client_number, name, client_type) VALUES (%L, %L, 'Cliente 087', 'persona_natural') RETURNING id::text$q$,
    T, 'AUD-' || sfx), CL::text[], 'crear', NULL);
  PERFORM pg_temp.probar('clients', 'UPDATE fiscal (DV)', format($q$UPDATE clients SET digito_verificador = '42' WHERE id = %L RETURNING id::text$q$, v_id), CL::text[], NULL, 'digito_verificador');
  PERFORM pg_temp.probar('clients', 'UPDATE no fiscal', format($q$UPDATE clients SET observations = 'nota' WHERE id = %L RETURNING id::text$q$, v_id), L::text[], NULL, 'observations');
  PERFORM pg_temp.probar('clients', 'DELETE', format($q$DELETE FROM clients WHERE id = %L RETURNING id::text$q$, v_id), CL::text[], 'eliminar', NULL);

  -- expenses (gasto de trámite sin asentar): la descripción sólo a la legal; el monto a las dos.
  v_gasto := pg_temp.probar('expenses', 'INSERT', format(
    $q$INSERT INTO expenses (tenant_id, case_id, amount, concept, registered_by, supplier_id) VALUES (%L, %L, 15, 'Gasto 087', %L, %L) RETURNING id::text$q$,
    T, v_caso, v_admin, v_prov), CL::text[], 'crear', NULL);
  PERFORM pg_temp.probar('expenses', 'UPDATE no fiscal (concepto)', format($q$UPDATE expenses SET concept = 'Gasto 087 b' WHERE id = %L RETURNING id::text$q$, v_gasto), L::text[], NULL, 'concept');
  PERFORM pg_temp.probar('expenses', 'UPDATE fiscal (monto)', format($q$UPDATE expenses SET amount = 16 WHERE id = %L RETURNING id::text$q$, v_gasto), CL::text[], NULL, 'amount');

  -- expense_lines: la de un gasto de trámite va a las dos.
  v_id := pg_temp.probar('expense_lines', 'INSERT (gasto de trámite)', format(
    $q$INSERT INTO expense_lines (tenant_id, expense_id, line_order, description, chart_account_code, amount) VALUES (%L, %L, 1, 'Línea 087', '130003', 16) RETURNING id::text$q$,
    T, v_gasto), CL::text[], 'crear', NULL);
  PERFORM pg_temp.probar('expense_lines', 'UPDATE (gasto de trámite)', format($q$UPDATE expense_lines SET description = 'Línea 087 b' WHERE id = %L RETURNING id::text$q$, v_id), CL::text[], NULL, 'description');
  PERFORM pg_temp.probar('expense_lines', 'DELETE (gasto de trámite)', format($q$DELETE FROM expense_lines WHERE id = %L RETURNING id::text$q$, v_id), CL::text[], 'eliminar', NULL);
  PERFORM pg_temp.probar('expenses', 'DELETE', format($q$DELETE FROM expenses WHERE id = %L RETURNING id::text$q$, v_gasto), CL::text[], 'eliminar', NULL);

  -- users: alta y baja (rol de Finanzas) a las dos; cambio de rol a las dos; el nombre de un asistente, sólo a la legal.
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_usr, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'verificacion-087-' || sfx || '@staging.test', now(), now());
  PERFORM pg_temp.probar('users', 'INSERT', format(
    $q$INSERT INTO users (id, tenant_id, email, full_name, role) VALUES (%L, %L, %L, 'Usuario 087', 'abogada') RETURNING id::text$q$,
    v_usr, T, 'verificacion-087-' || sfx || '@staging.test'), CL::text[], 'crear', NULL);
  PERFORM pg_temp.probar('users', 'UPDATE rol', format($q$UPDATE users SET role = 'asistente' WHERE id = %L RETURNING id::text$q$, v_ab2), CL::text[], NULL, 'role');
  PERFORM pg_temp.probar('users', 'UPDATE nombre de asistente', format($q$UPDATE users SET full_name = full_name || ' (087)' WHERE id = %L RETURNING id::text$q$, v_asis), L::text[], NULL, 'full_name');
  PERFORM pg_temp.probar('users', 'DELETE', format($q$DELETE FROM users WHERE id = %L RETURNING id::text$q$, v_usr), CL::text[], 'eliminar', NULL);

  -- ── CONTABLE: catálogos y configuración ───────────────────────────────────
  v_id := pg_temp.probar('suppliers', 'INSERT', format(
    $q$INSERT INTO suppliers (tenant_id, supplier_number, legal_name) VALUES (%L, %L, %L) RETURNING id::text$q$, T, 'AUD-' || sfx, 'Proveedor 087 ' || sfx), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('suppliers', 'UPDATE', format($q$UPDATE suppliers SET dv = '9' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'dv');
  PERFORM pg_temp.probar('suppliers', 'DELETE', format($q$DELETE FROM suppliers WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('chart_of_accounts', 'INSERT', format(
    $q$INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, active) VALUES (%L, '999087', 'Cuenta 087', 'expense', false) RETURNING id::text$q$, T), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('chart_of_accounts', 'UPDATE', format($q$UPDATE chart_of_accounts SET name = 'Cuenta 087 b' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'name');
  PERFORM pg_temp.probar('chart_of_accounts', 'DELETE', format($q$DELETE FROM chart_of_accounts WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('tax_codes', 'INSERT', format(
    $q$INSERT INTO tax_codes (tenant_id, code, name, rate, account_code) VALUES (%L, 'AUD_087', 'Tasa 087', 0.05, '200003') RETURNING id::text$q$, T), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('tax_codes', 'UPDATE', format($q$UPDATE tax_codes SET name = 'Tasa 087 b' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'name');
  PERFORM pg_temp.probar('tax_codes', 'DELETE', format($q$DELETE FROM tax_codes WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('services_catalog', 'INSERT', format(
    $q$INSERT INTO services_catalog (tenant_id, code, name, service_type, revenue_account, default_tax_code) VALUES (%L, 'AUD-087', 'Servicio 087', 'honorarios', %L, 'ITBMS_7') RETURNING id::text$q$, T, v_cta_ing), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('services_catalog', 'UPDATE', format($q$UPDATE services_catalog SET name = 'Servicio 087 b' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'name');
  PERFORM pg_temp.probar('services_catalog', 'DELETE', format($q$DELETE FROM services_catalog WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);

  -- Tablas de UNA fila por bufete o por tipo: se edita, se borra y se vuelve a crear igual.
  PERFORM pg_temp.probar('numbering_sequences', 'UPDATE (salto)', format($q$UPDATE numbering_sequences SET last_number = last_number + 5 WHERE tenant_id = %L AND sequence_type = 'quote' RETURNING id::text$q$, T), C::text[], NULL, 'last_number');
  -- el +1 de cada emisión NO se registra (es ruido): se comprueba aparte abajo.
  SELECT to_jsonb(s) INTO v_row FROM numbering_sequences s WHERE tenant_id = T AND sequence_type = 'quote';
  PERFORM pg_temp.probar('numbering_sequences', 'DELETE', format($q$DELETE FROM numbering_sequences WHERE id = %L RETURNING id::text$q$, v_row->>'id'), C::text[], 'eliminar', NULL);
  PERFORM pg_temp.probar('numbering_sequences', 'INSERT', format(
    $q$INSERT INTO numbering_sequences (id, tenant_id, sequence_type, last_number) VALUES (%L, %L, 'quote', %s) RETURNING id::text$q$,
    v_row->>'id', T, v_row->>'last_number'), C::text[], 'crear', NULL);

  PERFORM pg_temp.probar('finanzas_parametros', 'UPDATE', format($q$UPDATE finanzas_parametros SET isr_rate = 0.25 WHERE tenant_id = %L RETURNING tenant_id::text$q$, T), C::text[], NULL, 'isr_rate');
  SELECT to_jsonb(p) INTO v_row FROM finanzas_parametros p WHERE tenant_id = T;
  PERFORM pg_temp.probar('finanzas_parametros', 'DELETE', format($q$DELETE FROM finanzas_parametros WHERE tenant_id = %L RETURNING tenant_id::text$q$, T), C::text[], 'eliminar', NULL);
  PERFORM pg_temp.probar('finanzas_parametros', 'INSERT', format($q$INSERT INTO finanzas_parametros (tenant_id, isr_rate) VALUES (%L, %s) RETURNING tenant_id::text$q$, T, v_row->>'isr_rate'), C::text[], 'crear', NULL);

  PERFORM pg_temp.probar('quote_terms_template', 'UPDATE', format($q$UPDATE quote_terms_template SET content = content || ' ' WHERE tenant_id = %L RETURNING id::text$q$, T), C::text[], NULL, 'content');
  SELECT to_jsonb(q) INTO v_row FROM quote_terms_template q WHERE tenant_id = T;
  PERFORM pg_temp.probar('quote_terms_template', 'DELETE', format($q$DELETE FROM quote_terms_template WHERE tenant_id = %L RETURNING id::text$q$, T), C::text[], 'eliminar', NULL);
  PERFORM pg_temp.probar('quote_terms_template', 'INSERT', format($q$INSERT INTO quote_terms_template (id, tenant_id, content) VALUES (%L, %L, %L) RETURNING id::text$q$, v_row->>'id', T, v_row->>'content'), C::text[], 'crear', NULL);

  v_id := pg_temp.probar('accounting_periods', 'INSERT', format(
    $q$INSERT INTO accounting_periods (tenant_id, year, month) VALUES (%L, 2099, 1) RETURNING id::text$q$, T), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('accounting_periods', 'UPDATE (cerrar)', format($q$UPDATE accounting_periods SET status = 'cerrado', closed_at = now(), closed_by = %L WHERE id = %L RETURNING id::text$q$, v_admin, v_id), C::text[], 'cerrar', 'status');
  -- Cerrar deja el ancla de la bitácora contable (086), además de la del libro (075).
  INSERT INTO resultados (tabla, op, ok, detalle)
  SELECT 'accounting_periods', 'ancla al cerrar', count(*) = 1, 'anclas cierre_periodo 2099-01: ' || count(*)
    FROM auditoria.anclas WHERE tenant_id = T AND modulo = 'contable' AND motivo = 'cierre_periodo' AND referencia = '2099-01';
  -- El período cerrado ya no se puede borrar (lo ata el ancla del libro), así que se borra otro, abierto.
  v_id := pg_temp.probar('accounting_periods', 'INSERT', format(
    $q$INSERT INTO accounting_periods (tenant_id, year, month) VALUES (%L, 2099, 2) RETURNING id::text$q$, T), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('accounting_periods', 'DELETE', format($q$DELETE FROM accounting_periods WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('tax_payments', 'INSERT', format(
    $q$INSERT INTO tax_payments (tenant_id, payment_date, amount, period_covered_from, period_covered_to, created_by) VALUES (%L, %L, 5, %L, %L, %L) RETURNING id::text$q$,
    T, hoy, hoy, hoy, v_admin), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('tax_payments', 'UPDATE', format($q$UPDATE tax_payments SET notes = 'nota 087' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'notes');
  PERFORM pg_temp.probar('tax_payments', 'DELETE', format($q$DELETE FROM tax_payments WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);

  -- ── CONTABLE: ventas ──────────────────────────────────────────────────────
  v_fact := pg_temp.probar('invoices', 'INSERT', format(
    $q$INSERT INTO invoices (tenant_id, invoice_number, invoice_kind, client_id, issue_date, due_date, created_by)
       VALUES (%L, %L, 'HONORARIOS', %L, %L, %L, %L) RETURNING id::text$q$, T, 'DRAFT-AUD-' || sfx, v_cli, hoy, hoy, v_admin), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('invoices', 'UPDATE', format($q$UPDATE invoices SET notes = 'nota 087' WHERE id = %L RETURNING id::text$q$, v_fact), C::text[], NULL, 'notes');
  v_id := pg_temp.probar('invoice_lines', 'INSERT', format(
    $q$INSERT INTO invoice_lines (tenant_id, invoice_id, line_order, service_id, description, quantity, unit_price, tax_code, tax_rate, tax_code_id)
       VALUES (%L, %L, 1, %L, 'Línea 087', 1, 10, 'ITBMS_7', 0.07, %L) RETURNING id::text$q$, T, v_fact, v_serv, v_tax), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('invoice_lines', 'UPDATE', format($q$UPDATE invoice_lines SET description = 'Línea 087 b' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'description');
  PERFORM pg_temp.probar('invoice_lines', 'DELETE', format($q$DELETE FROM invoice_lines WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('fe_emisiones', 'INSERT', format(
    $q$INSERT INTO fe_emisiones (tenant_id, invoice_id, intento, i_amb) VALUES (%L, %L, 1, 2) RETURNING id::text$q$, T, v_fact), C::text[], 'enviar_dgi', NULL);
  PERFORM pg_temp.probar('fe_emisiones', 'UPDATE', format($q$UPDATE fe_emisiones SET autorizada = false WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'autorizada');
  PERFORM pg_temp.probar('fe_emisiones', 'DELETE', format($q$DELETE FROM fe_emisiones WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('fe_anulaciones', 'INSERT', format(
    $q$INSERT INTO fe_anulaciones (tenant_id, invoice_id, intento, cufe, motivo, resultado) VALUES (%L, %L, 1, 'CUFE-087', 'Motivo de la verificación 087', 'sin_respuesta') RETURNING id::text$q$, T, v_fact), C::text[], 'anular_dgi', NULL);
  PERFORM pg_temp.probar('fe_anulaciones', 'UPDATE', format($q$UPDATE fe_anulaciones SET resultado = 'indeterminada' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'resultado');
  PERFORM pg_temp.probar('fe_anulaciones', 'DELETE', format($q$DELETE FROM fe_anulaciones WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);

  PERFORM pg_temp.probar('invoices', 'DELETE (borrador)', format($q$DELETE FROM invoices WHERE id = %L RETURNING id::text$q$, v_fact), C::text[], 'eliminar', NULL, 'puede_rechazarse');

  -- Nota de crédito suelta (saldo a favor) del cliente de una factura emitida, y su aplicación.
  v_nc := pg_temp.probar('credit_notes', 'INSERT', format(
    $q$INSERT INTO credit_notes (tenant_id, credit_note_number, client_id, issue_date, reason, created_by) VALUES (%L, %L, %L, %L, 'Verificación 087', %L) RETURNING id::text$q$,
    T, 'NC-AUD-' || sfx, v_cli_fac, hoy, v_admin), C::text[], 'crear', NULL);
  v_id := pg_temp.probar('credit_note_lines', 'INSERT', format(
    $q$INSERT INTO credit_note_lines (tenant_id, credit_note_id, line_order, service_id, description, quantity, unit_price, tax_code, tax_rate, tax_code_id)
       VALUES (%L, %L, 1, %L, 'Línea NC 087', 1, 2, 'ITBMS_7', 0.07, %L) RETURNING id::text$q$, T, v_nc, v_serv, v_tax), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('credit_note_lines', 'UPDATE', format($q$UPDATE credit_note_lines SET description = 'Línea NC 087 b' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'description', 'puede_rechazarse');
  PERFORM pg_temp.probar('credit_notes', 'UPDATE', format($q$UPDATE credit_notes SET observations = 'nota 087' WHERE id = %L RETURNING id::text$q$, v_nc), C::text[], NULL, 'observations', 'puede_rechazarse');
  v_id := pg_temp.probar('credit_note_applications', 'INSERT', format(
    $q$INSERT INTO credit_note_applications (tenant_id, credit_note_id, invoice_id, amount_applied, created_by) VALUES (%L, %L, %L, 1, %L) RETURNING id::text$q$,
    T, v_nc, v_fac, v_admin), C::text[], 'aplicar', NULL);
  PERFORM pg_temp.probar('credit_note_applications', 'UPDATE', format($q$UPDATE credit_note_applications SET amount_applied = 2 WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'amount_applied', 'puede_rechazarse');
  PERFORM pg_temp.probar('credit_note_applications', 'DELETE', format($q$DELETE FROM credit_note_applications WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL, 'puede_rechazarse');
  PERFORM pg_temp.probar('credit_note_lines', 'DELETE', format($q$DELETE FROM credit_note_lines WHERE credit_note_id = %L RETURNING id::text$q$, v_nc), C::text[], 'eliminar', NULL, 'puede_rechazarse');
  PERFORM pg_temp.probar('credit_notes', 'DELETE', format($q$DELETE FROM credit_notes WHERE id = %L RETURNING id::text$q$, v_nc), C::text[], 'eliminar', NULL, 'puede_rechazarse');

  -- Cobro, aplicación y la foto de una reversión.
  v_cob := pg_temp.probar('payments', 'INSERT', format(
    $q$INSERT INTO payments (tenant_id, payment_number, client_id, payment_date, amount, method, reference, payment_account_code, created_by)
       VALUES (%L, %L, %L, %L, 3, 'transferencia', 'REF-087', %L, %L) RETURNING id::text$q$, T, 'CO-AUD-' || sfx, v_cli_fac, hoy, v_banco, v_admin), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('payments', 'UPDATE', format($q$UPDATE payments SET notes = 'nota 087' WHERE id = %L RETURNING id::text$q$, v_cob), C::text[], NULL, 'notes');
  v_id := pg_temp.probar('payment_applications', 'INSERT', format(
    $q$INSERT INTO payment_applications (tenant_id, payment_id, invoice_id, amount_applied, created_by) VALUES (%L, %L, %L, 1, %L) RETURNING id::text$q$,
    T, v_cob, v_fac, v_admin), C::text[], 'aplicar', NULL);
  PERFORM pg_temp.probar('payment_applications', 'UPDATE', format($q$UPDATE payment_applications SET amount_applied = 2 WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'amount_applied');
  PERFORM pg_temp.probar('payment_applications', 'DELETE', format($q$DELETE FROM payment_applications WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);
  v_id := pg_temp.probar('payment_reversals', 'INSERT', format(
    $q$INSERT INTO payment_reversals (tenant_id, payment_id, invoice_id, amount_applied, reversal_entry_id, reversed_entry_id, reason, reversed_by)
       VALUES (%L, %L, %L, 1, %L, %L, 'Verificación 087', %L) RETURNING id::text$q$, T, v_cob, v_fac, v_je2, v_je1, v_admin), C::text[], 'reversar', NULL);
  PERFORM pg_temp.probar('payment_reversals', 'UPDATE', format($q$UPDATE payment_reversals SET reason = 'Verificación 087 b' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'reason');
  PERFORM pg_temp.probar('payment_reversals', 'DELETE', format($q$DELETE FROM payment_reversals WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);
  PERFORM pg_temp.probar('payments', 'DELETE', format($q$DELETE FROM payments WHERE id = %L RETURNING id::text$q$, v_cob), C::text[], 'eliminar', NULL, 'puede_rechazarse');

  -- Cotización y su línea.
  v_cot := pg_temp.probar('quotes', 'INSERT', format(
    $q$INSERT INTO quotes (tenant_id, quote_number, client_id, issue_date, valid_until, title, created_by) VALUES (%L, %L, %L, %L, %L, 'Cotización 087', %L) RETURNING id::text$q$,
    T, 'COT-AUD-' || sfx, v_cli, hoy, hoy, v_admin), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('quotes', 'UPDATE', format($q$UPDATE quotes SET notes = 'nota 087' WHERE id = %L RETURNING id::text$q$, v_cot), C::text[], NULL, 'notes');
  v_id := pg_temp.probar('quote_lines', 'INSERT', format(
    $q$INSERT INTO quote_lines (tenant_id, quote_id, line_order, service_id, description, quantity, unit_price, tax_code, tax_rate, tax_code_id, invoice_kind)
       VALUES (%L, %L, 1, %L, 'Línea cot 087', 1, 10, 'ITBMS_7', 0.07, %L, 'HON') RETURNING id::text$q$, T, v_cot, v_serv, v_tax), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('quote_lines', 'UPDATE', format($q$UPDATE quote_lines SET description = 'Línea cot 087 b' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'description');
  PERFORM pg_temp.probar('quote_lines', 'DELETE', format($q$DELETE FROM quote_lines WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);
  PERFORM pg_temp.probar('quotes', 'DELETE (borrador)', format($q$DELETE FROM quotes WHERE id = %L RETURNING id::text$q$, v_cot), C::text[], 'eliminar', NULL, 'puede_rechazarse');

  -- ── CONTABLE: compras ─────────────────────────────────────────────────────
  v_comp := pg_temp.probar('business_expenses', 'INSERT', format(
    $q$INSERT INTO business_expenses (tenant_id, expense_date, description, subtotal, status, supplier_id, created_by)
       VALUES (%L, %L, 'Compra 087', 10, 'pendiente_pago', %L, %L) RETURNING id::text$q$, T, hoy, v_prov, v_admin), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('business_expenses', 'UPDATE', format($q$UPDATE business_expenses SET notes = 'nota 087' WHERE id = %L RETURNING id::text$q$, v_comp), C::text[], NULL, 'notes');
  -- La línea de una COMPRA va sólo a la contable.
  v_id := pg_temp.probar('expense_lines', 'INSERT (compra)', format(
    $q$INSERT INTO expense_lines (tenant_id, business_expense_id, line_order, description, chart_account_code, amount, tax_code_id) VALUES (%L, %L, 1, 'Línea compra 087', %L, 10, %L) RETURNING id::text$q$,
    T, v_comp, v_cta_gasto, v_tax), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('expense_lines', 'UPDATE (compra)', format($q$UPDATE expense_lines SET description = 'Línea compra 087 b' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'description');
  PERFORM pg_temp.probar('expense_lines', 'DELETE (compra)', format($q$DELETE FROM expense_lines WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL);

  v_id := pg_temp.probar('supplier_payments', 'INSERT', format(
    $q$INSERT INTO supplier_payments (tenant_id, business_expense_id, payment_number, payment_date, amount, method, payment_account_code, reference, created_by)
       VALUES (%L, %L, %L, %L, 1, 'transferencia', %L, 'REF-087', %L) RETURNING id::text$q$, T, v_comp, 'PA-AUD-' || sfx, hoy, v_banco, v_admin), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('supplier_payments', 'UPDATE', format($q$UPDATE supplier_payments SET notes = 'nota 087' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'notes');
  PERFORM pg_temp.probar('supplier_payments', 'DELETE', format($q$DELETE FROM supplier_payments WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL, 'puede_rechazarse');

  v_ncp := pg_temp.probar('supplier_credit_notes', 'INSERT', format(
    $q$INSERT INTO supplier_credit_notes (tenant_id, credit_note_number, supplier_id, supplier_document_number, supplier_document_date, issue_date, reason, subtotal_total, tax_total, grand_total, created_by)
       VALUES (%L, %L, %L, %L, %L, %L, 'Verificación 087', 1, 0, 1, %L) RETURNING id::text$q$, T, 'NC-CO-AUD-' || sfx, v_prov, 'DOC-087-' || sfx, hoy, hoy, v_admin), C::text[], 'crear', NULL);
  v_id := pg_temp.probar('supplier_credit_note_lines', 'INSERT', format(
    $q$INSERT INTO supplier_credit_note_lines (tenant_id, credit_note_id, line_order, description, chart_account_code, amount) VALUES (%L, %L, 1, 'Línea NCP 087', %L, 1) RETURNING id::text$q$,
    T, v_ncp, v_cta_gasto), C::text[], 'crear', NULL);
  PERFORM pg_temp.probar('supplier_credit_note_lines', 'UPDATE', format($q$UPDATE supplier_credit_note_lines SET description = 'Línea NCP 087 b' WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'description', 'puede_rechazarse');
  PERFORM pg_temp.probar('supplier_credit_note_lines', 'DELETE', format($q$DELETE FROM supplier_credit_note_lines WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL, 'puede_rechazarse');
  v_id := pg_temp.probar('supplier_credit_note_applications', 'INSERT', format(
    $q$INSERT INTO supplier_credit_note_applications (tenant_id, credit_note_id, business_expense_id, amount_applied, created_by) VALUES (%L, %L, %L, 1, %L) RETURNING id::text$q$,
    T, v_ncp, v_comp, v_admin), C::text[], 'aplicar', NULL);
  PERFORM pg_temp.probar('supplier_credit_note_applications', 'UPDATE', format($q$UPDATE supplier_credit_note_applications SET amount_applied = 0.5 WHERE id = %L RETURNING id::text$q$, v_id), C::text[], NULL, 'amount_applied', 'puede_rechazarse');
  PERFORM pg_temp.probar('supplier_credit_note_applications', 'DELETE', format($q$DELETE FROM supplier_credit_note_applications WHERE id = %L RETURNING id::text$q$, v_id), C::text[], 'eliminar', NULL, 'puede_rechazarse');
  PERFORM pg_temp.probar('supplier_credit_notes', 'UPDATE', format($q$UPDATE supplier_credit_notes SET reason = 'Verificación 087 b' WHERE id = %L RETURNING id::text$q$, v_ncp), C::text[], NULL, 'reason', 'puede_rechazarse');
  PERFORM pg_temp.probar('supplier_credit_notes', 'DELETE', format($q$DELETE FROM supplier_credit_notes WHERE id = %L RETURNING id::text$q$, v_ncp), C::text[], 'eliminar', NULL, 'puede_rechazarse');
  PERFORM pg_temp.probar('business_expenses', 'DELETE', format($q$DELETE FROM business_expenses WHERE id = %L RETURNING id::text$q$, v_comp), C::text[], 'eliminar', NULL, 'puede_rechazarse');

  -- ── CONTABLE: el libro (sólo el alta se audita; editarlo y borrarlo lo rechaza la 023) ──
  v_imp := post_journal_entries_batch(T, 'verificacion-087.xlsx', 'hash-087-' || sfx, 2, jsonb_build_array(jsonb_build_object(
    'group_label', '1', 'first_row', 2, 'transaction_date', hoy, 'description', 'Asiento de la verificación 087', 'reference', 'VER-087',
    'lines', jsonb_build_array(
      jsonb_build_object('account_code', v_cta_gasto, 'debit', 1, 'credit', 0, 'description', 'a'),
      jsonb_build_object('account_code', v_cta_gasto, 'debit', 0, 'credit', 1, 'description', 'b')))), v_admin);
  INSERT INTO ref VALUES ('import', v_imp->>'import_id');
  INSERT INTO ref SELECT 'asiento', entry_id::text FROM journal_import_entries WHERE import_id = (v_imp->>'import_id')::uuid LIMIT 1;
END $$;

-- El alta del libro y del lote no son sentencias sueltas: entran por el RPC. Se
-- comprueban por la fila que dejaron (mismo criterio que pg_temp.probar).
DO $$
DECLARE v_actor uuid := pg_temp.r('actor')::uuid; n int;
BEGIN
  SELECT count(*) INTO n FROM auditoria.bitacora_contable
   WHERE tabla = 'journal_entries' AND registro_id = pg_temp.r('asiento') AND accion = 'contabilizar' AND usuario_id = v_actor;
  INSERT INTO resultados (tabla, op, ok, detalle) VALUES ('journal_entries', 'INSERT (post_journal_entries_batch)', n = 1, 'en contable: ' || n);
  SELECT count(*) INTO n FROM auditoria.bitacora_legal WHERE tabla = 'journal_entries' AND registro_id = pg_temp.r('asiento');
  IF n > 0 THEN INSERT INTO resultados (tabla, op, ok, detalle) VALUES ('journal_entries', 'INSERT', false, 'no debía ir a la legal'); END IF;
  SELECT count(*) INTO n FROM auditoria.bitacora_contable
   WHERE tabla = 'journal_imports' AND registro_id = pg_temp.r('import') AND accion = 'crear' AND usuario_id = v_actor;
  INSERT INTO resultados (tabla, op, ok, detalle) VALUES ('journal_imports', 'INSERT (post_journal_entries_batch)', n = 1, 'en contable: ' || n);
END $$;
SELECT pg_temp.probar('journal_entries', 'UPDATE', format($q$UPDATE journal_entries SET description = 'x' WHERE id = %L RETURNING id::text$q$, pg_temp.r('asiento')), '{contable}', NULL, NULL, 'debe_rechazarse');
SELECT pg_temp.probar('journal_entries', 'DELETE', format($q$DELETE FROM journal_entries WHERE id = %L RETURNING id::text$q$, pg_temp.r('asiento')), '{contable}', NULL, NULL, 'debe_rechazarse');
SELECT pg_temp.probar('journal_imports', 'UPDATE', format($q$UPDATE journal_imports SET file_name = 'otro.xlsx' WHERE id = %L RETURNING id::text$q$, pg_temp.r('import')), '{contable}', NULL, 'file_name', 'puede_rechazarse');
SELECT pg_temp.probar('journal_imports', 'DELETE', format($q$DELETE FROM journal_imports WHERE id = %L RETURNING id::text$q$, pg_temp.r('import')), '{contable}', 'eliminar', NULL, 'puede_rechazarse');

-- El +1 de la serie al emitir NO se registra; un salto sí (arriba).
DO $$
DECLARE c0 bigint := (SELECT coalesce(max(id), 0) FROM auditoria.bitacora_contable); n int;
BEGIN
  UPDATE numbering_sequences SET last_number = last_number + 1
   WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001' AND sequence_type = 'quote';
  SELECT count(*) INTO n FROM auditoria.bitacora_contable WHERE id > c0;
  INSERT INTO resultados (tabla, op, ok, detalle) VALUES ('numbering_sequences', 'UPDATE +1 (ruido, no se registra)', n = 0, 'filas nuevas: ' || n);
END $$;

-- ── Resultado ───────────────────────────────────────────────────────────────
DO $$
DECLARE x record;
BEGIN
  FOR x IN SELECT * FROM resultados ORDER BY n LOOP
    RAISE NOTICE '% % · % · %', CASE WHEN x.ok THEN 'ok   ' ELSE 'FALLA' END, rpad(x.tabla, 34), rpad(x.op, 34), x.detalle;
  END LOOP;
END $$;

DO $$
DECLARE
  v_fallas int := (SELECT count(*) FROM resultados WHERE NOT ok);
  v_sin text;
  v_cadena jsonb;
BEGIN
  -- Las 41 tablas con trigger, cada una con al menos una operación capturada.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_sin
    FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
   WHERE g.tgname = 'trg_auditoria' AND NOT g.tgisinternal
     AND NOT EXISTS (SELECT 1 FROM resultados r WHERE r.tabla = c.relname AND r.ok AND r.detalle NOT LIKE 'rechazada%');
  -- La cadena de las dos bitácoras sigue íntegra con todo lo que se escribió.
  SELECT jsonb_build_object('contable', auditoria.verificar('contable', 'a0000000-0000-0000-0000-000000000001')->'integra',
                            'legal', auditoria.verificar('legal', 'a0000000-0000-0000-0000-000000000001')->'integra') INTO v_cadena;
  RAISE NOTICE 'Operaciones: %, fallas: %, tablas sin captura: %, cadena: %',
    (SELECT count(*) FROM resultados), v_fallas, coalesce(v_sin, 'ninguna'), v_cadena;
  IF v_fallas > 0 OR v_sin IS NOT NULL OR v_cadena <> '{"contable": true, "legal": true}'::jsonb THEN
    RAISE EXCEPTION 'verificación 087: % operación(es) con falla; tablas sin captura: %; cadena: %', v_fallas, coalesce(v_sin, 'ninguna'), v_cadena;
  END IF;
  RAISE NOTICE 'verificación 087 ✅ las 41 tablas capturan en su bitácora';
END $$;

ROLLBACK;
