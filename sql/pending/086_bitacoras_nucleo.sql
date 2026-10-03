-- ============================================================================
-- 086 · Bitácoras de auditoría (1/2): núcleo
-- ============================================================================
-- Propuesta aprobada: docs/finanzas/propuesta-bitacora-auditoria.md (03/10/2026).
-- DOS bitácoras, una por módulo, cada una con su cadena de hash, su ancla y su
-- verificador. Esta migración crea el núcleo; la 087 conecta los triggers de las
-- tablas. La 088 (copia del legado de audit_log) queda escrita y SIN APLICAR.
--
-- Qué crea:
--   1. Esquema `auditoria`, fuera de `public`: PostgREST no lo expone.
--   2. `auditoria.bitacora_contable` y `auditoria.bitacora_legal` (mismas columnas,
--      b.3 de la propuesta) y `auditoria.anclas`.
--   3. Solo agregar: REVOKE ALL a anon, authenticated y service_role, y triggers
--      BEFORE UPDATE/DELETE/TRUNCATE que rechazan a todo rol que no sea
--      superusuario. Es el mecanismo de la 084.
--   4. La cadena: `auditoria.escribir()` toma un candado por bufete (uno solo para
--      las dos bitácoras: un cambio que escribe en las dos nunca espera en orden
--      inverso a otro, así no hay deadlock), lee el último hash y graba la fila.
--   5. El actor: `auth.uid()` si hay sesión; si no, el header `x-actor-id` que manda
--      el servidor con el cliente de servicio (SOLO si el JWT es de service_role);
--      si no hay ninguno, la fila queda sin usuario y con origen «sistema».
--   6. Anclas: diaria (la primera escritura de cada día ancla el último registro del
--      día anterior: no hace falta un cron) y, en la contable, al cerrar un período.
--   7. Lectura y verificación por RPC `SECURITY DEFINER` con EXECUTE solo para
--      service_role. Como el posteo del libro (030): la ruta pasa el tenant y el
--      usuario SACADOS DEL PERFIL, y la función vuelve a verificar el rol.
--      Contable: contador y admin. Legal: admin.
--
-- Dueño de las funciones: el rol que corre la migración (`postgres`). La propuesta
-- sugería un rol sin login; no cambia nada en la práctica: `postgres` puede hacer
-- SET ROLE a cualquier rol que cree, y un rol sin BYPASSRLS no podría leer
-- `public.users` para copiar el nombre del usuario. El límite real es el mismo que
-- en el libro: quien tiene `postgres` puede INSERTAR filas falsas (no editar ni
-- borrar las que hay), y la cadena con su ancla lo hace visible.
--
-- No toca ninguna fila existente. No toca el libro.
-- 🛡️ Sólo staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

CREATE SCHEMA IF NOT EXISTS auditoria;
REVOKE ALL ON SCHEMA auditoria FROM PUBLIC, anon, authenticated, service_role;

-- ── 1. Tablas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auditoria.bitacora_contable (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evento_id       uuid        NOT NULL,
  tenant_id       uuid        NOT NULL,
  ocurrido_en     timestamptz NOT NULL,
  usuario_id      uuid,
  usuario_nombre  text,
  rol             text,
  accion          text        NOT NULL,
  tabla           text        NOT NULL,
  registro_id     text,
  documento       text,
  cambios         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  origen          text        NOT NULL CHECK (origen IN ('usuario', 'sistema', 'legado')),
  hash_anterior   text,
  hash            text        NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria.bitacora_legal (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evento_id       uuid        NOT NULL,
  tenant_id       uuid        NOT NULL,
  ocurrido_en     timestamptz NOT NULL,
  usuario_id      uuid,
  usuario_nombre  text,
  rol             text,
  accion          text        NOT NULL,
  tabla           text        NOT NULL,
  registro_id     text,
  documento       text,
  cambios         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  origen          text        NOT NULL CHECK (origen IN ('usuario', 'sistema', 'legado')),
  hash_anterior   text,
  hash            text        NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria.anclas (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid        NOT NULL,
  modulo       text        NOT NULL CHECK (modulo IN ('contable', 'legal')),
  motivo       text        NOT NULL CHECK (motivo IN ('diaria', 'cierre_periodo')),
  referencia   text        NOT NULL,          -- el día (AAAA-MM-DD) o el período (AAAA-MM)
  ultimo_id    bigint      NOT NULL,
  ultimo_hash  text        NOT NULL,
  creado_en    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bitacora_contable_fecha ON auditoria.bitacora_contable (tenant_id, ocurrido_en);
CREATE INDEX IF NOT EXISTS bitacora_contable_registro ON auditoria.bitacora_contable (tenant_id, tabla, registro_id);
CREATE INDEX IF NOT EXISTS bitacora_contable_documento ON auditoria.bitacora_contable (tenant_id, documento);
CREATE INDEX IF NOT EXISTS bitacora_contable_evento ON auditoria.bitacora_contable (evento_id);
CREATE INDEX IF NOT EXISTS bitacora_legal_fecha ON auditoria.bitacora_legal (tenant_id, ocurrido_en);
CREATE INDEX IF NOT EXISTS bitacora_legal_registro ON auditoria.bitacora_legal (tenant_id, tabla, registro_id);
CREATE INDEX IF NOT EXISTS bitacora_legal_documento ON auditoria.bitacora_legal (tenant_id, documento);
CREATE INDEX IF NOT EXISTS bitacora_legal_evento ON auditoria.bitacora_legal (evento_id);
CREATE INDEX IF NOT EXISTS anclas_tenant ON auditoria.anclas (tenant_id, modulo, ultimo_id);

REVOKE ALL ON ALL TABLES IN SCHEMA auditoria FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auditoria FROM PUBLIC, anon, authenticated, service_role;

-- ── 2. Solo agregar ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auditoria.solo_agregar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'La bitácora % es solo de agregar: no se permite % (rol %).', TG_TABLE_NAME, TG_OP, current_user
    USING ERRCODE = 'insufficient_privilege';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bitacora_contable', 'bitacora_legal', 'anclas'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_solo_agregar ON auditoria.%I', t);
    EXECUTE format('CREATE TRIGGER trg_solo_agregar BEFORE UPDATE OR DELETE ON auditoria.%I
                    FOR EACH ROW EXECUTE FUNCTION auditoria.solo_agregar()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_sin_truncate ON auditoria.%I', t);
    EXECUTE format('CREATE TRIGGER trg_sin_truncate BEFORE TRUNCATE ON auditoria.%I
                    FOR EACH STATEMENT EXECUTE FUNCTION auditoria.solo_agregar()', t);
  END LOOP;
END $$;

-- ── 3. Contenido y hash ────────────────────────────────────────────────────
-- El contenido es JSON (jsonb ordena las llaves de forma fija) y la fecha va en
-- UTC con microsegundos. La MISMA función calcula al grabar y al verificar.
CREATE OR REPLACE FUNCTION auditoria.contenido(
  p_evento uuid, p_tenant uuid, p_en timestamptz, p_usuario uuid, p_nombre text, p_rol text,
  p_accion text, p_tabla text, p_registro text, p_documento text, p_cambios jsonb, p_origen text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'evento_id', p_evento, 'tenant_id', p_tenant,
    'ocurrido_en', to_char(p_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'usuario_id', p_usuario, 'usuario_nombre', p_nombre, 'rol', p_rol,
    'accion', p_accion, 'tabla', p_tabla, 'registro_id', p_registro, 'documento', p_documento,
    'cambios', p_cambios, 'origen', p_origen)::text
$$;

CREATE OR REPLACE FUNCTION auditoria.hash_de(p_anterior text, p_contenido text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT encode(sha256(convert_to(coalesce(p_anterior, '') || '|' || p_contenido, 'UTF8')), 'hex')
$$;

-- ── 4. El actor ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auditoria.actor(p_tenant uuid,
  OUT usuario_id uuid, OUT usuario_nombre text, OUT rol text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid     uuid;
  v_claims  jsonb;
  v_headers jsonb;
  v_hdr     text;
BEGIN
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  IF v_claims ? 'sub' AND (v_claims->>'sub') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uid := (v_claims->>'sub')::uuid;                       -- sesión del usuario (auth.uid())
  ELSIF v_claims->>'role' = 'service_role' THEN
    -- El header sólo vale con la clave de servicio, que vive en el servidor.
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_hdr := v_headers->>'x-actor-id';
    IF v_hdr ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_uid := v_hdr::uuid;
    END IF;
  END IF;

  IF v_uid IS NULL THEN
    RETURN;                                                  -- sistema
  END IF;
  usuario_id := v_uid;
  SELECT u.full_name, u.role INTO usuario_nombre, rol
    FROM public.users u
   WHERE u.id = v_uid AND u.tenant_id = p_tenant;
  IF NOT FOUND THEN
    usuario_nombre := NULL;
    rol := 'desconocido';                                    -- usuario de otro bufete o borrado
  END IF;
END $$;

-- ── 5. Anclar ──────────────────────────────────────────────────────────────
-- Se llama con el candado del bufete ya tomado.
CREATE OR REPLACE FUNCTION auditoria.anclar(p_tenant uuid, p_modulo text, p_motivo text, p_referencia text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_id   bigint;
  v_hash text;
BEGIN
  EXECUTE format('SELECT id, hash FROM auditoria.%I WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1',
                 'bitacora_' || p_modulo)
     INTO v_id, v_hash USING p_tenant;
  IF v_id IS NULL THEN
    RETURN;                                                  -- nada que anclar
  END IF;
  INSERT INTO auditoria.anclas (tenant_id, modulo, motivo, referencia, ultimo_id, ultimo_hash)
  VALUES (p_tenant, p_modulo, p_motivo, p_referencia, v_id, v_hash);
END $$;

-- ── 6. Escribir una fila (la única puerta de escritura) ────────────────────
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

  -- Un candado por bufete para las dos bitácoras: serializa la cadena.
  PERFORM pg_advisory_xact_lock(hashtextextended('auditoria:' || p_tenant::text, 0));

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

-- ── 7. Ancla contable al cerrar un período ─────────────────────────────────
-- El nombre ordena DESPUÉS de trg_auditoria (087): el ancla incluye el cierre.
CREATE OR REPLACE FUNCTION auditoria.anclar_al_cerrar_periodo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.status = 'abierto' AND NEW.status = 'cerrado' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('auditoria:' || NEW.tenant_id::text, 0));
    PERFORM auditoria.anclar(NEW.tenant_id, 'contable', 'cierre_periodo',
                             NEW.year::text || '-' || lpad(NEW.month::text, 2, '0'));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auditoria_zz_ancla_cierre ON public.accounting_periods;
CREATE TRIGGER trg_auditoria_zz_ancla_cierre
  AFTER UPDATE OF status ON public.accounting_periods
  FOR EACH ROW EXECUTE FUNCTION auditoria.anclar_al_cerrar_periodo();

-- ── 8. Quién puede leer ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auditoria.exigir_lector(p_modulo text, p_tenant uuid, p_usuario uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_rol text;
BEGIN
  SELECT u.role INTO v_rol FROM public.users u
   WHERE u.id = p_usuario AND u.tenant_id = p_tenant AND coalesce(u.active, true);
  IF v_rol IS NULL
     OR (p_modulo = 'contable' AND v_rol NOT IN ('admin', 'contador'))
     OR (p_modulo = 'legal'    AND v_rol <> 'admin')
     OR p_modulo NOT IN ('contable', 'legal') THEN
    RAISE EXCEPTION 'Sin permiso para ver la bitácora %', p_modulo USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

-- ── 9. Lectura (RPC, solo service_role) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bitacora_leer(
  p_modulo text, p_tenant_id uuid, p_usuario_id uuid,
  p_desde timestamptz DEFAULT NULL, p_hasta timestamptz DEFAULT NULL,
  p_filtro_usuario uuid DEFAULT NULL, p_accion text DEFAULT NULL, p_tablas text[] DEFAULT NULL,
  p_documento text DEFAULT NULL, p_origen text DEFAULT NULL,
  p_limite integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS TABLE (
  id bigint, evento_id uuid, ocurrido_en timestamptz, usuario_id uuid, usuario_nombre text, rol text,
  accion text, tabla text, registro_id text, documento text, cambios jsonb, origen text, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM auditoria.exigir_lector(p_modulo, p_tenant_id, p_usuario_id);
  RETURN QUERY EXECUTE format($q$
    SELECT b.id, b.evento_id, b.ocurrido_en, b.usuario_id, b.usuario_nombre, b.rol, b.accion, b.tabla,
           b.registro_id, b.documento, b.cambios, b.origen, count(*) OVER ()
      FROM auditoria.%I b
     WHERE b.tenant_id = $1
       AND ($2 IS NULL OR b.ocurrido_en >= $2)
       AND ($3 IS NULL OR b.ocurrido_en <  $3)
       AND ($4 IS NULL OR b.usuario_id = $4)
       AND ($5 IS NULL OR b.accion = $5)
       AND ($6 IS NULL OR b.tabla = ANY ($6))
       AND ($7 IS NULL OR b.documento ILIKE '%%' || $7 || '%%')
       AND ($8 IS NULL OR b.origen = $8)
     ORDER BY b.id DESC
     LIMIT $9 OFFSET $10 $q$, 'bitacora_' || p_modulo)
  USING p_tenant_id, p_desde, p_hasta, p_filtro_usuario, p_accion, p_tablas, nullif(trim(p_documento), ''),
        p_origen, least(greatest(coalesce(p_limite, 100), 1), 50000), greatest(coalesce(p_offset, 0), 0);
END $$;

-- ── 10. Verificación (RPC, solo service_role) ──────────────────────────────
CREATE OR REPLACE FUNCTION auditoria.verificar(p_modulo text, p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  r        record;
  v_prev   text := NULL;
  v_filas  bigint := 0;
  v_rotas  bigint[] := '{}';
  v_anclas bigint := 0;
  v_anclas_rotas jsonb := '[]'::jsonb;
  v_hash   text;
  a        record;
BEGIN
  FOR r IN EXECUTE format('SELECT * FROM auditoria.%I WHERE tenant_id = $1 ORDER BY id', 'bitacora_' || p_modulo)
           USING p_tenant LOOP
    v_filas := v_filas + 1;
    IF r.hash_anterior IS DISTINCT FROM v_prev
       OR r.hash <> auditoria.hash_de(r.hash_anterior, auditoria.contenido(
            r.evento_id, r.tenant_id, r.ocurrido_en, r.usuario_id, r.usuario_nombre, r.rol,
            r.accion, r.tabla, r.registro_id, r.documento, r.cambios, r.origen)) THEN
      v_rotas := v_rotas || r.id;
    END IF;
    v_prev := r.hash;
  END LOOP;

  FOR a IN SELECT * FROM auditoria.anclas WHERE tenant_id = p_tenant AND modulo = p_modulo ORDER BY id LOOP
    v_anclas := v_anclas + 1;
    EXECUTE format('SELECT hash FROM auditoria.%I WHERE tenant_id = $1 AND id = $2', 'bitacora_' || p_modulo)
       INTO v_hash USING p_tenant, a.ultimo_id;
    IF v_hash IS DISTINCT FROM a.ultimo_hash THEN
      v_anclas_rotas := v_anclas_rotas || jsonb_build_object('ancla', a.id, 'referencia', a.referencia, 'fila', a.ultimo_id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'modulo', p_modulo, 'filas', v_filas, 'ultimo_hash', v_prev,
    'filas_alteradas', to_jsonb(v_rotas), 'anclas', v_anclas, 'anclas_que_no_coinciden', v_anclas_rotas,
    'integra', cardinality(v_rotas) = 0 AND jsonb_array_length(v_anclas_rotas) = 0);
END $$;

CREATE OR REPLACE FUNCTION public.bitacora_verificar(p_modulo text, p_tenant_id uuid, p_usuario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM auditoria.exigir_lector(p_modulo, p_tenant_id, p_usuario_id);
  RETURN auditoria.verificar(p_modulo, p_tenant_id);
END $$;

-- ── 11. Permisos de ejecución ──────────────────────────────────────────────
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auditoria FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.bitacora_leer(text, uuid, uuid, timestamptz, timestamptz, uuid, text, text[], text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bitacora_verificar(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bitacora_leer(text, uuid, uuid, timestamptz, timestamptz, uuid, text, text[], text, text, integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.bitacora_verificar(text, uuid, uuid) TO service_role;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['auditoria.bitacora_contable', 'auditoria.bitacora_legal', 'auditoria.anclas'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_table_privilege(r, t, 'SELECT') OR has_table_privilege(r, t, 'INSERT')
         OR has_table_privilege(r, t, 'UPDATE') OR has_table_privilege(r, t, 'DELETE') THEN
        RAISE EXCEPTION '086: % tiene permisos sobre %', r, t;
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = t::regclass
         AND tgname IN ('trg_solo_agregar', 'trg_sin_truncate')) <> 2 THEN
      RAISE EXCEPTION '086: faltan los triggers de solo agregar en %', t;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.bitacora_leer(text, uuid, uuid, timestamptz, timestamptz, uuid, text, text[], text, text, integer, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.bitacora_verificar(text, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '086: las RPC de lectura quedaron abiertas a la sesión del usuario';
  END IF;
  -- La cadena se recalcula igual: contenido y hash son deterministas.
  IF auditoria.hash_de(NULL, auditoria.contenido('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000',
       '2026-10-03 12:00:00+00', NULL, NULL, NULL, 'crear', 't', '1', 'D', '{"a":[null,1]}', 'sistema'))
     <> auditoria.hash_de(NULL, auditoria.contenido('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000',
       '2026-10-03 07:00:00-05', NULL, NULL, NULL, 'crear', 't', '1', 'D', '{"a":[null,1]}', 'sistema')) THEN
    RAISE EXCEPTION '086: el hash depende del huso horario de la sesión';
  END IF;
  RAISE NOTICE '086 ✅ bitácoras contable y legal: solo agregar, cadena, anclas, lectura por rol';
END $$;

COMMIT;
