-- ============================================================================
-- 089 · Bitácoras: corrección de auditoria.documento_de (tareas, comentarios y
--       cobros del caso)
-- ============================================================================
-- Encontrado el 03/10/2026 en el recorrido del punto 7, con la 087 recién
-- aplicada en staging: crear un comentario respondía 500 con
--   «COALESCE types text and integer cannot be matched».
-- La rama de `tasks`, `comments` y `client_payments` hacía
--   coalesce(case_code, case_number)
-- y `cases.case_number` es entero. PL/pgSQL prepara cada consulta recién al
-- ejecutarla, por eso la simulación de la 087 (que tocó clientes y casos) no
-- la vio. Como la captura falla cerrado, mientras esto no se aplique en staging
-- NO se pueden crear ni editar tareas, comentarios ni cobros del caso.
--
-- Sondeo de las 41 tablas con trigger (documento_de, accion_de y diferencias
-- sobre una fila real de cada una): ésta es la única rama que falla.
--
-- Sólo reemplaza la función. No toca filas, ni las bitácoras, ni el libro.
-- La 087 ya está aplicada en staging y no se edita: en producción van las dos,
-- en orden (087 y después 089).
-- 🛡️ Sólo staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION auditoria.documento_de(p_tabla text, r jsonb)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v text;
  uid uuid;
BEGIN
  CASE p_tabla
    WHEN 'invoices' THEN RETURN coalesce(r->>'invoice_number', 'Borrador');
    WHEN 'credit_notes', 'supplier_credit_notes' THEN RETURN r->>'credit_note_number';
    WHEN 'payments', 'supplier_payments' THEN RETURN r->>'payment_number';
    WHEN 'business_expenses', 'expenses' THEN RETURN r->>'purchase_number';
    WHEN 'quotes' THEN RETURN r->>'quote_number';
    WHEN 'journal_entries' THEN RETURN coalesce(r->>'reference', 'Asiento ' || (r->>'entry_number'));
    WHEN 'clients' THEN RETURN r->>'client_number';
    WHEN 'cases' THEN RETURN coalesce(r->>'case_code', r->>'case_number');
    WHEN 'suppliers' THEN RETURN r->>'supplier_number';
    WHEN 'chart_of_accounts', 'tax_codes', 'services_catalog' THEN RETURN r->>'code';
    WHEN 'accounting_periods' THEN RETURN (r->>'year') || '-' || lpad(r->>'month', 2, '0');
    WHEN 'users' THEN RETURN r->>'email';
    WHEN 'documents', 'journal_imports' THEN RETURN r->>'file_name';
    WHEN 'numbering_sequences' THEN RETURN r->>'sequence_type';
    WHEN 'cat_classifications', 'cat_institutions', 'cat_statuses', 'cat_team' THEN RETURN r->>'name';
    WHEN 'tax_payments' THEN RETURN r->>'reference_number';
    WHEN 'finanzas_parametros' THEN RETURN 'Parámetros';
    WHEN 'quote_terms_template' THEN RETURN 'Plantilla de términos';
    ELSE NULL;
  END CASE;

  -- Tablas hijas: el número del documento padre (si el padre ya no está, nada).
  IF p_tabla IN ('invoice_lines') OR (p_tabla IN ('fe_emisiones', 'fe_anulaciones') AND r->>'invoice_id' IS NOT NULL) THEN
    SELECT invoice_number INTO v FROM invoices WHERE id = (r->>'invoice_id')::uuid;
  ELSIF p_tabla IN ('credit_note_lines', 'credit_note_applications', 'fe_emisiones', 'fe_anulaciones') THEN
    SELECT credit_note_number INTO v FROM credit_notes WHERE id = (r->>'credit_note_id')::uuid;
  ELSIF p_tabla IN ('payment_applications', 'payment_reversals') THEN
    SELECT payment_number INTO v FROM payments WHERE id = (r->>'payment_id')::uuid;
  ELSIF p_tabla IN ('supplier_credit_note_lines', 'supplier_credit_note_applications') THEN
    SELECT credit_note_number INTO v FROM supplier_credit_notes WHERE id = (r->>'credit_note_id')::uuid;
  ELSIF p_tabla = 'quote_lines' THEN
    SELECT quote_number INTO v FROM quotes WHERE id = (r->>'quote_id')::uuid;
  ELSIF p_tabla = 'expense_lines' THEN
    IF r->>'expense_id' IS NOT NULL THEN
      SELECT purchase_number INTO v FROM expenses WHERE id = (r->>'expense_id')::uuid;
    ELSE
      SELECT purchase_number INTO v FROM business_expenses WHERE id = (r->>'business_expense_id')::uuid;
    END IF;
  ELSIF p_tabla IN ('tasks', 'comments', 'client_payments') THEN
    -- 089: case_number es entero; sin el ::text, COALESCE no compila.
    SELECT coalesce(case_code, case_number::text) INTO v FROM cases WHERE id = (r->>'case_id')::uuid;
  END IF;
  RETURN v;
END $$;

-- ── Verificación: las tres tablas de la rama corregida, con un caso real ────
DO $$
DECLARE
  v_caso uuid := (SELECT id FROM public.cases ORDER BY created_at LIMIT 1);
  v_doc  text;
  t      text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks', 'comments', 'client_payments'] LOOP
    v_doc := auditoria.documento_de(t, jsonb_build_object('case_id', v_caso));
    IF v_caso IS NOT NULL AND v_doc IS NULL THEN
      RAISE EXCEPTION '089: documento_de(%) no devolvió el número del caso', t;
    END IF;
  END LOOP;
  RAISE NOTICE '089 ✅ documento_de: tareas, comentarios y cobros del caso devuelven el número del caso (%)', coalesce(v_doc, 'sin casos');
END $$;

COMMIT;
