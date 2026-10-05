-- ============================================================================
-- ENSAYO DE LA VENTANA · datos EQUIVALENTES a los de prueba de producción
-- ============================================================================
-- Para ensayar el paso «Marcar los datos de prueba» (sql/ventana/marcar-datos-de-prueba.sql)
-- sobre una copia de `prod_024`. Crea, con NOMBRES Y RUC FICTICIOS, los mismos
-- NÚMEROS que dio produccion-datos-de-prueba.sql el 05/10/2026:
--   · clientes CLI-066, CLI-069, CLI-070, 0TEST-FE-001, 0TEST-FE-002 y CLI-026;
--   · facturas FAC-HON-000454 … 461 y FAC-REI-000038 (de prueba) y FAC-HON-000463
--     (la real, de 1.07, con cliente 0TEST-FE-002);
--   · el caso ADM-001 de CLI-026 con su gasto de 1.00.
-- Copia filas existentes de la base (esquema de la 024) y cambia lo que importa,
-- en modo réplica (sin triggers), como el resto de la carga del ensayo.
-- Sólo corre en la base `pruebas` del ensayo. Nunca en staging ni en producción.
-- ============================================================================
BEGIN;
SET LOCAL session_replication_role = replica;

DO $$
DECLARE
  T       constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_cols  text;
  v_cli   jsonb;
  v_fac   jsonb;
  v_caso  jsonb;
  v_gasto jsonb;
  v_ids   jsonb := '{}';
  r       record;
  v_id    uuid;
  v_n     int := 0;
BEGIN
  IF current_database() <> 'pruebas' THEN
    RAISE EXCEPTION 'datos-de-prueba-equivalentes.sql sólo corre en la base local `pruebas` (base actual: %).', current_database();
  END IF;

  SELECT to_jsonb(c) INTO v_cli FROM clients c WHERE c.tenant_id = T AND c.client_status = 'active' ORDER BY c.created_at LIMIT 1;
  SELECT to_jsonb(i) INTO v_fac FROM invoices i WHERE i.tenant_id = T AND i.status = 'emitida' ORDER BY i.created_at LIMIT 1;
  SELECT to_jsonb(k) INTO v_caso FROM cases k WHERE k.tenant_id = T ORDER BY k.created_at LIMIT 1;
  SELECT to_jsonb(x) INTO v_gasto FROM expenses x WHERE x.tenant_id = T ORDER BY x.created_at LIMIT 1;

  -- Clientes (ficticios).
  FOR r IN SELECT * FROM (VALUES
      ('CLI-066',      'CLIENTE EQUIVALENTE A CLI-066',      '155000066-2-2026'),
      ('CLI-069',      'CLIENTE EQUIVALENTE A CLI-069',      '155000069-2-2026'),
      ('CLI-070',      'CLIENTE EQUIVALENTE A CLI-070',      '155000070-2-2026'),
      ('0TEST-FE-001', 'CLIENTE EQUIVALENTE A 0TEST-FE-001', '8-000-001'),
      ('0TEST-FE-002', 'CLIENTE EQUIVALENTE A 0TEST-FE-002', '155000002-2-2026'),
      ('CLI-026',      'BUFETE EMISOR (EQUIVALENTE A CLI-026)', '155000026-2-2026')
    ) v(num, nombre, ruc)
  LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND is_generated = 'NEVER';
    v_id := gen_random_uuid();
    EXECUTE format('INSERT INTO clients (%s) SELECT %s FROM jsonb_populate_record(NULL::clients, $1)', v_cols, v_cols)
      USING v_cli || jsonb_build_object('id', v_id, 'client_number', r.num, 'name', r.nombre, 'ruc', r.ruc,
                                        'tax_id', r.ruc, 'email', NULL, 'phone', NULL, 'contact', NULL);
    v_ids := v_ids || jsonb_build_object(r.num, v_id);
  END LOOP;

  -- Facturas. Las de junio, del sandbox (amb 2); la 463, real (amb 1, punto 051).
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invoices' AND is_generated = 'NEVER';
  FOR r IN SELECT * FROM (VALUES
      ('FAC-HON-000454', 'HONORARIOS', 'CLI-066',      '2026-05-20', 1.00, 0.07, NULL::int, 'no_emitida'),
      ('FAC-REI-000038', 'REEMBOLSO',  'CLI-066',      '2026-05-20', 1.00, 0.00, NULL,      'no_emitida'),
      ('FAC-HON-000455', 'HONORARIOS', 'CLI-069',      '2026-05-22', 1.00, 0.07, NULL,      'error'),
      ('FAC-HON-000456', 'HONORARIOS', 'CLI-069',      '2026-05-22', 1.00, 0.07, NULL,      'error'),
      ('FAC-HON-000457', 'HONORARIOS', 'CLI-070',      '2026-05-27', 1.00, 0.07, NULL,      'no_emitida'),
      ('FAC-HON-000459', 'HONORARIOS', '0TEST-FE-001', '2026-06-03', 93.46, 6.54, 2,        'authorized'),
      ('FAC-HON-000460', 'HONORARIOS', '0TEST-FE-002', '2026-06-03', 93.46, 6.54, 2,        'authorized'),
      ('FAC-HON-000461', 'HONORARIOS', '0TEST-FE-001', '2026-06-04', 93.46, 6.54, 2,        'authorized'),
      ('FAC-HON-000463', 'HONORARIOS', '0TEST-FE-002', '2026-07-08', 1.00, 0.07, 1,        'authorized')
    ) v(num, kind, cliente, fecha, base, itbms, amb, fe)
  LOOP
    EXECUTE format('INSERT INTO invoices (%s) SELECT %s FROM jsonb_populate_record(NULL::invoices, $1)', v_cols, v_cols)
      USING v_fac || jsonb_build_object(
        'id', gen_random_uuid(), 'invoice_number', r.num, 'invoice_kind', r.kind,
        'client_id', v_ids->>r.cliente, 'case_id', NULL, 'quote_id', NULL,
        'issue_date', r.fecha, 'due_date', r.fecha, 'status', 'emitida',
        'subtotal_total', r.base, 'tax_total', r.itbms, 'grand_total', r.base + r.itbms, 'amount_paid', 0,
        'notes', NULL, 'fe_estado', r.fe, 'i_amb', r.amb,
        'punto_facturacion', CASE r.amb WHEN 1 THEN '051' WHEN 2 THEN '001' END,
        'dgi_cufe', CASE WHEN r.amb IS NULL THEN NULL
                         ELSE left(rpad('FE01EQUIVALENTE' || r.num, 55, '0'), 55) || r.amb::text || '1234567890' END);
    v_n := v_n + 1;
  END LOOP;

  -- El caso ADM-001 de CLI-026 y su gasto de 1.00 (real). El seed de staging ya
  -- tiene un ADM-001 (de otro cliente ficticio): se lo pasa a CLI-026.
  SELECT id INTO v_id FROM cases WHERE tenant_id = T AND case_code = 'ADM-001';
  IF FOUND THEN
    UPDATE cases SET client_id = (v_ids->>'CLI-026')::uuid WHERE id = v_id;
  ELSE
    v_id := gen_random_uuid();
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cases' AND is_generated = 'NEVER';
    EXECUTE format('INSERT INTO cases (%s) SELECT %s FROM jsonb_populate_record(NULL::cases, $1)', v_cols, v_cols)
      USING v_caso || jsonb_build_object('id', v_id, 'client_id', v_ids->>'CLI-026', 'case_code', 'ADM-001',
                                         'case_number', 900001, 'description', 'Caso administrativo (equivalente)');
  END IF;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expenses' AND is_generated = 'NEVER';
  EXECUTE format('INSERT INTO expenses (%s) SELECT %s FROM jsonb_populate_record(NULL::expenses, $1)', v_cols, v_cols)
    USING v_gasto || jsonb_build_object('id', gen_random_uuid(), 'case_id', v_id, 'amount', 1.00, 'concept', 'Gasto administrativo (equivalente)');

  RAISE NOTICE 'equivalentes: 6 clientes, % facturas, caso ADM-001 con gasto de 1.00', v_n;
END $$;

COMMIT;
