-- ============================================================================
-- 087 · Bitácoras de auditoría (2/2): captura por triggers
-- ============================================================================
-- Requiere la 086. Una función genérica, `auditoria.registrar()`, y un trigger
-- AFTER INSERT/UPDATE/DELETE por tabla que dice a qué bitácora va:
--
--   'contable'  todo Finanzas (b.1 de la propuesta, más `tax_payments`).
--   'legal'     casos, documentos, tareas, comentarios, catálogos y cobros del caso.
--   'mixto'     las cuatro tablas de b.2 (opción 1, aprobada el 03/10):
--               · clients: legal todo; contable SOLO los campos fiscales.
--               · expenses: legal todo; contable SOLO lo que entra al asiento o lo
--                 registra, reversa o paga (nunca la descripción ni el caso).
--               · expense_lines: de un gasto de trámite, a las dos; de una compra,
--                 sólo a la contable.
--               · users: legal todo; contable si el cambio toca quién entra a
--                 Finanzas (alta, baja, rol o activo de un admin, abogada o contador).
--               Las dos filas llevan el MISMO evento_id.
--
-- Qué se guarda en `cambios`: solo lo que cambió, {"campo": [antes, después]}. Se
-- omiten las columnas de sello (`created_at`, `updated_at`, `tenant_id`, `id`), las
-- de la cadena del libro y los payloads completos del PAC (ya viven en
-- fe_emisiones / fe_anulaciones y pesarían más que todo lo demás junto).
--
-- Ruido que NO se registra: un UPDATE sin cambios reales, y el +1 de
-- `numbering_sequences.last_number` al emitir (eso ya queda en el documento). Un
-- salto o un retroceso de la serie SÍ se registra: es lo que hay que ver.
--
-- `origen`: «usuario» si el cambio lo hizo una sentencia de la app o de un RPC;
-- «sistema» si lo hizo otro trigger (p. ej. T7a recalculando el saldo de una
-- factura al registrar un cobro), o si no hay usuario identificado.
--
-- 🔴 FALLA CERRADO: si la bitácora no se puede escribir, la operación se deshace.
--    Un cambio sin rastro es justo lo que la bitácora existe para impedir.
-- El libro (journal_entries) sólo se audita al INSERTAR: es inmutable. Sus
-- líneas no se auditan (ya están en el libro). Esta migración no hace UPDATE ni
-- DELETE sobre ninguna tabla.
-- 🛡️ Sólo staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

-- ── 1. El número legible del documento ─────────────────────────────────────
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
    SELECT coalesce(case_code, case_number) INTO v FROM cases WHERE id = (r->>'case_id')::uuid;
  END IF;
  RETURN v;
END $$;

-- ── 2. La acción ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auditoria.accion_de(p_tabla text, p_op text, o jsonb, n jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_op = 'INSERT' THEN
    RETURN CASE
      WHEN p_tabla = 'journal_entries' THEN
        CASE n->>'source_type' WHEN 'reversion' THEN 'reversar' WHEN 'cierre' THEN 'cierre_anual'
                               WHEN 'apertura' THEN 'apertura' ELSE 'contabilizar' END
      WHEN p_tabla = 'fe_emisiones' THEN 'enviar_dgi'
      WHEN p_tabla = 'fe_anulaciones' THEN 'anular_dgi'
      WHEN p_tabla = 'payment_reversals' THEN 'reversar'
      WHEN p_tabla IN ('payment_applications', 'credit_note_applications', 'supplier_credit_note_applications') THEN 'aplicar'
      ELSE 'crear' END;
  END IF;
  IF p_op = 'DELETE' THEN
    RETURN 'eliminar';
  END IF;

  IF p_tabla = 'accounting_periods' AND o->>'status' IS DISTINCT FROM n->>'status' THEN
    RETURN CASE n->>'status' WHEN 'cerrado' THEN 'cerrar' ELSE 'reabrir' END;
  END IF;
  IF p_tabla = 'users' THEN
    IF o->>'role' IS DISTINCT FROM n->>'role' THEN RETURN 'cambiar_rol'; END IF;
    IF o->>'active' IS DISTINCT FROM n->>'active' THEN
      RETURN CASE WHEN (n->>'active')::boolean THEN 'activar' ELSE 'desactivar' END;
    END IF;
  END IF;
  IF p_tabla = 'expenses' AND o->>'posted_entry_id' IS NULL AND n->>'posted_entry_id' IS NOT NULL THEN
    RETURN 'registrar_en_libro';
  END IF;
  IF o->>'fe_estado' IS DISTINCT FROM n->>'fe_estado' THEN
    RETURN CASE n->>'fe_estado' WHEN 'canceled' THEN 'anular_dgi' WHEN 'interna' THEN 'marcar_interna'
                                WHEN 'no_emitida' THEN 'editar' ELSE 'enviar_dgi' END;
  END IF;
  IF o->>'dgi_cufe' IS NULL AND n->>'dgi_cufe' IS NOT NULL AND n->>'dgi_cufe_origen' = 'portal_050' THEN
    RETURN 'cargar_cufe';
  END IF;
  IF o->>'status' IS DISTINCT FROM n->>'status' THEN
    RETURN CASE
      WHEN o->>'status' = 'borrador' AND n->>'status' = 'emitida' THEN 'emitir'
      WHEN n->>'status' IN ('anulada', 'anulado') AND p_tabla = 'invoices' THEN 'anular'
      WHEN n->>'status' IN ('anulada', 'anulado') THEN 'reversar'
      WHEN n->>'status' LIKE 'cancelada%' THEN 'cancelar'
      WHEN n->>'status' = 'enviada' THEN 'enviar'
      WHEN n->>'status' = 'aceptada' THEN 'aceptar'
      WHEN n->>'status' = 'rechazada' THEN 'rechazar'
      WHEN n->>'status' = 'cumplida' THEN 'cumplir'
      ELSE 'editar' END;
  END IF;
  IF p_tabla = 'journal_imports' AND o->>'reversed_at' IS NULL AND n->>'reversed_at' IS NOT NULL THEN
    RETURN 'reversar';
  END IF;
  RETURN 'editar';
END $$;

-- ── 3. Los cambios ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auditoria.diferencias(o jsonb, n jsonb, p_solo text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT coalesce(jsonb_object_agg(k, jsonb_build_array(o->k, n->k)), '{}'::jsonb)
    FROM (SELECT DISTINCT k FROM (
            SELECT jsonb_object_keys(coalesce(o, '{}'::jsonb)) AS k
            UNION SELECT jsonb_object_keys(coalesce(n, '{}'::jsonb))) x) keys
   WHERE k <> ALL (ARRAY['id', 'tenant_id', 'created_at', 'updated_at', 'request_payload', 'response_payload',
                         'content_hash', 'prev_hash', 'hash'])
     AND (p_solo IS NULL OR k = ANY (p_solo))
     AND (o->k) IS DISTINCT FROM (n->k)
     AND NOT (o IS NULL AND n->k = 'null'::jsonb)      -- al crear: sin las columnas vacías
     AND NOT (n IS NULL AND o->k = 'null'::jsonb)      -- al borrar: igual
$$;

-- ── 4. El trigger genérico ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auditoria.registrar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_modo    text := TG_ARGV[0];
  o         jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  n         jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  r         jsonb := coalesce(n, o);
  v_tenant  uuid := (r->>'tenant_id')::uuid;
  v_evento  uuid := gen_random_uuid();
  v_origen  text := CASE WHEN pg_trigger_depth() > 1 THEN 'sistema' ELSE 'usuario' END;
  v_todo    jsonb;
  v_accion  text;
  v_doc     text;
  v_reg     text := coalesce(r->>'id', r->>'tenant_id');
  v_contable jsonb;
  v_legal   boolean := v_modo IN ('legal', 'mixto');
  v_fin     text[] := ARRAY['admin', 'abogada', 'contador'];
BEGIN
  v_todo := auditoria.diferencias(o, n);
  IF TG_OP = 'UPDATE' AND v_todo = '{}'::jsonb THEN
    RETURN NULL;                                             -- nada cambió
  END IF;
  IF TG_TABLE_NAME = 'numbering_sequences' AND TG_OP = 'UPDATE'
     AND v_todo ?& ARRAY['last_number'] AND (SELECT count(*) FROM jsonb_object_keys(v_todo)) = 1
     AND (n->>'last_number')::bigint = (o->>'last_number')::bigint + 1 THEN
    RETURN NULL;                                             -- el +1 de cada emisión
  END IF;

  v_accion := auditoria.accion_de(TG_TABLE_NAME, TG_OP, o, n);
  v_doc := auditoria.documento_de(TG_TABLE_NAME, r);

  IF v_modo = 'contable' THEN
    v_contable := v_todo;
  ELSIF TG_TABLE_NAME = 'clients' THEN
    v_contable := auditoria.diferencias(o, n, ARRAY['name', 'ruc', 'tax_id', 'digito_verificador', 'tax_id_type',
      'client_type', 'tipo_receptor_fe', 'client_status', 'billing_address', 'codigo_ubicacion', 'corregimiento',
      'distrito', 'provincia', 'id_extranjero', 'pais_receptor']);
  ELSIF TG_TABLE_NAME = 'expenses' THEN
    v_contable := auditoria.diferencias(o, n, ARRAY['amount', 'date', 'accounting_date', 'due_date', 'supplier_id',
      'supplier_invoice_number', 'purchase_number', 'posted_entry_id', 'status', 'amount_paid', 'expense_type',
      'receipt_filename']);
  ELSIF TG_TABLE_NAME = 'expense_lines' THEN
    v_contable := v_todo;
    v_legal := r->>'expense_id' IS NOT NULL;                 -- la línea de una compra es sólo contable
  ELSIF TG_TABLE_NAME = 'users' THEN
    IF (coalesce(o->>'role', '') = ANY (v_fin) OR coalesce(n->>'role', '') = ANY (v_fin))
       AND (TG_OP <> 'UPDATE' OR v_todo ?| ARRAY['role', 'active']) THEN
      v_contable := auditoria.diferencias(o, n, ARRAY['role', 'active', 'full_name', 'email']);
    END IF;
  END IF;

  IF v_legal THEN
    PERFORM auditoria.escribir('legal', v_evento, v_tenant, v_accion, TG_TABLE_NAME, v_reg, v_doc, v_todo, v_origen);
  END IF;
  IF v_contable IS NOT NULL AND (v_contable <> '{}'::jsonb OR TG_OP <> 'UPDATE') THEN
    PERFORM auditoria.escribir('contable', v_evento, v_tenant, v_accion, TG_TABLE_NAME, v_reg, v_doc, v_contable, v_origen);
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auditoria FROM PUBLIC, anon, authenticated, service_role;

-- ── 5. Los triggers ────────────────────────────────────────────────────────
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      -- Finanzas
      ('invoices', 'contable'), ('invoice_lines', 'contable'), ('credit_notes', 'contable'),
      ('credit_note_lines', 'contable'), ('credit_note_applications', 'contable'),
      ('fe_emisiones', 'contable'), ('fe_anulaciones', 'contable'),
      ('payments', 'contable'), ('payment_applications', 'contable'), ('payment_reversals', 'contable'),
      ('business_expenses', 'contable'), ('supplier_payments', 'contable'),
      ('supplier_credit_notes', 'contable'), ('supplier_credit_note_lines', 'contable'),
      ('supplier_credit_note_applications', 'contable'),
      ('journal_imports', 'contable'), ('accounting_periods', 'contable'),
      ('chart_of_accounts', 'contable'), ('tax_codes', 'contable'), ('numbering_sequences', 'contable'),
      ('services_catalog', 'contable'), ('finanzas_parametros', 'contable'),
      ('quotes', 'contable'), ('quote_lines', 'contable'), ('quote_terms_template', 'contable'),
      ('suppliers', 'contable'), ('tax_payments', 'contable'),
      -- Legal
      ('cases', 'legal'), ('documents', 'legal'), ('tasks', 'legal'), ('comments', 'legal'),
      ('cat_classifications', 'legal'), ('cat_institutions', 'legal'), ('cat_statuses', 'legal'),
      ('cat_team', 'legal'), ('client_payments', 'legal'),
      -- Las dos (b.2)
      ('clients', 'mixto'), ('expenses', 'mixto'), ('expense_lines', 'mixto'), ('users', 'mixto')
    ) AS v(tabla, modo)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria ON public.%I', t.tabla);
    EXECUTE format('CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION auditoria.registrar(%L)', t.tabla, t.modo);
  END LOOP;

  -- El libro: sólo el alta (es inmutable).
  DROP TRIGGER IF EXISTS trg_auditoria ON public.journal_entries;
  CREATE TRIGGER trg_auditoria AFTER INSERT ON public.journal_entries
    FOR EACH ROW EXECUTE FUNCTION auditoria.registrar('contable');
END $$;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM pg_trigger WHERE tgname = 'trg_auditoria' AND NOT tgisinternal;
  IF v <> 41 THEN
    RAISE EXCEPTION '087: se esperaban 41 triggers de auditoría y hay %', v;
  END IF;
  IF auditoria.diferencias('{"a":1,"b":2,"updated_at":"x"}', '{"a":1,"b":3,"updated_at":"y"}') <> '{"b":[2,3]}'::jsonb THEN
    RAISE EXCEPTION '087: diferencias() no calcula sólo lo que cambió';
  END IF;
  IF auditoria.accion_de('invoices', 'UPDATE', '{"status":"borrador"}', '{"status":"emitida"}') <> 'emitir'
     OR auditoria.accion_de('accounting_periods', 'UPDATE', '{"status":"abierto"}', '{"status":"cerrado"}') <> 'cerrar'
     OR auditoria.accion_de('payments', 'UPDATE', '{"status":"registrado"}', '{"status":"anulado"}') <> 'reversar' THEN
    RAISE EXCEPTION '087: accion_de() no reconoce las transiciones';
  END IF;
  RAISE NOTICE '087 ✅ 41 tablas con captura en su bitácora';
END $$;

COMMIT;
