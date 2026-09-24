-- ============================================================================
-- VERIFICACIÓN de la 063 — la anulación bloquea sólo por NC VIGENTES
-- 🛡️ TODO DENTRO DE UN ROLLBACK. No deja facturas, asientos ni NC.
--
--   node scripts/run-sql.mjs sql/tests/verificacion-063-anular-con-nc-reversada.sql
--
-- Los tres casos del pedido, cada uno sobre su propia factura:
--
--   [A] factura con una NC VIGENTE               → bloqueada
--   [B] factura con su ÚNICA NC REVERSADA        → deja pasar (sigue la matriz)
--   [C] factura con una VIGENTE y otra REVERSADA → bloqueada, por la vigente
--
-- 🔴 Lo que se comprueba en [B] no es que la anulación termine bien —eso
--    depende del mes, de los pagos y del espejo—, sino que **ya no rebote con
--    el mensaje de la nota de crédito**. Ése es el cambio de la 063.
--
-- El escenario se CONSTRUYE acá adentro. La primera versión buscaba facturas
-- candidatas en staging y encontró CERO: de las 8 emitidas, ninguna tenía a la
-- vez asiento y ninguna nota de crédito. Un test que depende de lo que quedó
-- de otras pruebas no se corre cuando hace falta.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_tenant   uuid := 'a0000000-0000-0000-0000-000000000001';
  v_cliente  uuid;
  v_err      text;
  v_res      jsonb;
  v_lineas   jsonb;
  v_caso     text;
  v_factura  uuid;
  v_ok       boolean;
BEGIN
  SELECT id INTO v_cliente FROM public.clients
   WHERE tenant_id = v_tenant AND client_status = 'active' ORDER BY created_at LIMIT 1;
  IF v_cliente IS NULL THEN
    RAISE NOTICE '⚠️ No hay cliente activo en staging: no se verifica.';
    RETURN;
  END IF;

  CREATE TEMP TABLE _casos (caso text, factura uuid, asiento uuid) ON COMMIT DROP;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Montaje: tres facturas de B/. 100.00, cada una con su asiento de ingreso.
  -- ══════════════════════════════════════════════════════════════════════════
  DECLARE
    v_f uuid; v_je uuid; c text;
  BEGIN
    FOREACH c IN ARRAY ARRAY['A', 'B', 'C'] LOOP
      v_f := gen_random_uuid();
      INSERT INTO public.invoices
        (id, tenant_id, invoice_number, invoice_kind, client_id, issue_date, due_date,
         status, currency, subtotal_total, tax_total, grand_total)
      VALUES
        (v_f, v_tenant, 'FAC-T063-' || c, 'HONORARIOS', v_cliente, current_date, current_date,
         'emitida', 'USD', 100.00, 0.00, 100.00);

      v_je := public.post_journal_entry(
        v_tenant, current_date, 'FAC-T063-' || c, 'factura',
        jsonb_build_array(
          jsonb_build_object('account_code', '110001', 'debit', 100.00, 'credit', 0),
          jsonb_build_object('account_code', '400001', 'debit', 0, 'credit', 100.00)),
        v_f, NULL, NULL, NULL, NULL, NULL, 'FAC-T063-' || c, NULL);

      INSERT INTO _casos VALUES (c, v_f, v_je);
    END LOOP;
    RAISE NOTICE 'Montadas 3 facturas de B/. 100.00 con su asiento.';
  END;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Las notas de crédito de cada caso.
  -- ══════════════════════════════════════════════════════════════════════════
  DECLARE
    v_nc uuid; v_je uuid; v_esp jsonb; c text; i int;
  BEGIN
    -- Helper: crea una NC de 1.00 con asiento propio sobre la factura del caso,
    -- y la reversa si `p_reversar`. Inline porque plpgsql no tiene locales.
    FOREACH c IN ARRAY ARRAY['A', 'B', 'C'] LOOP
      SELECT factura INTO v_factura FROM _casos WHERE caso = c;

      -- [A] 1 vigente · [B] 1 reversada · [C] 1 reversada + 1 vigente
      FOR i IN 1..(CASE WHEN c = 'C' THEN 2 ELSE 1 END) LOOP
        v_nc := gen_random_uuid();
        INSERT INTO public.credit_notes
          (id, tenant_id, credit_note_number, invoice_id, client_id, issue_date, reason,
           status, subtotal_total, tax_total, grand_total)
        VALUES
          (v_nc, v_tenant, 'NC-T063-' || c || i, v_factura, v_cliente, current_date,
           'Prueba 063', 'emitida', 1.00, 0.00, 1.00);

        v_je := public.post_journal_entry(
          v_tenant, current_date, 'NC-T063-' || c || i, 'nota_credito',
          jsonb_build_array(
            jsonb_build_object('account_code', '400001', 'debit', 1.00, 'credit', 0),
            jsonb_build_object('account_code', '110001', 'debit', 0, 'credit', 1.00)),
          v_nc, NULL, NULL, NULL, NULL, NULL, 'NC-T063-' || c || i, NULL);

        -- Se reversa en B (su única NC) y en la PRIMERA de C.
        IF c = 'B' OR (c = 'C' AND i = 1) THEN
          SELECT jsonb_agg(jsonb_build_object(
                   'account_code', ch.code, 'debit', l.credit, 'credit', l.debit,
                   'description', 'Reversión') ORDER BY l.line_order)
            INTO v_esp
            FROM public.journal_entry_lines l
            JOIN public.chart_of_accounts ch ON ch.id = l.account_id
           WHERE l.entry_id = v_je;
          PERFORM public.reverse_credit_note(
            v_tenant, v_nc, 'Prueba 063 — reversión', current_date,
            'Reversión NC-T063-' || c || i, v_esp, NULL);
        END IF;
      END LOOP;
    END LOOP;
    RAISE NOTICE 'NC montadas: [A] 1 vigente · [B] 1 reversada · [C] 1 reversada + 1 vigente';
  END;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Las tres llamadas.
  -- ══════════════════════════════════════════════════════════════════════════
  FOR v_caso, v_factura IN SELECT caso, factura FROM _casos ORDER BY caso LOOP
    SELECT jsonb_agg(jsonb_build_object(
             'account_code', ch.code, 'debit', l.credit, 'credit', l.debit,
             'description', 'Reversión') ORDER BY l.line_order)
      INTO v_lineas
      FROM public.journal_entries je
      JOIN public.journal_entry_lines l ON l.entry_id = je.id
      JOIN public.chart_of_accounts ch ON ch.id = l.account_id
     WHERE je.source_type = 'factura' AND je.source_id = v_factura;

    BEGIN
      v_res := public.cancel_invoice_with_reversal(
        v_tenant, v_factura, 'Prueba 063 — anulación de verificación', NULL,
        current_date, 'Reversión de prueba 063', v_lineas, NULL);
      v_err := NULL;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    END;

    IF v_caso = 'B' THEN
      -- Pasa si NO rebotó por la nota de crédito. Rebotar por otra cosa (mes,
      -- pagos, espejo) sería otro problema y se nombra.
      v_ok := v_err IS NULL OR position('nota de crédito' IN v_err) = 0;
      RAISE NOTICE '[B] única NC REVERSADA ......... % ya no bloquea por la NC%',
        CASE WHEN v_ok THEN '✅' ELSE '❌' END,
        CASE WHEN v_err IS NULL THEN ' (anuló)' ELSE ' → ' || left(v_err, 70) END;
    ELSE
      v_ok := v_err IS NOT NULL AND position('vigente en el libro' IN v_err) > 0;
      RAISE NOTICE '[%] NC VIGENTE .................. % %',
        v_caso,
        CASE WHEN v_ok THEN '✅ BLOQUEADA:' ELSE '❌ DEBÍA BLOQUEAR:' END,
        coalesce(left(v_err, 78), '(ninguno: anuló)');
    END IF;
  END LOOP;
END $$;

ROLLBACK;
