-- ============================================================================
-- 067 — IMPORTAR ASIENTOS DESDE EXCEL. Punto 7.5, aprobado el 25/09/2026
-- ============================================================================
-- Las reglas (Oliver):
--   · Vista previa obligatoria antes de contabilizar.
--   · TODO O NADA: si una sola fila tiene error, no se escribe nada.
--   · Cada importación queda con un identificador y se deshace COMPLETA con
--     reversiones fechadas hoy, sin borrar nada.
--
-- Qué hay acá:
--   · `journal_imports`: el lote (archivo, hash, conteos, estado).
--   · `journal_import_entries`: qué asientos son de qué lote.
--   · `post_journal_entries_batch`: postea TODOS los asientos del archivo en
--     UNA transacción, cada uno por `post_journal_entry`. Si uno falla (cuenta
--     inactiva, período cerrado, no cuadra), no queda ninguno, ni el lote, ni
--     números consumidos.
--   · `reverse_journal_import`: reversa cada asiento del lote por
--     `reverse_journal_entry` (055), que ya exige `source_type = 'manual'`,
--     fecha de hoy y el espejo exacto. Los que ya se reversaron uno por uno se
--     saltean. Una transacción.
--
-- 🔑 Los asientos importados son `source_type = 'manual'` (decisión del plan
--    del 25/09): no se toca el CHECK de source_type, el filtro de la 055, la
--    antigüedad ni el Diario. Lo que los distingue es su fila en
--    `journal_import_entries`.
-- 🔑 Idempotencia: UNIQUE parcial por (tenant, file_hash) mientras el lote está
--    contabilizado. Reversar el lote libera el hash (se puede reimportar
--    corregido).
-- 🔑 Ninguno de los dos RPC es ejecutable por la sesión (SOP-014).
--
-- IDEMPOTENCIA: IF NOT EXISTS / CREATE OR REPLACE.
-- 🛑 SOLO STAGING. Depende de 039 (idempotency_key), 054 (motor), 055.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.journal_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  file_hash       text NOT NULL,
  rows_count      integer NOT NULL,
  entries_count   integer NOT NULL,
  total_debits    numeric(14,2) NOT NULL,
  status          text NOT NULL DEFAULT 'contabilizada',
  reversal_reason text NULL,
  reversed_at     timestamptz NULL,
  reversed_by     uuid NULL REFERENCES public.users(id),
  created_by      uuid NULL REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ji_status_check CHECK (status IN ('contabilizada', 'reversada')),
  CONSTRAINT ji_reversion_completa CHECK (
    (status = 'reversada' AND reversed_at IS NOT NULL AND char_length(btrim(coalesce(reversal_reason, ''))) >= 3)
    OR (status = 'contabilizada' AND reversed_at IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ji_hash_contabilizado
  ON public.journal_imports (tenant_id, file_hash) WHERE status = 'contabilizada';

CREATE TABLE IF NOT EXISTS public.journal_import_entries (
  import_id    uuid NOT NULL REFERENCES public.journal_imports(id),
  entry_id     uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  group_label  text NOT NULL,
  first_row    integer NOT NULL,
  orden        integer NOT NULL,
  PRIMARY KEY (import_id, entry_id)
);

ALTER TABLE public.journal_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_import_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ji_lectura ON public.journal_imports;
CREATE POLICY ji_lectura ON public.journal_imports FOR SELECT USING (tenant_id = get_tenant_id());
DROP POLICY IF EXISTS jie_lectura ON public.journal_import_entries;
CREATE POLICY jie_lectura ON public.journal_import_entries FOR SELECT USING (tenant_id = get_tenant_id());

-- Sin DELETE nunca; el lote sólo pasa de contabilizada a reversada.
CREATE OR REPLACE FUNCTION public.finanzas_ji_inmutable()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Una importación de asientos no se borra: se reversa.' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.file_name, NEW.file_hash, NEW.rows_count, NEW.entries_count, NEW.total_debits, NEW.tenant_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.file_name, OLD.file_hash, OLD.rows_count, OLD.entries_count, OLD.total_debits, OLD.tenant_id, OLD.created_by, OLD.created_at)
     OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'contabilizada' AND NEW.status = 'reversada')) THEN
    RAISE EXCEPTION 'Una importación de asientos sólo puede pasar de contabilizada a reversada.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_ji_inmutable ON public.journal_imports;
CREATE TRIGGER trg_ji_inmutable BEFORE UPDATE OR DELETE ON public.journal_imports
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_ji_inmutable();

CREATE OR REPLACE FUNCTION public.finanzas_jie_inmutable()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'El vínculo entre una importación y sus asientos no se modifica.' USING ERRCODE = 'check_violation';
END $fn$;
DROP TRIGGER IF EXISTS trg_jie_inmutable ON public.journal_import_entries;
CREATE TRIGGER trg_jie_inmutable BEFORE UPDATE OR DELETE ON public.journal_import_entries
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_jie_inmutable();

-- ── Contabilizar el lote: UNA transacción ──────────────────────────────────
-- p_entries: [{group_label, first_row, transaction_date, description,
--              reference, lines:[{account_code, debit, credit, description}]}]
CREATE OR REPLACE FUNCTION public.post_journal_entries_batch(
  p_tenant_id  uuid,
  p_file_name  text,
  p_file_hash  text,
  p_rows_count integer,
  p_entries    jsonb,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_import_id uuid;
  v_e         jsonb;
  v_n         int := 0;
  v_total     numeric(14,2) := 0;
  v_entry_id  uuid;
  v_numeros   jsonb := '[]'::jsonb;
  v_nro       bigint;
BEGIN
  IF p_tenant_id IS NULL OR coalesce(char_length(btrim(p_file_hash)), 0) = 0 THEN
    RAISE EXCEPTION 'post_journal_entries_batch: faltan el tenant o el hash del archivo';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'El archivo no tiene asientos para contabilizar.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.journal_imports
              WHERE tenant_id = p_tenant_id AND file_hash = p_file_hash AND status = 'contabilizada') THEN
    RAISE EXCEPTION 'Este archivo ya se importó y sigue contabilizado. Si hay que corregirlo, primero deshaz esa importación.';
  END IF;

  SELECT coalesce(sum((l->>'debit')::numeric), 0) INTO v_total
    FROM jsonb_array_elements(p_entries) e, jsonb_array_elements(e->'lines') l;

  INSERT INTO public.journal_imports (tenant_id, file_name, file_hash, rows_count, entries_count, total_debits, created_by)
  VALUES (p_tenant_id, left(btrim(coalesce(p_file_name, 'archivo.xlsx')), 200), p_file_hash, coalesce(p_rows_count, 0),
          jsonb_array_length(p_entries), v_total, p_created_by)
  RETURNING id INTO v_import_id;

  FOR v_e IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_n := v_n + 1;
    -- Cada asiento pasa por el motor, con TODAS sus validaciones (cuadre,
    -- cuentas activas, período abierto). Si uno falla, falla el lote entero.
    v_entry_id := public.post_journal_entry(
      p_tenant_id,
      (v_e->>'transaction_date')::date,
      v_e->>'description',
      'manual',
      v_e->'lines',
      NULL, NULL, NULL, NULL,
      p_created_by,
      NULL,
      nullif(btrim(coalesce(v_e->>'reference', '')), ''),
      'imp:' || v_import_id::text || ':' || v_n::text
    );
    INSERT INTO public.journal_import_entries (import_id, entry_id, tenant_id, group_label, first_row, orden)
    VALUES (v_import_id, v_entry_id, p_tenant_id, coalesce(v_e->>'group_label', v_n::text),
            coalesce((v_e->>'first_row')::int, 0), v_n);
    SELECT entry_number INTO v_nro FROM public.journal_entries WHERE id = v_entry_id;
    v_numeros := v_numeros || to_jsonb(v_nro);
  END LOOP;

  RETURN jsonb_build_object('import_id', v_import_id, 'entries', v_n, 'total_debits', v_total, 'entry_numbers', v_numeros);
END $fn$;

-- ── Deshacer el lote: reversar cada asiento, UNA transacción ───────────────
-- p_mirrors: [{entry_id, description, lines}] armados por la app con
-- `construirAsientoDeReversion` (la misma función de todas las reversiones).
CREATE OR REPLACE FUNCTION public.reverse_journal_import(
  p_tenant_id        uuid,
  p_import_id        uuid,
  p_reason           text,
  p_transaction_date date,
  p_mirrors          jsonb,
  p_created_by       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_status   text;
  r          record;
  v_m        jsonb;
  v_hechas   int := 0;
  v_saltadas int := 0;
BEGIN
  IF coalesce(char_length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'Deshacer una importación necesita un motivo de al menos 3 caracteres.';
  END IF;
  SELECT status INTO v_status FROM public.journal_imports
   WHERE tenant_id = p_tenant_id AND id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Importación no encontrada.';
  END IF;
  IF v_status <> 'contabilizada' THEN
    RAISE EXCEPTION 'Esta importación ya se deshizo.';
  END IF;

  FOR r IN
    SELECT e.entry_id, je.entry_number
      FROM public.journal_import_entries e
      JOIN public.journal_entries je ON je.id = e.entry_id
     WHERE e.import_id = p_import_id
     ORDER BY e.orden DESC
  LOOP
    -- Ya reversado uno por uno: se saltea (el índice de la 055 lo sostiene).
    IF EXISTS (SELECT 1 FROM public.journal_entries WHERE tenant_id = p_tenant_id AND reverses_entry_id = r.entry_id) THEN
      v_saltadas := v_saltadas + 1;
      CONTINUE;
    END IF;
    SELECT m INTO v_m FROM jsonb_array_elements(p_mirrors) m WHERE (m->>'entry_id')::uuid = r.entry_id;
    IF v_m IS NULL THEN
      RAISE EXCEPTION 'Falta el espejo del asiento %: no se deshizo nada.', r.entry_number;
    END IF;
    -- `reverse_journal_entry` exige manual, fecha de hoy y el espejo EXACTO.
    PERFORM public.reverse_journal_entry(
      p_tenant_id, r.entry_id, btrim(p_reason), p_transaction_date,
      v_m->>'description', v_m->'lines', p_created_by
    );
    v_hechas := v_hechas + 1;
  END LOOP;

  UPDATE public.journal_imports
     SET status = 'reversada', reversal_reason = btrim(p_reason), reversed_at = now(), reversed_by = p_created_by
   WHERE id = p_import_id;

  RETURN jsonb_build_object('reversados', v_hechas, 'ya_reversados', v_saltadas);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.post_journal_entries_batch(uuid, text, text, integer, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_journal_entries_batch(uuid, text, text, integer, jsonb, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.reverse_journal_import(uuid, uuid, text, date, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_journal_import(uuid, uuid, text, date, jsonb, uuid) TO service_role;

COMMIT;

DO $$
BEGIN
  IF to_regclass('public.journal_imports') IS NULL OR to_regclass('public.journal_import_entries') IS NULL THEN
    RAISE EXCEPTION '067: faltan las tablas';
  END IF;
  IF has_function_privilege('authenticated', 'public.post_journal_entries_batch(uuid, text, text, integer, jsonb, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reverse_journal_import(uuid, uuid, text, date, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '067: authenticated puede ejecutar los RPC de importación';
  END IF;
  RAISE NOTICE '067 ✅ importación de asientos: lote, vínculo, alta en una transacción y reversión del lote';
END $$;
