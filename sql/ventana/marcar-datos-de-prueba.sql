-- ============================================================================
-- VENTANA DEL BLOQUE 1 · paso de datos «Marcar los datos de prueba»
-- ============================================================================
-- Va en PRODUCCIÓN, congelado, después de la 094 (runbook ventana-bloque-1.md §2).
-- Lo corre Oliver en el SQL Editor, con la pausa obligatoria de CLAUDE.md
-- (cambio de datos), DESPUÉS de leer sql/verificacion/produccion-datos-de-prueba-a-marcar.sql.
--
-- Marca, SIN DELETE, lo que resultó de prueba en produccion-datos-de-prueba.sql (05/10/2026):
--   · clientes CLI-066, CLI-069, CLI-070, 0TEST-FE-001, 0TEST-FE-002;
--   · facturas FAC-HON-000454, FAC-REI-000038, FAC-HON-000455, FAC-HON-000456,
--     FAC-HON-000457, FAC-HON-000459, FAC-HON-000460, FAC-HON-000461.
-- Se quedan REALES, y el post-check lo exige: FAC-HON-000463 (real ante la DGI,
-- aunque su cliente sea 0TEST-FE-002), CLI-026 y el gasto ADM-001 de 1.00.
-- El usuario contador.test no se toca acá (paso «Accesos», al final del runbook).
--
-- ABORTA sin cambiar nada si: falta la 094; un número de la lista no existe o
-- está repetido; un cliente de prueba tiene otro documento que no está en la
-- lista (cobro, NC, otra factura, cobro o gasto del caso); o una factura de la
-- lista tiene asiento. Re-ejecutable: lo ya marcado no se vuelve a tocar.
-- La lista está repetida en produccion-datos-de-prueba-a-marcar.sql.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  c_clientes constant text[] := ARRAY['CLI-066', 'CLI-069', 'CLI-070', '0TEST-FE-001', '0TEST-FE-002'];
  c_facturas constant text[] := ARRAY['FAC-HON-000454', 'FAC-REI-000038', 'FAC-HON-000455', 'FAC-HON-000456',
                                      'FAC-HON-000457', 'FAC-HON-000459', 'FAC-HON-000460', 'FAC-HON-000461'];
  c_factura_real constant text := 'FAC-HON-000463';
  c_cliente_real constant text := 'CLI-026';
  c_motivo_cliente constant text :=
    'Cliente de prueba (produccion-datos-de-prueba.sql, 05/10/2026). Sus documentos NUEVOS nacen de prueba. '
    'Excepción: FAC-HON-000463 de 0TEST-FE-002 es real ante la DGI y sigue contando.';
  c_motivo_factura constant text :=
    'Factura de prueba (produccion-datos-de-prueba.sql, 05/10/2026), marcada en la ventana del Bloque 1.';
  v_cli   uuid[];
  v_txt   text;
  v_n     int;
  v_cm    int;
  v_fm    int;
BEGIN
  -- 0. La 094.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'es_de_prueba') THEN
    RAISE EXCEPTION 'Falta la 094 (documentos de prueba). No se marcó nada.';
  END IF;

  -- 1. Todo lo de la lista existe, una sola vez.
  SELECT string_agg(r, ', ') INTO v_txt FROM (
    SELECT x AS r FROM unnest(c_clientes || c_cliente_real) x
     WHERE (SELECT count(*) FROM clients WHERE client_number = x) <> 1
    UNION ALL
    SELECT x FROM unnest(c_facturas || c_factura_real) x
     WHERE (SELECT count(*) FROM invoices WHERE invoice_number = x) <> 1
  ) f;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'No están (o están repetidos): %. No se marcó nada.', v_txt;
  END IF;
  SELECT array_agg(id) INTO v_cli FROM clients WHERE client_number = ANY (c_clientes);

  -- 2. Nada sin decidir: todo documento de un cliente de prueba está en la lista.
  SELECT string_agg(r, '; ') INTO v_txt FROM (
    SELECT 'factura ' || invoice_number AS r FROM invoices
     WHERE client_id = ANY (v_cli) AND NOT (invoice_number = ANY (c_facturas || c_factura_real))
    UNION ALL SELECT 'NC ' || credit_note_number FROM credit_notes WHERE client_id = ANY (v_cli)
    UNION ALL SELECT 'cobro ' || coalesce(payment_number, reference, id::text) FROM payments WHERE client_id = ANY (v_cli)
    UNION ALL SELECT 'cobro del caso ' || k.case_code FROM client_payments cp JOIN cases k ON k.id = cp.case_id WHERE k.client_id = ANY (v_cli)
    UNION ALL SELECT 'gasto del caso ' || k.case_code || ' (' || x.amount || ')' FROM expenses x JOIN cases k ON k.id = x.case_id WHERE k.client_id = ANY (v_cli)
  ) f;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'Hay documentos de clientes de prueba que no están en la lista: %. Decidir y agregarlos antes. No se marcó nada.', v_txt;
  END IF;

  -- 3. Ninguna factura de la lista con asiento (la 094 lo rechazaría igual; acá con la lista entera).
  SELECT string_agg(i.invoice_number, ', ') INTO v_txt
    FROM invoices i
   WHERE i.invoice_number = ANY (c_facturas)
     AND EXISTS (SELECT 1 FROM journal_entries j WHERE j.source_id = i.id);
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'Facturas con asiento en el libro: %. Se corrigen en el libro, no se marcan. No se marcó nada.', v_txt;
  END IF;

  -- 4. Marcar. Primero las facturas (los clientes marcados no las tocan: la marca
  --    del cliente sólo vale para lo nuevo), después los clientes.
  UPDATE invoices SET de_prueba = true, de_prueba_motivo = c_motivo_factura
   WHERE invoice_number = ANY (c_facturas) AND NOT de_prueba;
  GET DIAGNOSTICS v_fm = ROW_COUNT;
  UPDATE clients SET es_de_prueba = true, es_de_prueba_motivo = c_motivo_cliente, es_de_prueba_en = now()
   WHERE client_number = ANY (c_clientes) AND NOT es_de_prueba;
  GET DIAGNOSTICS v_cm = ROW_COUNT;

  -- 5. Post-check: lo marcado, marcado; lo real, sin marca.
  SELECT count(*) INTO v_n FROM invoices WHERE invoice_number = ANY (c_facturas) AND de_prueba;
  IF v_n <> 8 THEN RAISE EXCEPTION 'Post-check: % de 8 facturas marcadas.', v_n; END IF;
  SELECT count(*) INTO v_n FROM clients WHERE client_number = ANY (c_clientes) AND es_de_prueba;
  IF v_n <> 5 THEN RAISE EXCEPTION 'Post-check: % de 5 clientes marcados.', v_n; END IF;
  IF (SELECT de_prueba FROM invoices WHERE invoice_number = c_factura_real) THEN
    RAISE EXCEPTION 'Post-check: % quedó de prueba y es real.', c_factura_real;
  END IF;
  IF (SELECT es_de_prueba FROM clients WHERE client_number = c_cliente_real) THEN
    RAISE EXCEPTION 'Post-check: % quedó de prueba y es real.', c_cliente_real;
  END IF;
  IF EXISTS (SELECT 1 FROM expenses x JOIN cases k ON k.id = x.case_id
              WHERE k.case_code = 'ADM-001' AND x.amount = 1.00 AND x.de_prueba) THEN
    RAISE EXCEPTION 'Post-check: el gasto ADM-001 de 1.00 quedó de prueba y es real.';
  END IF;

  RAISE NOTICE 'Marcadas ahora: % facturas y % clientes (8 y 5 en total). Reales sin marca: %, % y el gasto ADM-001 de 1.00.',
    v_fm, v_cm, c_factura_real, c_cliente_real;
END $$;

COMMIT;
