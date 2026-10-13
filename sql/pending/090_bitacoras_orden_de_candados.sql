-- ============================================================================
-- 090 · Bitácoras: un solo orden de candados con el libro (evita el deadlock)
-- ============================================================================
-- Encontrado el 03/10/2026 en la prueba 2 (dos usuarios a la vez), con la 086,
-- 087 y 089 aplicadas en staging.
--
-- Hay dos candados por bufete que se sostienen hasta el COMMIT:
--   J · la fila 'journal_entry' de accounting_sequences (FOR UPDATE), que toma
--       post_journal_entry para el correlativo y la cadena del libro;
--   A · el candado de la bitácora (pg_advisory_xact_lock), que toma
--       auditoria.escribir en cada fila auditada.
-- post_journal_entry toma J y después A (al insertar el asiento, el trigger
-- escribe en la bitácora). Pero los RPC que escriben algo auditado ANTES de
-- postear los toman al revés, A y después J:
--   · post_journal_entries_batch (importación de asientos): journal_imports, después posteo;
--   · create_supplier_credit_note (NC de compra): la NC y sus líneas, después posteo.
-- Intercalados con un posteo suelto (emitir una factura, registrar un cobro,
-- un gasto de trámite) se traban: Postgres lo detecta al segundo y cancela uno
-- con «deadlock detected» (40P01). Reproducido en staging con dos sesiones.
--
-- Corrección: auditoria.escribir toma J ANTES de A. Así todos los caminos van
-- J → A, el orden que ya usaba el motor. No serializa nada que no estuviera ya
-- serializado: quien postea toma A enseguida de J, así que una escritura
-- auditada ya esperaba a cualquier posteo en curso.
-- La fila J se crea si no existe (como lo hace post_journal_entry, con el
-- correlativo en 0), para que un bufete que nunca posteó tenga el mismo orden.
-- Lo mismo en el ancla al cerrar un período.
--
-- Sólo reemplaza dos funciones. No toca filas de las bitácoras ni del libro.
-- 🛡️ Sólo staging hasta el «aplica» de Oliver. En producción: 086, 087, 089, 090.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION auditoria.tomar_candados(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  -- 1) J: el mismo candado que toma post_journal_entry, en el mismo orden.
  INSERT INTO public.accounting_sequences (tenant_id, sequence_type, last_number)
  VALUES (p_tenant, 'journal_entry', 0)
  ON CONFLICT (tenant_id, sequence_type) DO NOTHING;
  PERFORM 1 FROM public.accounting_sequences
   WHERE tenant_id = p_tenant AND sequence_type = 'journal_entry'
     FOR UPDATE;
  -- 2) A: la cadena de las dos bitácoras.
  PERFORM pg_advisory_xact_lock(hashtextextended('auditoria:' || p_tenant::text, 0));
END $$;

CREATE OR REPLACE FUNCTION auditoria.escribir(
  p_modulo text, p_evento uuid, p_tenant uuid, p_accion text, p_tabla text,
  p_registro text, p_documento text, p_cambios jsonb, p_origen text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_tabla    text := 'bitacora_' || p_modulo;
  v_actor    record;
  v_en       timestamptz := now();
  v_hoy      date := (now() AT TIME ZONE 'America/Panama')::date;
  v_ult_id   bigint;
  v_ult_hash text;
  v_ult_en   timestamptz;
  v_origen   text := p_origen;
  v_cont     text;
BEGIN
  IF p_modulo NOT IN ('contable', 'legal') THEN
    RAISE EXCEPTION 'auditoria.escribir: módulo desconocido %', p_modulo;
  END IF;

  -- 090: primero el correlativo del libro, después la bitácora (el orden del motor).
  PERFORM auditoria.tomar_candados(p_tenant);

  SELECT * INTO v_actor FROM auditoria.actor(p_tenant);
  IF v_actor.usuario_id IS NULL AND v_origen = 'usuario' THEN
    v_origen := 'sistema';
  END IF;

  EXECUTE format('SELECT id, hash, ocurrido_en FROM auditoria.%I WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1', v_tabla)
     INTO v_ult_id, v_ult_hash, v_ult_en USING p_tenant;

  -- Ancla diaria: la primera escritura de un día ancla el cierre del día anterior.
  IF v_ult_id IS NOT NULL
     AND (v_ult_en AT TIME ZONE 'America/Panama')::date < v_hoy
     AND NOT EXISTS (SELECT 1 FROM auditoria.anclas a
                      WHERE a.tenant_id = p_tenant AND a.modulo = p_modulo AND a.ultimo_id >= v_ult_id) THEN
    PERFORM auditoria.anclar(p_tenant, p_modulo, 'diaria',
                             to_char((v_ult_en AT TIME ZONE 'America/Panama')::date, 'YYYY-MM-DD'));
  END IF;

  v_cont := auditoria.contenido(p_evento, p_tenant, v_en, v_actor.usuario_id, v_actor.usuario_nombre,
                                v_actor.rol, p_accion, p_tabla, p_registro, p_documento,
                                coalesce(p_cambios, '{}'::jsonb), v_origen);

  EXECUTE format('INSERT INTO auditoria.%I (evento_id, tenant_id, ocurrido_en, usuario_id, usuario_nombre, rol,
                    accion, tabla, registro_id, documento, cambios, origen, hash_anterior, hash)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', v_tabla)
    USING p_evento, p_tenant, v_en, v_actor.usuario_id, v_actor.usuario_nombre, v_actor.rol,
          p_accion, p_tabla, p_registro, p_documento, coalesce(p_cambios, '{}'::jsonb), v_origen,
          v_ult_hash, auditoria.hash_de(v_ult_hash, v_cont);
END $$;

CREATE OR REPLACE FUNCTION auditoria.anclar_al_cerrar_periodo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.status = 'abierto' AND NEW.status = 'cerrado' THEN
    PERFORM auditoria.tomar_candados(NEW.tenant_id);         -- 090: mismo orden
    PERFORM auditoria.anclar(NEW.tenant_id, 'contable', 'cierre_periodo',
                             NEW.year::text || '-' || lpad(NEW.month::text, 2, '0'));
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION auditoria.tomar_candados(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ── Verificación ───────────────────────────────────────────────────────────
-- El orden se prueba con dos sesiones (no cabe en una transacción):
--   prueba 2 (b2) de docs/finanzas/prueba-bitacoras.txt. Acá, que las dos
-- funciones pasen por tomar_candados y que nadie más tome el candado A suelto.
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'auditoria' AND p.proname IN ('escribir', 'anclar_al_cerrar_periodo')
     AND p.prosrc LIKE '%auditoria.tomar_candados%';
  IF v <> 2 THEN
    RAISE EXCEPTION '090: escribir y anclar_al_cerrar_periodo deben pasar por tomar_candados (hay %)', v;
  END IF;
  SELECT count(*) INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'auditoria' AND p.proname <> 'tomar_candados' AND p.prosrc LIKE '%pg_advisory_xact_lock%';
  IF v <> 0 THEN
    RAISE EXCEPTION '090: % función(es) de auditoria toman el candado de la bitácora sin pasar por tomar_candados', v;
  END IF;
  RAISE NOTICE '090 ✅ bitácora y libro: un solo orden de candados (correlativo del libro, después bitácora)';
END $$;

COMMIT;
