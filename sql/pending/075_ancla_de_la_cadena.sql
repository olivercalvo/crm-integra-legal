-- ============================================================================
-- 075 — EL ANCLA EXTERNA DE LA CADENA (R-1b)
-- ============================================================================
-- 01/10/2026. Plan: `docs/finanzas/plan-bloque1.md` §8, R-1b (Oliver: "al
-- cerrar cada mes se guarda el número y el hash del último asiento, sale de la
-- base en el respaldo y en la pantalla de cierre, y una función compara esas
-- anclas contra la cadena").
--
-- POR QUÉ: la 072 detecta una fila alterada y un eslabón roto, pero no a quien
-- REESCRIBA la cadena entera desde un asiento en adelante (contenido,
-- content_hash, hash y todos los prev_hash siguientes): queda coherente consigo
-- misma. Contra eso sólo sirve comparar con un hash anotado ANTES y FUERA.
--
-- Qué hace:
--   1. `accounting_chain_anchors`: (bufete, período, último asiento, su hash,
--      cuándo, quién, origen). INMUTABLE: sin UPDATE ni DELETE (calco de la 023).
--      Ni la app ni service_role la escriben directo.
--   2. Trigger en `accounting_periods`: cuando un período pasa de `abierto` a
--      `cerrado`, en la MISMA transacción se graba el ancla con el asiento más
--      alto del bufete en ese momento (la cadena se ordena por número, no por
--      fecha). La ruta de cierre no cambia; si el ancla falla, el cierre falla.
--   3. Un ancla INICIAL por bufete al aplicar la migración (origen 'inicial'),
--      para no arrancar sin ninguna: los meses ya cerrados (agosto en staging)
--      no la tuvieron al cerrarse.
--   4. `verify_chain_anchors(tenant, anclas jsonb)`: compara anclas contra la
--      cadena. Con `anclas` = la lista de AFUERA (el JSON del respaldo, o lo que
--      dicte el contador desde su constancia) es la verificación que importa;
--      sin ella usa las de la tabla.
--
-- DÓNDE QUEDAN AFUERA (sin código nuevo de este lado):
--   · El respaldo diario (`scripts/backup-supabase.mjs`, tarea de Windows) baja
--     TODAS las tablas expuestas por la API: la tabla de anclas entra sola en
--     `tablas/accounting_chain_anchors.json` de cada día.
--   · La constancia PDF del cierre, que baja el contador desde /finanzas/periodos.
--
-- 🔴 NO SE TOCA EL LIBRO: sólo se LEE el último asiento.
-- IDEMPOTENCIA: IF NOT EXISTS, CREATE OR REPLACE, el ancla inicial sólo si el
--               bufete no tiene ninguna.
-- 🛑 SOLO STAGING hasta la ventana del despliegue. Depende de la 072.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. La tabla
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_chain_anchors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_id    uuid NULL REFERENCES public.accounting_periods(id),
  year         int  NULL,
  month        int  NULL,
  entry_number bigint NOT NULL,
  hash         text NOT NULL,
  origen       text NOT NULL CHECK (origen IN ('cierre', 'inicial')),
  anchored_at  timestamptz NOT NULL DEFAULT now(),
  anchored_by  uuid NULL REFERENCES public.users(id),
  CHECK (entry_number >= 0),
  CHECK (char_length(hash) = 64),
  CHECK ((origen = 'cierre') = (period_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS accounting_chain_anchors_tenant
  ON public.accounting_chain_anchors (tenant_id, anchored_at);

COMMENT ON TABLE public.accounting_chain_anchors IS
  'Anclas de la cadena del libro (075, R-1b): el último asiento y su hash al cerrar cada período. Inmutable. Sale de la base en el respaldo diario y en la constancia PDF del cierre; verify_chain_anchors las compara contra la cadena para detectar una reescritura completa.';

ALTER TABLE public.accounting_chain_anchors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_chain_anchors_tenant_select ON public.accounting_chain_anchors;
CREATE POLICY accounting_chain_anchors_tenant_select ON public.accounting_chain_anchors
  FOR SELECT USING (tenant_id = public.get_tenant_id());
REVOKE ALL ON public.accounting_chain_anchors FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.accounting_chain_anchors TO authenticated, service_role;

-- Inmutable: ni UPDATE ni DELETE, ni siquiera con los permisos del dueño.
CREATE OR REPLACE FUNCTION public.finanzas_ancla_inmutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Un ancla de la cadena no se modifica ni se borra.'
    USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS trg_ancla_no_update ON public.accounting_chain_anchors;
CREATE TRIGGER trg_ancla_no_update BEFORE UPDATE ON public.accounting_chain_anchors
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_ancla_inmutable();
DROP TRIGGER IF EXISTS trg_ancla_no_delete ON public.accounting_chain_anchors;
CREATE TRIGGER trg_ancla_no_delete BEFORE DELETE ON public.accounting_chain_anchors
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_ancla_inmutable();

-- ----------------------------------------------------------------------------
-- 2. El ancla al cerrar un período
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finanzas_anclar_al_cerrar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nro  bigint;
  v_hash text;
BEGIN
  IF OLD.status = 'abierto' AND NEW.status = 'cerrado' THEN
    SELECT entry_number, hash INTO v_nro, v_hash
      FROM public.journal_entries
     WHERE tenant_id = NEW.tenant_id
     ORDER BY entry_number DESC
     LIMIT 1;
    INSERT INTO public.accounting_chain_anchors
      (tenant_id, period_id, year, month, entry_number, hash, origen, anchored_by)
    VALUES (NEW.tenant_id, NEW.id, NEW.year, NEW.month,
            coalesce(v_nro, 0), coalesce(v_hash, repeat('0', 64)), 'cierre', NEW.closed_by);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_periodo_anclar_al_cerrar ON public.accounting_periods;
CREATE TRIGGER trg_periodo_anclar_al_cerrar
  AFTER UPDATE OF status ON public.accounting_periods
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_anclar_al_cerrar();

-- ----------------------------------------------------------------------------
-- 3. El ancla inicial
-- ----------------------------------------------------------------------------
INSERT INTO public.accounting_chain_anchors (tenant_id, entry_number, hash, origen)
SELECT t.id,
       coalesce(u.entry_number, 0),
       coalesce(u.hash, repeat('0', 64)),
       'inicial'
  FROM public.tenants t
  LEFT JOIN LATERAL (
    SELECT entry_number, hash FROM public.journal_entries
     WHERE tenant_id = t.id ORDER BY entry_number DESC LIMIT 1
  ) u ON true
 WHERE NOT EXISTS (SELECT 1 FROM public.accounting_chain_anchors a WHERE a.tenant_id = t.id);

-- ----------------------------------------------------------------------------
-- 4. La comparación
-- ----------------------------------------------------------------------------
-- p_anclas: [{entry_number, hash}] traídas de AFUERA. NULL = las de la tabla.
CREATE OR REPLACE FUNCTION public.verify_chain_anchors(p_tenant_id uuid, p_anclas jsonb DEFAULT NULL)
RETURNS TABLE (nro_asiento bigint, problema text)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  r      record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT x.nro, x.hash
      FROM (
        SELECT (a->>'entry_number')::bigint AS nro, a->>'hash' AS hash
          FROM jsonb_array_elements(coalesce(p_anclas, '[]'::jsonb)) a
         WHERE p_anclas IS NOT NULL
        UNION ALL
        SELECT entry_number, hash FROM public.accounting_chain_anchors
         WHERE p_anclas IS NULL AND tenant_id = p_tenant_id
      ) x
     ORDER BY x.nro
  LOOP
    IF r.nro = 0 THEN
      CONTINUE;  -- el ancla de un libro vacío no ancla nada
    END IF;
    SELECT hash INTO v_hash FROM public.journal_entries
     WHERE tenant_id = p_tenant_id AND entry_number = r.nro;
    IF NOT FOUND THEN
      nro_asiento := r.nro;
      problema := 'el asiento anclado ya no existe en el libro';
      RETURN NEXT;
    ELSIF v_hash IS DISTINCT FROM r.hash THEN
      nro_asiento := r.nro;
      problema := format('el hash del asiento no coincide con el ancla (ancla %s…, libro %s…): la cadena se reescribió desde antes de este asiento',
                         left(r.hash, 12), left(v_hash, 12));
      RETURN NEXT;
    END IF;
  END LOOP;
  RETURN;
END $$;

COMMENT ON FUNCTION public.verify_chain_anchors(uuid, jsonb) IS
  'Compara anclas (número + hash) contra la cadena del libro: una fila por problema, cero filas = coincide. Con p_anclas = la lista traída de afuera (respaldo, constancia del contador) detecta una reescritura completa; con NULL usa las de accounting_chain_anchors.';

REVOKE EXECUTE ON FUNCTION public.verify_chain_anchors(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_chain_anchors(uuid, jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Verificación
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_n int;
  -- No se llama `t`: chocaría con el alias de la consulta de abajo.
  r_bufete record;
BEGIN
  SELECT count(*) INTO v_n FROM public.tenants tn
   WHERE NOT EXISTS (SELECT 1 FROM public.accounting_chain_anchors a WHERE a.tenant_id = tn.id);
  IF v_n > 0 THEN
    RAISE EXCEPTION '075: % bufete(s) sin ancla inicial', v_n;
  END IF;
  FOR r_bufete IN SELECT id FROM public.tenants LOOP
    SELECT count(*) INTO v_n FROM public.verify_chain_anchors(r_bufete.id, NULL);
    IF v_n > 0 THEN
      RAISE EXCEPTION '075: las anclas del bufete % no coinciden recién creadas', r_bufete.id;
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.accounting_chain_anchors', 'INSERT') THEN
    RAISE EXCEPTION '075: service_role puede escribir anclas a mano';
  END IF;
  SELECT count(*) INTO v_n FROM public.accounting_chain_anchors;
  RAISE NOTICE '075 ✅ % ancla(s); se ancla al cerrar cada período; verify_chain_anchors lista', v_n;
END $$;

COMMIT;
