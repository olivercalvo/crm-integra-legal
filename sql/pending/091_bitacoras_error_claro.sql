-- ============================================================================
-- 091 · Bitácoras: si el registro de auditoría falla, un error reconocible
-- ============================================================================
-- Prueba 3 (03/10/2026). Con la 087 la captura falla cerrado, y eso está bien,
-- pero el error que sube es el de adentro («COALESCE types text and integer
-- cannot be matched», «deadlock detected»), y cada ruta lo muestra a su manera:
-- con un texto fijo que no dice qué pasó, o con el texto técnico.
--
-- Desde esta migración, cualquier falla dentro de auditoria.registrar (y del ancla
-- al cerrar un período) se relanza con:
--   SQLSTATE  AU001          · la app lo reconoce sin leer el texto
--   MESSAGE   «No se pudo guardar porque falló el registro de auditoría. Intenta
--             de nuevo y, si se repite, avisa al administrador.»
--   DETAIL    [SQLSTATE original] mensaje original   · para el log del servidor
--   HINT      auditoria.registrar · OPERACIÓN tabla
-- La operación se sigue deshaciendo entera: sigue fallando cerrado.
--
-- La app (createAdminClient y el cliente de sesión, src/lib/auditoria/error-de-auditoria.ts)
-- reconoce AU001, escribe el error real en el log del servidor y la ruta responde
-- con el mensaje de arriba (conManejoDeAuditoria).
--
-- Costo: cada fila auditada corre dentro de un bloque con EXCEPTION, o sea una
-- subtransacción. Medido en staging (ROLLBACK) sobre la importación de 200 líneas:
-- ver docs/finanzas/prueba-bitacoras.txt, prueba 3.
--
-- Sólo reemplaza dos funciones. No toca filas.
-- 🛡️ Sólo staging hasta el «aplica» de Oliver. En producción: 086, 087, 089, 090, 091.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION auditoria.registrar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- 091: sin inicializadores que puedan fallar fuera del bloque protegido.
  v_modo    text := TG_ARGV[0];
  o         jsonb;
  n         jsonb;
  r         jsonb;
  v_tenant  uuid;
  v_evento  uuid;
  v_origen  text;
  v_todo    jsonb;
  v_accion  text;
  v_doc     text;
  v_reg     text;
  v_contable jsonb;
  v_legal   boolean;
  v_fin     text[] := ARRAY['admin', 'abogada', 'contador'];
  v_msg     text;
  v_estado  text;
BEGIN
  BEGIN
    o := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
    n := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
    r := coalesce(n, o);
    v_tenant := (r->>'tenant_id')::uuid;
    v_evento := gen_random_uuid();
    v_origen := CASE WHEN pg_trigger_depth() > 1 THEN 'sistema' ELSE 'usuario' END;
    v_reg := coalesce(r->>'id', r->>'tenant_id');
    v_legal := v_modo IN ('legal', 'mixto');

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
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_estado = RETURNED_SQLSTATE;
    RAISE EXCEPTION USING
      ERRCODE = 'AU001',
      MESSAGE = 'No se pudo guardar porque falló el registro de auditoría. Intenta de nuevo y, si se repite, avisa al administrador.',
      DETAIL  = format('[%s] %s', v_estado, v_msg),
      HINT    = format('auditoria.registrar · %s %s', TG_OP, TG_TABLE_NAME);
  END;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION auditoria.anclar_al_cerrar_periodo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_msg    text;
  v_estado text;
BEGIN
  IF OLD.status = 'abierto' AND NEW.status = 'cerrado' THEN
    BEGIN
      PERFORM auditoria.tomar_candados(NEW.tenant_id);
      PERFORM auditoria.anclar(NEW.tenant_id, 'contable', 'cierre_periodo',
                               NEW.year::text || '-' || lpad(NEW.month::text, 2, '0'));
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_estado = RETURNED_SQLSTATE;
      RAISE EXCEPTION USING
        ERRCODE = 'AU001',
        MESSAGE = 'No se pudo guardar porque falló el registro de auditoría. Intenta de nuevo y, si se repite, avisa al administrador.',
        DETAIL  = format('[%s] %s', v_estado, v_msg),
        HINT    = 'auditoria.anclar_al_cerrar_periodo · UPDATE accounting_periods';
    END;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION auditoria.registrar(), auditoria.anclar_al_cerrar_periodo() FROM PUBLIC, anon, authenticated, service_role;

-- ── Verificación: una falla forzada sale como AU001 con el mensaje y el original ──
DO $$
DECLARE
  v_caso   uuid := (SELECT id FROM public.cases ORDER BY created_at LIMIT 1);
  v_user   uuid := (SELECT id FROM public.users ORDER BY created_at LIMIT 1);
  v_estado text;
  v_msg    text;
  v_det    text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
       WHERE s.nspname = 'auditoria' AND p.proname IN ('registrar', 'anclar_al_cerrar_periodo')
         AND p.prosrc LIKE '%AU001%') <> 2 THEN
    RAISE EXCEPTION '091: registrar y anclar_al_cerrar_periodo deben relanzar AU001';
  END IF;
  IF v_caso IS NULL THEN
    RAISE NOTICE '091 ✅ (sin casos: la falla forzada no se pudo ensayar)';
    RETURN;
  END IF;
  BEGIN
    -- Una documento_de que falla, sólo dentro de este bloque (se deshace con él).
    EXECUTE $f$CREATE OR REPLACE FUNCTION auditoria.documento_de(p_tabla text, r jsonb) RETURNS text
               LANGUAGE plpgsql AS $b$ BEGIN RAISE EXCEPTION 'falla forzada por la verificación 091'; END $b$ $f$;
    INSERT INTO public.comments (tenant_id, case_id, text, user_id)
    SELECT tenant_id, id, 'verificación 091', v_user FROM public.cases WHERE id = v_caso;
    RAISE EXCEPTION 'no falló';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_det = PG_EXCEPTION_DETAIL;
  END;
  IF v_estado <> 'AU001'
     OR v_msg <> 'No se pudo guardar porque falló el registro de auditoría. Intenta de nuevo y, si se repite, avisa al administrador.'
     OR v_det NOT LIKE '[P0001] falla forzada por la verificación 091%' THEN
    RAISE EXCEPTION '091: la falla forzada salió como % «%» (%)', v_estado, v_msg, v_det;
  END IF;
  RAISE NOTICE '091 ✅ falla de la bitácora → AU001, mensaje claro, original en el detalle: %', v_det;
END $$;

COMMIT;
