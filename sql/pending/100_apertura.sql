-- ============================================================================
-- 100 · Asiento de APERTURA (saldos iniciales)
-- ============================================================================
-- Diseño aprobado por Oliver el 07/10/2026. Los saldos al corte salen de los
-- libros del contador (QuickBooks) y entran al libro como UN asiento
-- `source_type = 'apertura'`, una sola vez por bufete (vigente).
--
-- Qué deja:
--   1. finanzas_parametros.fecha_apertura (NULL = el día anterior al inicio
--      contable). La decide Josuarth: 30/06/2026 o 31/12/2025. Siempre ANTERIOR
--      al inicio contable (CHECK), y no cambia con una apertura vigente.
--      finanzas_fecha_apertura(tenant) es la fecha efectiva.
--   2. aperturas: una fila por apertura (vigente | reversada), con el archivo y
--      su hash. Índice único parcial: UNA vigente por bufete.
--   3. apertura_partidas: el detalle de cada línea con tercero (documento
--      externo, fecha del documento, vencimiento). Lo lee la antigüedad, para
--      contar cada documento con su fecha y no una sola partida por tercero.
--      Inmutable (como el libro).
--   4. post_apertura(tenant, descripción, líneas, archivo, hash, usuario):
--      SECURITY DEFINER, EXECUTE sólo service_role. En UNA transacción:
--        · candado del correlativo del libro (el mismo de post_journal_entry);
--        · ninguna otra apertura vigente;
--        · la fecha es la efectiva del parámetro, anterior al inicio contable;
--        · crea los períodos del año si faltan (2025 no existe) y exige el mes
--          ABIERTO (lo vuelve a exigir post_journal_entry);
--        · al 31/12 (cierre del año fiscal) sólo cuentas de balance: el
--          resultado del año ya está en 300002;
--        · líneas de cuentas control (100004 / 200001) con documento externo y
--          fecha del documento no posterior a la apertura; el tercero lo exige
--          post_journal_entry (071) y que no sea de prueba, la 095;
--        · postea por post_journal_entry ('apertura': el número AD- lo pone el
--          motor) y guarda las partidas.
--   5. chart_of_accounts.saldo_inicial en SÓLO LECTURA desde la primera apertura
--      (vigente o reversada): desde ahí los reportes dejan de sumarlo (la app,
--      `aperturaRegistrada`), y cambiarlo no movería nada pero confundiría.
--
-- Con la 096: su respaldo en el libro sólo mira asientos de DOCUMENTOS; la
-- apertura entra aunque su fecha sea anterior al inicio contable (es su razón
-- de ser). Con la 097/098/099: no es una importación (no pasa por
-- journal_import_entries), así que ni bloquea ni la bloquea el posteo de
-- documentos ni la importación; y su mes es anterior al inicio.
--
-- Bitácora: la apertura y su reversión son asientos (journal_entries ya se
-- captura, con el motivo de la reversión). Las dos tablas nuevas no llevan
-- trigger de bitácora: las escribe sólo post_apertura / la reversión (101).
--
-- No toca datos. Va en la ventana del Bloque 1, aplicada y sin usar.
-- 🛡️ Escrita, SIN APLICAR en staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

-- ── 1. La fecha de la apertura: un parámetro ───────────────────────────────
ALTER TABLE public.finanzas_parametros
  ADD COLUMN IF NOT EXISTS fecha_apertura date NULL;
ALTER TABLE public.finanzas_parametros DROP CONSTRAINT IF EXISTS finanzas_parametros_apertura_antes_del_inicio;
ALTER TABLE public.finanzas_parametros
  ADD CONSTRAINT finanzas_parametros_apertura_antes_del_inicio
  CHECK (fecha_apertura IS NULL OR fecha_inicio_contable IS NULL OR fecha_apertura < fecha_inicio_contable);
COMMENT ON COLUMN public.finanzas_parametros.fecha_apertura IS
  'Fecha del asiento de apertura (100). NULL = el día anterior al inicio contable. Siempre anterior al inicio.';

CREATE OR REPLACE FUNCTION public.finanzas_fecha_apertura(p_tenant_id uuid)
RETURNS date
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT fp.fecha_apertura FROM public.finanzas_parametros fp WHERE fp.tenant_id = p_tenant_id),
    public.finanzas_inicio_contable(p_tenant_id) - 1
  );
$$;

-- ── 2 y 3. Las tablas ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aperturas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id          uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  fecha             date NOT NULL,
  file_name         text NOT NULL,
  file_hash         text NOT NULL,
  lineas            integer NOT NULL,
  total_debitos     numeric(14,2) NOT NULL,
  estado            text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'reversada')),
  created_by        uuid NULL REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  reversal_entry_id uuid NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  motivo_reversion  text NULL,
  reversed_by       uuid NULL REFERENCES public.users(id),
  reversed_at       timestamptz NULL,
  CONSTRAINT aperturas_reversada_completa CHECK (
    (estado = 'vigente' AND reversal_entry_id IS NULL AND motivo_reversion IS NULL)
    OR (estado = 'reversada' AND reversal_entry_id IS NOT NULL AND motivo_reversion IS NOT NULL AND reversed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS aperturas_una_vigente ON public.aperturas (tenant_id) WHERE estado = 'vigente';
COMMENT ON TABLE public.aperturas IS
  'Asiento de apertura (100): una vigente por bufete. La escribe post_apertura; la reversión (101) la marca reversada.';

CREATE TABLE IF NOT EXISTS public.apertura_partidas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  apertura_id       uuid NOT NULL REFERENCES public.aperturas(id) ON DELETE RESTRICT,
  entry_id          uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  line_order        integer NOT NULL,
  account_code      text NOT NULL,
  client_id         uuid NULL REFERENCES public.clients(id),
  supplier_id       uuid NULL REFERENCES public.suppliers(id),
  documento_externo text NULL,
  fecha_documento   date NULL,
  vencimiento       date NULL,
  debit             numeric(14,2) NOT NULL DEFAULT 0,
  credit            numeric(14,2) NOT NULL DEFAULT 0,
  CONSTRAINT apertura_partidas_un_tercero CHECK (num_nonnulls(client_id, supplier_id) <= 1),
  CONSTRAINT apertura_partidas_una_linea UNIQUE (entry_id, line_order)
);
CREATE INDEX IF NOT EXISTS apertura_partidas_tenant ON public.apertura_partidas (tenant_id, apertura_id);

ALTER TABLE public.aperturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apertura_partidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aperturas_select ON public.aperturas;
CREATE POLICY aperturas_select ON public.aperturas
  FOR SELECT USING (tenant_id = public.get_tenant_id() AND public.get_user_role() IN ('admin', 'abogada', 'contador'));
DROP POLICY IF EXISTS apertura_partidas_select ON public.apertura_partidas;
CREATE POLICY apertura_partidas_select ON public.apertura_partidas
  FOR SELECT USING (tenant_id = public.get_tenant_id() AND public.get_user_role() IN ('admin', 'abogada', 'contador'));
-- Sin políticas de escritura: sólo las funciones (service_role) escriben.

-- Las partidas son inmutables; una apertura no se borra y sólo pasa de vigente
-- a reversada (con su reversión).
CREATE OR REPLACE FUNCTION public.finanzas_apertura_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'La apertura no se borra: se reversa.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'apertura_partidas' THEN
    RAISE EXCEPTION 'Las partidas de la apertura no se editan: se reversa la apertura y se carga otra.'
      USING ERRCODE = 'check_violation';
  END IF;
  -- aperturas: sólo vigente → reversada, sin tocar lo demás.
  IF OLD.estado <> 'vigente' OR NEW.estado <> 'reversada'
     OR NEW.entry_id IS DISTINCT FROM OLD.entry_id OR NEW.fecha IS DISTINCT FROM OLD.fecha
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.file_hash IS DISTINCT FROM OLD.file_hash
     OR NEW.total_debitos IS DISTINCT FROM OLD.total_debitos THEN
    RAISE EXCEPTION 'Una apertura sólo pasa de vigente a reversada.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_apertura_inmutable ON public.aperturas;
CREATE TRIGGER trg_apertura_inmutable BEFORE UPDATE OR DELETE ON public.aperturas
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_apertura_inmutable();
DROP TRIGGER IF EXISTS trg_apertura_inmutable ON public.apertura_partidas;
CREATE TRIGGER trg_apertura_inmutable BEFORE UPDATE OR DELETE ON public.apertura_partidas
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_apertura_inmutable();

-- La fecha de la apertura no cambia con una apertura vigente.
CREATE OR REPLACE FUNCTION public.finanzas_fecha_apertura_fija()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fecha date;
BEGIN
  IF NEW.fecha_apertura IS DISTINCT FROM OLD.fecha_apertura
     OR NEW.fecha_inicio_contable IS DISTINCT FROM OLD.fecha_inicio_contable THEN
    SELECT a.fecha INTO v_fecha FROM public.aperturas a WHERE a.tenant_id = NEW.tenant_id AND a.estado = 'vigente';
    IF v_fecha IS NOT NULL AND coalesce(NEW.fecha_apertura, NEW.fecha_inicio_contable - 1) <> v_fecha THEN
      RAISE EXCEPTION 'Hay una apertura vigente al %: su fecha no cambia. Para cambiarla, primero se reversa la apertura.',
        to_char(v_fecha, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_fecha_apertura_fija ON public.finanzas_parametros;
CREATE TRIGGER trg_fecha_apertura_fija BEFORE UPDATE ON public.finanzas_parametros
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_fecha_apertura_fija();

-- ── 5. saldo_inicial en sólo lectura desde la primera apertura ─────────────
CREATE OR REPLACE FUNCTION public.finanzas_saldo_inicial_con_apertura()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND coalesce(NEW.saldo_inicial, 0) <> 0)
     OR (TG_OP = 'UPDATE' AND (NEW.saldo_inicial IS DISTINCT FROM OLD.saldo_inicial
                               OR NEW.saldo_inicial_fecha IS DISTINCT FROM OLD.saldo_inicial_fecha)) THEN
    IF EXISTS (SELECT 1 FROM public.aperturas a WHERE a.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'El bufete ya tiene un asiento de apertura: el saldo inicial de las cuentas ya no se usa ni se edita. Los saldos al corte están en la apertura.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_saldo_inicial_con_apertura ON public.chart_of_accounts;
CREATE TRIGGER trg_saldo_inicial_con_apertura BEFORE INSERT OR UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_saldo_inicial_con_apertura();

-- ── 4. post_apertura ───────────────────────────────────────────────────────
-- p_lines: array de { account_code, debit, credit, description, client_id,
--   supplier_id, documento_externo, fecha_documento, vencimiento }, en el orden
--   de la plantilla. Lo arma y lo valida antes la app (apertura.ts); acá se
--   vuelve a exigir lo que sostiene el libro.
CREATE OR REPLACE FUNCTION public.post_apertura(
  p_tenant_id   uuid,
  p_description text,
  p_lines       jsonb,
  p_file_name   text,
  p_file_hash   text,
  p_created_by  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fecha     date;
  v_inicio    date;
  v_vigente   uuid;
  v_status    text;
  v_cierre    boolean;
  v_txt       text;
  v_lines     jsonb;
  v_total     numeric(14,2);
  v_entry     uuid;
  v_nro       bigint;
  v_ref       text;
  v_apertura  uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'post_apertura: falta el tenant';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'La apertura necesita al menos dos líneas.';
  END IF;
  IF coalesce(btrim(p_file_hash), '') = '' OR coalesce(btrim(p_file_name), '') = '' THEN
    RAISE EXCEPTION 'post_apertura: faltan el archivo y su hash (la vista previa).';
  END IF;

  -- El candado del correlativo, antes de mirar nada (orden J → A de la 090).
  INSERT INTO public.accounting_sequences (tenant_id, sequence_type, last_number)
  VALUES (p_tenant_id, 'journal_entry', 0)
  ON CONFLICT (tenant_id, sequence_type) DO NOTHING;
  PERFORM 1 FROM public.accounting_sequences
   WHERE tenant_id = p_tenant_id AND sequence_type = 'journal_entry'
     FOR UPDATE;

  SELECT a.id INTO v_vigente FROM public.aperturas a WHERE a.tenant_id = p_tenant_id AND a.estado = 'vigente';
  IF v_vigente IS NOT NULL THEN
    RAISE EXCEPTION 'El bufete ya tiene una apertura vigente. Para cargar otra, primero se reversa la que está.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_fecha  := public.finanzas_fecha_apertura(p_tenant_id);
  v_inicio := public.finanzas_inicio_contable(p_tenant_id);
  IF v_fecha >= v_inicio THEN
    RAISE EXCEPTION 'La fecha de la apertura (%) tiene que ser anterior al inicio contable (%).',
      to_char(v_fecha, 'DD/MM/YYYY'), to_char(v_inicio, 'DD/MM/YYYY');
  END IF;

  -- El período: se crea si falta (el motor sólo crea el año en curso y el
  -- siguiente) y tiene que estar ABIERTO.
  PERFORM public.ensure_accounting_periods(p_tenant_id, extract(year FROM v_fecha)::int);
  SELECT status INTO v_status FROM public.accounting_periods
   WHERE tenant_id = p_tenant_id AND year = extract(year FROM v_fecha)::int AND month = extract(month FROM v_fecha)::int;
  IF v_status IS DISTINCT FROM 'abierto' THEN
    RAISE EXCEPTION 'El período % está cerrado: la apertura no entra. Se reabre en Períodos contables.',
      to_char(v_fecha, 'MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;

  -- Al cierre del año fiscal, sólo cuentas de balance.
  v_cierre := extract(month FROM v_fecha) = 12 AND extract(day FROM v_fecha) = 31;
  IF v_cierre THEN
    SELECT string_agg(DISTINCT c.code, ', ') INTO v_txt
      FROM jsonb_array_elements(p_lines) x
      JOIN public.chart_of_accounts c ON c.tenant_id = p_tenant_id AND c.code = btrim(x->>'account_code')
     WHERE c.account_type IN ('income', 'cost', 'expense');
    IF v_txt IS NOT NULL THEN
      RAISE EXCEPTION 'Una apertura al % (cierre del año) lleva sólo cuentas de balance; el resultado del año va en resultados acumulados. Sobran: %.',
        to_char(v_fecha, 'DD/MM/YYYY'), v_txt USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Las líneas de cuentas control: con documento y con fecha no posterior.
  SELECT string_agg(format('línea %s (%s)', x.n, btrim(x.l->>'account_code')), ', ') INTO v_txt
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS x(l, n)
    JOIN public.chart_of_accounts c ON c.tenant_id = p_tenant_id AND c.code = btrim(x.l->>'account_code')
   WHERE c.cuenta_control IS NOT NULL
     AND (coalesce(btrim(x.l->>'documento_externo'), '') = '' OR nullif(x.l->>'fecha_documento', '') IS NULL
          OR (x.l->>'fecha_documento')::date > v_fecha);
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'Las líneas de cuentas por cobrar o por pagar llevan documento externo y una fecha del documento no posterior a la apertura: %.',
      v_txt USING ERRCODE = 'check_violation';
  END IF;

  -- Al motor van sólo las columnas del libro.
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'account_code', btrim(l->>'account_code'),
           'debit',        round(coalesce((l->>'debit')::numeric, 0), 2),
           'credit',       round(coalesce((l->>'credit')::numeric, 0), 2),
           'description',  nullif(btrim(l->>'description'), ''),
           'client_id',    nullif(l->>'client_id', ''),
           'supplier_id',  nullif(l->>'supplier_id', ''))) ORDER BY n),
         sum(round(coalesce((l->>'debit')::numeric, 0), 2))
    INTO v_lines, v_total
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS x(l, n);

  v_entry := public.post_journal_entry(
    p_tenant_id          => p_tenant_id,
    p_transaction_date   => v_fecha,
    p_description        => coalesce(nullif(btrim(p_description), ''), 'Asiento de apertura al ' || to_char(v_fecha, 'DD/MM/YYYY')),
    p_source_type        => 'apertura',
    p_lines              => v_lines,
    p_source_id          => NULL,
    p_source_cufe        => NULL,
    p_reverses_entry_id  => NULL,
    p_reversal_reason    => NULL,
    p_created_by         => p_created_by,
    p_record_date        => NULL,
    p_reference          => NULL,
    -- El mismo archivo se puede volver a cargar después de reversar la apertura:
    -- la llave lleva cuántas aperturas hubo antes.
    p_idempotency_key    => 'apertura:' || p_file_hash || ':'
                            || (SELECT count(*) FROM public.aperturas a WHERE a.tenant_id = p_tenant_id)::text,
    p_referencia_externa => left(btrim(p_file_name), 200)
  );
  SELECT entry_number, reference INTO v_nro, v_ref FROM public.journal_entries WHERE id = v_entry;

  INSERT INTO public.aperturas (tenant_id, entry_id, fecha, file_name, file_hash, lineas, total_debitos, created_by)
  VALUES (p_tenant_id, v_entry, v_fecha, btrim(p_file_name), btrim(p_file_hash), jsonb_array_length(p_lines), v_total, p_created_by)
  RETURNING id INTO v_apertura;

  -- Las partidas: toda línea con tercero o con documento.
  INSERT INTO public.apertura_partidas (tenant_id, apertura_id, entry_id, line_order, account_code, client_id, supplier_id,
                                        documento_externo, fecha_documento, vencimiento, debit, credit)
  SELECT p_tenant_id, v_apertura, v_entry, n, btrim(l->>'account_code'),
         nullif(l->>'client_id', '')::uuid, nullif(l->>'supplier_id', '')::uuid,
         nullif(btrim(l->>'documento_externo'), ''), nullif(l->>'fecha_documento', '')::date,
         nullif(l->>'vencimiento', '')::date,
         round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2)
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS x(l, n)
   WHERE nullif(l->>'client_id', '') IS NOT NULL OR nullif(l->>'supplier_id', '') IS NOT NULL
      OR nullif(btrim(l->>'documento_externo'), '') IS NOT NULL;

  RETURN jsonb_build_object('apertura_id', v_apertura, 'entry_id', v_entry, 'entry_number', v_nro,
                            'reference', v_ref, 'fecha', v_fecha, 'total_debitos', v_total);
END;
$fn$;

REVOKE ALL ON FUNCTION public.post_apertura(uuid, text, jsonb, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_apertura(uuid, text, jsonb, text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.finanzas_fecha_apertura(uuid) FROM PUBLIC, anon;

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.post_apertura(uuid, text, jsonb, text, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '100: authenticated no debe poder ejecutar post_apertura';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_apertura_inmutable', 'trg_fecha_apertura_fija',
                                                       'trg_saldo_inicial_con_apertura')) <> 4 THEN
    RAISE EXCEPTION '100: faltan triggers (se esperan 4)';
  END IF;
  RAISE NOTICE '100 ✅ apertura: parámetro de fecha, una vigente por bufete, partidas inmutables, post_apertura y saldo_inicial en sólo lectura';
END $$;

COMMIT;

-- Verificación (BEGIN … ROLLBACK): sql/tests/verificacion-100-101-apertura.sql
