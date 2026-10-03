-- ============================================================================
-- 088 · Bitácoras de auditoría: copia de audit_log como «legado»
-- ============================================================================
-- ⛔ ESCRITA Y SIN APLICAR, a propósito (pedido de Oliver, 03/10/2026). Se aplica
--    recién cuando las bitácoras nuevas (086 y 087) estén escribiendo y verificadas.
--
-- Copia UNA vez cada fila de `public.audit_log` a la bitácora que corresponde
-- (b.7 de la propuesta). No toca audit_log: lo lee. Requiere la 086 y la 087.
--   · origen = 'legado', con el usuario y la fecha ORIGINALES.
--   · evento_id = el id de la fila de audit_log: la copia se puede rastrear al
--     original, y las dos filas de una copia doble (legal + contable) lo comparten.
--   · cambios = {"campo": [antes, después]} desde field / old_value / new_value
--     (texto, como estaban). Sin campo: {}.
--   · Entra a la cadena de cada bitácora AL COPIARSE: la cadena garantiza desde ese
--     momento, no antes. Se copia en orden de fecha original.
--
-- Ruteo (b.7):
--   legal     cases, documents, client_payments, cat_*, clients, users, expenses
--   contable  business_expenses, payment, accounting_period, chart_of_accounts,
--             suppliers, tax_codes, quotes
--   además en la contable: clients con un campo fiscal; users con role/active o
--             alta/baja; expenses con un campo que entra al asiento o el comprobante.
--   otro valor: legal, con {"_clasificacion": [null, "sin clasificar"]} para
--             revisarlo a mano. No se adivina.
--
-- Aborta si ya hay filas de legado (no se copia dos veces) o si los conteos por
-- `entity` no coinciden entre el origen y el destino.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION auditoria.escribir_legado(
  p_modulo text, p_evento uuid, p_tenant uuid, p_en timestamptz, p_usuario uuid,
  p_accion text, p_tabla text, p_registro text, p_documento text, p_cambios jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tabla  text := 'bitacora_' || p_modulo;
  v_nombre text;
  v_rol    text;
  v_ult    text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('auditoria:' || p_tenant::text, 0));
  IF p_usuario IS NOT NULL THEN
    SELECT full_name, role INTO v_nombre, v_rol FROM public.users WHERE id = p_usuario AND tenant_id = p_tenant;
    IF NOT FOUND THEN v_rol := 'desconocido'; END IF;
  END IF;
  EXECUTE format('SELECT hash FROM auditoria.%I WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1', v_tabla)
     INTO v_ult USING p_tenant;
  EXECUTE format('INSERT INTO auditoria.%I (evento_id, tenant_id, ocurrido_en, usuario_id, usuario_nombre, rol,
                    accion, tabla, registro_id, documento, cambios, origen, hash_anterior, hash)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,''legado'',$12,$13)', v_tabla)
    USING p_evento, p_tenant, p_en, p_usuario, v_nombre, v_rol, p_accion, p_tabla, p_registro, p_documento,
          p_cambios, v_ult,
          auditoria.hash_de(v_ult, auditoria.contenido(p_evento, p_tenant, p_en, p_usuario, v_nombre, v_rol,
                            p_accion, p_tabla, p_registro, p_documento, p_cambios, 'legado'));
END $$;
REVOKE ALL ON FUNCTION auditoria.escribir_legado(text, uuid, uuid, timestamptz, uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  a          record;
  v_tabla    text;
  v_primaria text;
  v_copia    boolean;
  v_cambios  jsonb;
  v_accion   text;
  v_fila     jsonb;
  v_doc      text;
  v_dif      record;
  c_legal    text[] := ARRAY['cases', 'documents', 'client_payments', 'clients', 'users', 'expenses'];
  c_contable text[] := ARRAY['business_expenses', 'payment', 'accounting_period', 'chart_of_accounts',
                             'suppliers', 'tax_codes', 'quotes'];
BEGIN
  IF EXISTS (SELECT 1 FROM auditoria.bitacora_legal WHERE origen = 'legado')
     OR EXISTS (SELECT 1 FROM auditoria.bitacora_contable WHERE origen = 'legado') THEN
    RAISE EXCEPTION '088: el legado ya se copió; no se copia dos veces';
  END IF;

  FOR a IN SELECT * FROM public.audit_log ORDER BY created_at, id LOOP
    v_tabla := CASE a.entity WHEN 'payment' THEN 'payments' WHEN 'accounting_period' THEN 'accounting_periods'
                             ELSE a.entity END;
    v_accion := CASE a.action WHEN 'create' THEN 'crear' WHEN 'update' THEN 'editar' WHEN 'delete' THEN 'eliminar'
                              ELSE a.action END;
    v_cambios := CASE WHEN a.field IS NULL THEN '{}'::jsonb
                      ELSE jsonb_build_object(a.field, jsonb_build_array(a.old_value, a.new_value)) END;

    IF a.entity = ANY (c_contable) THEN
      v_primaria := 'contable';
    ELSIF a.entity = ANY (c_legal) OR a.entity LIKE 'cat\_%' THEN
      v_primaria := 'legal';
    ELSE
      v_primaria := 'legal';
      v_cambios := v_cambios || '{"_clasificacion": [null, "sin clasificar"]}'::jsonb;
    END IF;

    v_copia := (a.entity = 'clients' AND a.field = ANY (ARRAY['name', 'ruc', 'tax_id', 'digito_verificador',
                  'tax_id_type', 'client_type', 'tipo_receptor_fe', 'client_status', 'billing_address',
                  'codigo_ubicacion', 'corregimiento', 'distrito', 'provincia', 'id_extranjero', 'pais_receptor']))
            OR (a.entity = 'users' AND (a.field IN ('role', 'active') OR a.action IN ('create', 'delete')))
            OR (a.entity = 'expenses' AND (a.field = ANY (ARRAY['amount', 'date', 'accounting_date', 'due_date',
                  'supplier_id', 'supplier_invoice_number', 'purchase_number', 'posted_entry_id', 'status',
                  'amount_paid', 'expense_type']) OR a.field LIKE 'receipt%'));

    -- El número legible, desde la fila de hoy si todavía existe.
    v_fila := NULL;
    v_doc := NULL;
    IF a.entity_id IS NOT NULL AND to_regclass('public.' || quote_ident(v_tabla)) IS NOT NULL THEN
      BEGIN
        EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', v_tabla) INTO v_fila USING a.entity_id;
      EXCEPTION WHEN undefined_column THEN v_fila := NULL;
      END;
      IF v_fila IS NOT NULL THEN v_doc := auditoria.documento_de(v_tabla, v_fila); END IF;
    END IF;

    PERFORM auditoria.escribir_legado(v_primaria, a.id, a.tenant_id, a.created_at, a.user_id, v_accion,
                                      v_tabla, a.entity_id::text, v_doc, v_cambios);
    IF v_copia AND v_primaria = 'legal' THEN
      PERFORM auditoria.escribir_legado('contable', a.id, a.tenant_id, a.created_at, a.user_id, v_accion,
                                        v_tabla, a.entity_id::text, v_doc, v_cambios);
    END IF;
  END LOOP;

  -- Conteos por entity: cada fila del origen es exactamente un evento en el destino.
  FOR v_dif IN
    SELECT o.entity, o.n AS origen, coalesce(d.n, 0) AS destino
      FROM (SELECT entity, count(*) n FROM public.audit_log GROUP BY entity) o
      LEFT JOIN (SELECT al.entity, count(DISTINCT b.evento_id) n
                   FROM (SELECT evento_id FROM auditoria.bitacora_legal WHERE origen = 'legado'
                         UNION ALL SELECT evento_id FROM auditoria.bitacora_contable WHERE origen = 'legado') b
                   JOIN public.audit_log al ON al.id = b.evento_id
                  GROUP BY al.entity) d ON d.entity = o.entity
     WHERE o.n <> coalesce(d.n, 0)
  LOOP
    RAISE EXCEPTION '088: % tiene % filas en audit_log y % en las bitácoras', v_dif.entity, v_dif.origen, v_dif.destino;
  END LOOP;

  RAISE NOTICE '088 ✅ legado copiado: % filas de audit_log', (SELECT count(*) FROM public.audit_log);
END $$;

COMMIT;
