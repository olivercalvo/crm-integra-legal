-- ============================================================================
-- 072 — HASH v5 SIN AMBIGÜEDAD Y UN VERIFICADOR QUE RECALCULA CADA ASIENTO
-- ============================================================================
-- 01/10/2026. Plan: `docs/finanzas/plan-bloque1.md` §8, requisito R-1 (Oliver:
-- "sí, construye la v5 y el verificador que recalcula", 01/10/2026).
--
-- POR QUÉ
-- -------
-- `verify_accounting_chain` (030) sólo comprobaba el ENCADENAMIENTO
-- (`prev_hash` y `hash = sha256(prev_hash || content_hash)`) y nunca recalculaba
-- `content_hash` desde las columnas. Un monto, una cuenta o un tercero cambiados
-- directamente en la base (con los triggers de la 023 desactivados) pasaban.
-- Y la fórmula v1–v4 une los campos con `|` y `:` SIN ESCAPAR: mover texto entre
-- dos campos libres contiguos podía dar la misma cadena.
--
-- QUÉ HACE
-- --------
--   1. `journal_entries.hash_version` (smallint). El motor escribe 5 en todo
--      asiento nuevo. Los viejos quedan NULL (no se hace UPDATE del libro).
--   2. `accounting_hash_versions`: los TRAMOS de correlativo de cada versión
--      vieja, por bufete, sembrados UNA vez detectando qué fórmula reproduce
--      cada asiento. Si un asiento no se reproduce con ninguna, o las versiones
--      no avanzan en orden, la migración ABORTA y los nombra.
--   3. `finanzas_linea_v5` + `finanzas_contenido_v5`: el contenido canónico en
--      JSON (jsonb ordena las claves y escapa los textos: no hay separador que
--      mover). Es la MISMA función para el motor y para el verificador.
--   4. `finanzas_contenido_de_asiento(id, version)`: reconstruye el contenido de
--      un asiento grabado con la fórmula de su versión (v1 a v5).
--   5. `post_journal_entry` calcula la v5 (parche verificado sobre la 071).
--   6. `verify_accounting_chain` v2: MISMA firma y mismas filas de salida; suma
--      `contenido alterado (fórmula vN)` y `sin versión de fórmula`.
--
-- 🔴 NO SE TOCA EL LIBRO. Cero UPDATE/DELETE sobre journal_entries o sus
--    líneas. La columna nueva nace NULL en las filas viejas (DDL, sin triggers).
-- 🔒 Mientras corre, `LOCK ... IN EXCLUSIVE MODE` sobre journal_entries: nadie
--    postea entre la detección de tramos y el cambio del motor.
--
-- LO QUE SIGUE SIN DETECTARSE (escrito en SOP-014):
--   · Una reescritura COMPLETA (contenido, content_hash, hash y todos los
--     prev_hash siguientes): la cadena es coherente consigo misma. Para eso hace
--     falta un ancla externa (el respaldo, o publicar el último hash).
--   · `idempotency_key`, `created_by` y `created_at` no entran al hash (039).
--
-- IDEMPOTENCIA: ADD COLUMN / CREATE TABLE IF NOT EXISTS, funciones CREATE OR
--               REPLACE, el parche del motor detecta la segunda corrida y los
--               tramos se insertan sólo si faltan.
-- 🛑 SOLO STAGING hasta la ventana del despliegue. Depende de la 071.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'journal_entries'
                    AND column_name = 'referencia_externa') THEN
    RAISE EXCEPTION '072: falta journal_entries.referencia_externa. Aplicar primero la 071.';
  END IF;
END $$;

LOCK TABLE public.journal_entries IN EXCLUSIVE MODE;

-- ----------------------------------------------------------------------------
-- 1. Versión de la fórmula por asiento
-- ----------------------------------------------------------------------------
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS hash_version smallint;
ALTER TABLE public.journal_entries DROP CONSTRAINT IF EXISTS journal_entries_hash_version_rango;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_hash_version_rango
  CHECK (hash_version IS NULL OR hash_version BETWEEN 1 AND 5);
COMMENT ON COLUMN public.journal_entries.hash_version IS
  'Versión de la fórmula del content_hash (072). 5 en todo asiento posteado desde la 072. NULL en los anteriores: su versión sale de accounting_hash_versions (tramos detectados una vez). Ver sop.md SOP-014.';

-- ----------------------------------------------------------------------------
-- 2. Tramos de las versiones viejas
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_hash_versions (
  tenant_id  uuid     NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version    smallint NOT NULL CHECK (version BETWEEN 1 AND 4),
  desde      bigint   NOT NULL,
  hasta      bigint   NOT NULL,
  detectado_el timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, version),
  CHECK (desde <= hasta)
);
ALTER TABLE public.accounting_hash_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_hash_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.accounting_hash_versions TO service_role;
COMMENT ON TABLE public.accounting_hash_versions IS
  'Tramos de entry_number por versión de la fórmula del content_hash para los asientos anteriores a la 072 (hash_version NULL). Sembrados por la 072 detectando qué fórmula reproduce cada asiento. Sólo lectura para la app.';

-- ----------------------------------------------------------------------------
-- 3. La v5: contenido canónico en JSON
-- ----------------------------------------------------------------------------
-- Montos con dos decimales y como TEXTO: el numeric de la línea temporal del
-- motor y el numeric(14,2) grabado dan la misma cadena ("10.00").
CREATE OR REPLACE FUNCTION public.finanzas_linea_v5(
  p_code text, p_debit numeric, p_credit numeric, p_descr text,
  p_client_id uuid, p_supplier_id uuid
) RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'cuenta',      p_code,
    'debito',      round(p_debit, 2)::text,
    'credito',     round(p_credit, 2)::text,
    'descripcion', p_descr,
    'cliente',     p_client_id::text,
    'proveedor',   p_supplier_id::text
  )
$$;

-- Los NULL van como JSON null y los textos escapados por jsonb: ningún valor
-- puede imitar a otro campo. `jsonb::text` es determinístico (claves ordenadas).
CREATE OR REPLACE FUNCTION public.finanzas_contenido_v5(
  p_tenant_id uuid, p_entry_number bigint, p_transaction_date date, p_record_date date,
  p_description text, p_source_type text, p_source_id uuid, p_source_cufe text,
  p_reverses_entry_id uuid, p_reversal_reason text, p_reference text,
  p_referencia_externa text, p_lineas jsonb
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'v',                  5,
    'tenant',             p_tenant_id::text,
    'numero',             p_entry_number::text,
    'fecha_registro',     p_transaction_date::text,
    'grabado_el',         p_record_date::text,
    'descripcion',        p_description,
    'origen',             p_source_type,
    'origen_id',          p_source_id::text,
    'cufe',               p_source_cufe,
    'revierte',           p_reverses_entry_id::text,
    'motivo',             p_reversal_reason,
    'referencia',         p_reference,
    'referencia_externa', p_referencia_externa,
    'lineas',             p_lineas
  )::text
$$;

-- ----------------------------------------------------------------------------
-- 4. El contenido de un asiento GRABADO, según su versión
-- ----------------------------------------------------------------------------
-- v1 (028) · v2 (039, + reference) · v3 (054, + tercero en la línea) ·
-- v4 (071, + referencia_externa) · v5 (072, JSON). Las cuatro primeras son
-- copias literales de las fórmulas históricas: no se "arreglan", porque los
-- asientos viejos se hashearon así.
CREATE OR REPLACE FUNCTION public.finanzas_contenido_de_asiento(p_entry_id uuid, p_version int)
RETURNS text
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  e         public.journal_entries%ROWTYPE;
  v_sin     text;
  v_con     text;
  v_json    jsonb;
BEGIN
  SELECT * INTO e FROM public.journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT string_agg(concat_ws(':', c.code, l.debit::text, l.credit::text, coalesce(l.line_description, '')),
                    '|' ORDER BY l.line_order),
         string_agg(concat_ws(':', c.code, l.debit::text, l.credit::text, coalesce(l.line_description, ''),
                              coalesce(l.client_id::text, ''), coalesce(l.supplier_id::text, '')),
                    '|' ORDER BY l.line_order),
         coalesce(jsonb_agg(public.finanzas_linea_v5(c.code, l.debit, l.credit, l.line_description,
                                                     l.client_id, l.supplier_id) ORDER BY l.line_order),
                  '[]'::jsonb)
    INTO v_sin, v_con, v_json
    FROM public.journal_entry_lines l
    JOIN public.chart_of_accounts c ON c.id = l.account_id
   WHERE l.entry_id = p_entry_id;

  IF p_version = 5 THEN
    RETURN public.finanzas_contenido_v5(
      e.tenant_id, e.entry_number, e.transaction_date, e.record_date, e.description,
      e.source_type, e.source_id, e.source_cufe, e.reverses_entry_id, e.reversal_reason,
      e.reference, e.referencia_externa, v_json);
  ELSIF p_version = 4 THEN
    RETURN concat_ws('|', e.tenant_id::text, e.entry_number::text, e.transaction_date::text,
      e.record_date::text, e.description, e.source_type, coalesce(e.source_id::text, ''),
      coalesce(e.source_cufe, ''), coalesce(e.reverses_entry_id::text, ''), coalesce(e.reversal_reason, ''),
      coalesce(e.reference, ''), coalesce(e.referencia_externa, ''), v_con);
  ELSIF p_version = 3 THEN
    RETURN concat_ws('|', e.tenant_id::text, e.entry_number::text, e.transaction_date::text,
      e.record_date::text, e.description, e.source_type, coalesce(e.source_id::text, ''),
      coalesce(e.source_cufe, ''), coalesce(e.reverses_entry_id::text, ''), coalesce(e.reversal_reason, ''),
      coalesce(e.reference, ''), v_con);
  ELSIF p_version = 2 THEN
    RETURN concat_ws('|', e.tenant_id::text, e.entry_number::text, e.transaction_date::text,
      e.record_date::text, e.description, e.source_type, coalesce(e.source_id::text, ''),
      coalesce(e.source_cufe, ''), coalesce(e.reverses_entry_id::text, ''), coalesce(e.reversal_reason, ''),
      coalesce(e.reference, ''), v_sin);
  ELSIF p_version = 1 THEN
    RETURN concat_ws('|', e.tenant_id::text, e.entry_number::text, e.transaction_date::text,
      e.record_date::text, e.description, e.source_type, coalesce(e.source_id::text, ''),
      coalesce(e.source_cufe, ''), coalesce(e.reverses_entry_id::text, ''), coalesce(e.reversal_reason, ''),
      v_sin);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.finanzas_hash_de_contenido(p_contenido text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT encode(sha256(convert_to(p_contenido, 'UTF8')), 'hex') $$;

-- ----------------------------------------------------------------------------
-- 2b. Sembrar los tramos (con el libro bloqueado)
-- ----------------------------------------------------------------------------
DO $sembrar$
DECLARE
  v_sin_version text;
  v_desorden    text;
  v_tramos      int;
BEGIN
  CREATE TEMP TABLE _072_version ON COMMIT DROP AS
  SELECT e.tenant_id, e.entry_number,
         CASE
           WHEN e.content_hash = public.finanzas_hash_de_contenido(public.finanzas_contenido_de_asiento(e.id, 4)) THEN 4
           WHEN e.content_hash = public.finanzas_hash_de_contenido(public.finanzas_contenido_de_asiento(e.id, 3)) THEN 3
           WHEN e.content_hash = public.finanzas_hash_de_contenido(public.finanzas_contenido_de_asiento(e.id, 2)) THEN 2
           WHEN e.content_hash = public.finanzas_hash_de_contenido(public.finanzas_contenido_de_asiento(e.id, 1)) THEN 1
         END::smallint AS version
    FROM public.journal_entries e
   WHERE e.hash_version IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.accounting_hash_versions h
                      WHERE h.tenant_id = e.tenant_id AND e.entry_number BETWEEN h.desde AND h.hasta);

  SELECT string_agg(format('%s/%s', tenant_id, entry_number), ', ' ORDER BY tenant_id, entry_number)
    INTO v_sin_version FROM pg_temp._072_version WHERE version IS NULL;
  IF v_sin_version IS NOT NULL THEN
    RAISE EXCEPTION '072: asientos que no reproduce NINGUNA fórmula (tenant/número): %. No se siembra nada: hay que entender por qué antes de seguir.', v_sin_version;
  END IF;

  SELECT string_agg(format('%s/%s', tenant_id, entry_number), ', ' ORDER BY tenant_id, entry_number)
    INTO v_desorden
    FROM (SELECT tenant_id, entry_number, version,
                 lag(version) OVER (PARTITION BY tenant_id ORDER BY entry_number) AS anterior
            FROM pg_temp._072_version) x
   WHERE anterior IS NOT NULL AND version < anterior;
  IF v_desorden IS NOT NULL THEN
    RAISE EXCEPTION '072: la versión de la fórmula retrocede en los asientos %. Los tramos no serían confiables.', v_desorden;
  END IF;

  INSERT INTO public.accounting_hash_versions (tenant_id, version, desde, hasta)
  SELECT tenant_id, version, min(entry_number), max(entry_number)
    FROM pg_temp._072_version
   GROUP BY tenant_id, version
  ON CONFLICT (tenant_id, version) DO NOTHING;
  GET DIAGNOSTICS v_tramos = ROW_COUNT;
  RAISE NOTICE '072 · % tramo(s) de versión sembrados', v_tramos;
END $sembrar$;

-- ----------------------------------------------------------------------------
-- 5. El motor calcula la v5 (parche verificado sobre la 071)
-- ----------------------------------------------------------------------------
DO $parche$
DECLARE
  c_fn CONSTANT text := 'public.post_journal_entry(uuid,date,text,text,jsonb,uuid,text,uuid,text,uuid,date,text,text,text)';
  v_def text;
  v_n   int;
BEGIN
  v_def := pg_get_functiondef(c_fn::regprocedure);
  IF position('finanzas_contenido_v5' IN v_def) > 0 THEN
    RAISE NOTICE '072 · el motor ya calculaba la v5';
    RETURN;
  END IF;

  -- (a) El bloque de las líneas en texto + el concat_ws de la v4 → la v5.
  v_n := regexp_count(v_def, E'SELECT string_agg\\(\\s*concat_ws\\('':'', code, debit::text.*?v_lineas_txt\\s*\\);');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '072: el bloque del contenido v4 aparece % vez/veces en el motor (se esperaba 1). No se toca nada.', v_n;
  END IF;
  v_def := regexp_replace(v_def,
    E'SELECT string_agg\\(\\s*concat_ws\\('':'', code, debit::text.*?v_lineas_txt\\s*\\);',
    E'-- 🔬 v5 (072): contenido canónico en JSON, sin separadores ambiguos. Es\n'
    '  -- la MISMA función con la que verify_accounting_chain lo recalcula. La\n'
    '  -- descripción va TAL COMO SE GRABA (btrim): hasta la v4 se hasheaba la del\n'
    '  -- parámetro y un espacio de más hacía irreproducible el asiento.\n'
    '  SELECT public.finanzas_contenido_v5(\n'
    '           p_tenant_id, v_next, p_transaction_date, v_record_date, btrim(p_description),\n'
    '           p_source_type, p_source_id, p_source_cufe, p_reverses_entry_id, p_reversal_reason,\n'
    '           v_reference, v_ref_ext,\n'
    '           coalesce(jsonb_agg(public.finanzas_linea_v5(code, debit, credit, descr, client_id, supplier_id)\n'
    '                              ORDER BY ord), ''[]''::jsonb))\n'
    '    INTO v_content\n'
    '    FROM pg_temp._pje_lineas;');

  -- (b) El INSERT graba la versión.
  v_n := regexp_count(v_def, E'reference, idempotency_key, referencia_externa\\s*\\) VALUES \\(');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '072: la lista de columnas del INSERT aparece % vez/veces (se esperaba 1).', v_n;
  END IF;
  v_def := regexp_replace(v_def, E'reference, idempotency_key, referencia_externa(\\s*)\\) VALUES \\(',
                          E'reference, idempotency_key, referencia_externa, hash_version\\1) VALUES (');
  v_n := regexp_count(v_def, E'v_ref_ext\\s*\\)\\s*RETURNING id INTO v_entry_id;');
  IF v_n <> 1 THEN
    RAISE EXCEPTION '072: el cierre de VALUES aparece % vez/veces (se esperaba 1).', v_n;
  END IF;
  v_def := regexp_replace(v_def, E'v_ref_ext(\\s*)\\)(\\s*)RETURNING id INTO v_entry_id;',
                          E'v_ref_ext,\\1 5\\1)\\2RETURNING id INTO v_entry_id;');

  EXECUTE v_def;
  RAISE NOTICE '072 · motor parchado: contenido v5 y hash_version = 5';
END $parche$;

COMMENT ON FUNCTION public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date, text, text, text) IS
  'ÚNICA vía para escribir en el ledger. SECURITY DEFINER y EXECUTE solo para service_role: NO valida el tenant, confía en p_tenant_id. Quien la llame DEBE sacar el tenant del usuario autenticado y nunca del cuerpo del request. Valida partida doble, resuelve el período, toma el correlativo sin huecos y encadena el hash, todo en UNA transacción. 071: referencia_externa, AD- propio y tercero obligatorio en las cuentas con cuenta_control (salvo reversiones). 072: content_hash v5 (JSON canónico, finanzas_contenido_v5, la misma función que recalcula el verificador) y hash_version = 5.';

-- ----------------------------------------------------------------------------
-- 6. El verificador v2: encadenamiento + contenido
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_accounting_chain(p_tenant_id uuid)
RETURNS TABLE (
  nro_asiento bigint,
  problema    text
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_esperado text := repeat('0', 64);
  v_version  int;
  r          record;
BEGIN
  FOR r IN
    SELECT je.id, je.entry_number, je.prev_hash, je.content_hash, je.hash, je.hash_version
      FROM public.journal_entries je
     WHERE je.tenant_id = p_tenant_id
     ORDER BY je.entry_number
  LOOP
    -- (1) El eslabón (030, sin cambios).
    IF r.prev_hash <> v_esperado THEN
      nro_asiento := r.entry_number;
      problema := format('prev_hash no coincide: esperado %s, encontrado %s', v_esperado, r.prev_hash);
      RETURN NEXT;
    END IF;

    IF r.hash <> encode(sha256(convert_to(r.prev_hash || r.content_hash, 'UTF8')), 'hex') THEN
      nro_asiento := r.entry_number;
      problema := 'hash no corresponde a prev_hash + content_hash';
      RETURN NEXT;
    END IF;

    -- (2) 072: el CONTENIDO, recalculado desde las columnas con la fórmula de
    --     la versión del asiento (la columna, o el tramo si es anterior).
    v_version := r.hash_version;
    IF v_version IS NULL THEN
      SELECT h.version INTO v_version
        FROM public.accounting_hash_versions h
       WHERE h.tenant_id = p_tenant_id AND r.entry_number BETWEEN h.desde AND h.hasta;
    END IF;

    IF v_version IS NULL THEN
      nro_asiento := r.entry_number;
      problema := 'sin versión de fórmula: no se puede recalcular el contenido';
      RETURN NEXT;
    ELSIF r.content_hash IS DISTINCT FROM public.finanzas_hash_de_contenido(
            public.finanzas_contenido_de_asiento(r.id, v_version)) THEN
      nro_asiento := r.entry_number;
      problema := format('contenido alterado: las columnas no reproducen el content_hash (fórmula v%s)', v_version);
      RETURN NEXT;
    END IF;

    v_esperado := r.hash;
  END LOOP;

  RETURN;
END $$;

COMMENT ON FUNCTION public.verify_accounting_chain(uuid) IS
  'Verifica el ledger de un bufete. Devuelve UNA FILA POR PROBLEMA (cero filas = íntegro): prev_hash que no encadena, hash que no corresponde, y desde la 072 el contenido recalculado desde las columnas con la fórmula de su versión (v1 a v5). No detecta una reescritura completa de la cadena: para eso hace falta un ancla externa.';

-- Permisos: las funciones de contenido no escriben, pero no son de la app.
REVOKE EXECUTE ON FUNCTION public.finanzas_contenido_de_asiento(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finanzas_contenido_de_asiento(uuid, int) TO service_role;
REVOKE EXECUTE ON FUNCTION public.verify_accounting_chain(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_accounting_chain(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Verificación
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_def  text;
  t      record;
  v_n    int;
  v_prob text;
BEGIN
  v_def := pg_get_functiondef('public.post_journal_entry(uuid,date,text,text,jsonb,uuid,text,uuid,text,uuid,date,text,text,text)'::regprocedure);
  IF position('finanzas_contenido_v5' IN v_def) = 0 OR position('hash_version' IN v_def) = 0 THEN
    RAISE EXCEPTION '072: el motor no quedó con la v5';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.post_journal_entry(uuid,date,text,text,jsonb,uuid,text,uuid,text,uuid,date,text,text,text)'::regprocedure) THEN
    RAISE EXCEPTION '072: el motor perdió SECURITY DEFINER';
  END IF;
  IF has_function_privilege('authenticated', 'public.post_journal_entry(uuid,date,text,text,jsonb,uuid,text,uuid,text,uuid,date,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '072: authenticated puede ejecutar el motor';
  END IF;

  -- 🔴 Sin falsos positivos: el verificador nuevo tiene que dar CERO problemas
  --    en todo bufete. Si no, se aborta: una alarma que suena siempre no sirve.
  FOR t IN SELECT id FROM public.tenants LOOP
    SELECT count(*), string_agg(format('%s: %s', nro_asiento, problema), '; ')
      INTO v_n, v_prob FROM public.verify_accounting_chain(t.id);
    IF v_n > 0 THEN
      RAISE EXCEPTION '072: el verificador encuentra % problema(s) en el bufete %: %', v_n, t.id, left(v_prob, 600);
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n FROM public.accounting_hash_versions;
  RAISE NOTICE '072 ✅ hash v5 en el motor, % tramo(s) de versiones viejas, verificador con recálculo y cero problemas en todos los bufetes', v_n;
END $$;

COMMIT;
