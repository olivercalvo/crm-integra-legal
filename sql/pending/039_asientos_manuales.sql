-- ============================================================================
-- 039 — ASIENTOS MANUALES: `reference` e `idempotency_key`
-- ============================================================================
-- Prepara el ledger para la pantalla de asientos de diario. Dos columnas y una
-- versión nueva del RPC.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A) `reference` — un requisito del acta que no tenía dónde guardarse
-- ─────────────────────────────────────────────────────────────────────────────
-- El acta del 25/08/2026 pide "módulo de asientos de diario: fecha,
-- **referencia**, número, líneas con débito y crédito". De los cuatro, la
-- referencia era el único sin columna: `description` es la NATURALEZA del asiento
-- (Art. 5.5 del DE 34/1998) y `source_cufe` es de facturación electrónica.
--
-- Meterla dentro de `description` era la alternativa y se descartó: son dos
-- campos que el contador lee distinto, y ensuciar la naturaleza del asiento toca
-- justo lo que la DGI mira.
--
-- Beneficio lateral: `diario-general-source.ts` saca el rótulo del documento de
-- una tabla por `source_type`, y `manual` no está en ese mapa — hoy un asiento
-- manual sale con la columna Documento VACÍA en el Diario General. Con
-- `reference` poblada ese hueco se llena solo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- B) `idempotency_key` — porque acá NO hay `source_id` que salve
-- ─────────────────────────────────────────────────────────────────────────────
-- El UNIQUE de la `034` es PARCIAL: `WHERE source_id IS NOT NULL`. Un asiento
-- manual tiene `source_id` en NULL —no nace de ningún documento— así que **queda
-- fuera del índice** y no hay nada que impida postear el mismo asiento dos veces
-- con un doble clic. Y un asiento duplicado NO SE BORRA: los triggers de la `023`
-- rechazan DELETE, y la única salida sería una reversión que un contador tiene
-- que justificar ante la DGI.
--
-- La solución es EL MISMO PATRÓN de la `034`, no un mecanismo nuevo:
--
--   · La pantalla genera un UUID al abrir el formulario y lo manda en el POST.
--   · La ruta consulta antes y devuelve un mensaje entendible si ya se usó.
--   · **El UNIQUE parcial es la garantía**: el chequeo previo deja una ventana
--     entre el SELECT y el INSERT que dos requests simultáneos pasan; el índice
--     no depende del timing.
--
-- Parcial `WHERE idempotency_key IS NOT NULL` por el mismo motivo que la `034`:
-- los asientos automáticos no la mandan y no tienen por qué colisionar entre sí.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔬 EL HASH-CHAIN: `reference` SÍ ENTRA, `idempotency_key` NO
-- ─────────────────────────────────────────────────────────────────────────────
-- `reference` es contenido contable del asiento, así que va dentro de
-- `content_hash`. `idempotency_key` es un detalle de transporte —resuelve un
-- problema de HTTP, no de contabilidad— y no forma parte del registro.
--
-- ⚠️ **ESTO CAMBIA LA FÓRMULA DE `content_hash` A PARTIR DE HOY.** Verificado
-- antes de hacerlo: `verify_accounting_chain()` (migración `028`) **NO recalcula**
-- `content_hash` desde las columnas. Solo comprueba dos cosas:
--
--     1. que `prev_hash` encadene con el `hash` del asiento anterior, y
--     2. que `hash = sha256(prev_hash || content_hash)`.
--
-- O sea que los asientos ya posteados conservan su `content_hash` tal cual y la
-- cadena sigue íntegra. **No hay que reconstruir nada.**
--
-- 🔴 Pero queda una consecuencia anotada, porque no es obvia: si alguna vez se
-- escribe un verificador que SÍ recalcule `content_hash` desde las columnas,
-- tiene que saber que la fórmula cambió el **2026-09-03** — los asientos
-- anteriores a esa fecha se computaron sin el campo `reference`. Sin ese dato,
-- ese verificador reportaría como adulterados todos los asientos viejos.
--
-- (Y de paso queda dicho lo que el verificador actual NO hace: detecta una cadena
-- rota, no un campo adulterado. Lo que protege los campos son los triggers de
-- inmutabilidad de la `023`, no el hash.)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ POR QUÉ HAY UN `DROP FUNCTION` Y NO SOLO UN `CREATE OR REPLACE`
-- ─────────────────────────────────────────────────────────────────────────────
-- En PostgreSQL las funciones se sobrecargan por firma. `CREATE OR REPLACE` con
-- dos parámetros MÁS no reemplaza la de once: **crea una segunda**, y quedarían
-- las dos vivas. Una llamada con once argumentos seguiría entrando a la vieja —la
-- que no sabe escribir `reference`— y el bug sería invisible: postea bien, pero
-- pierde el campo.
--
-- 🔴 Y el DROP se lleva puestos los GRANT. La `030` revocó EXECUTE a PUBLIC,
-- anon y authenticated, y se lo dio solo a `service_role`. Si no se rehacen,
-- la función nueva nace con los permisos por defecto de PostgreSQL —EXECUTE para
-- PUBLIC— y **el RPC vuelve a ser llamable desde la sesión del usuario**, que es
-- exactamente lo que la `030` cerró. El paso 3 los rehace y el paso 4 lo verifica.
--
-- IDEMPOTENCIA:
--   ADD COLUMN IF NOT EXISTS, índice IF NOT EXISTS, DROP FUNCTION IF EXISTS.
--   Re-ejecutable.
--
-- APLICACIÓN:
--   Staging: `node scripts/run-sql.mjs sql/pending/039_asientos_manuales.sql`
--   🔴 Producción: NO desde una máquina. Solo por merge a `main`.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) LAS DOS COLUMNAS
-- ---------------------------------------------------------------------------
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS reference       text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'je_reference_largo'
  ) THEN
    ALTER TABLE public.journal_entries
      ADD CONSTRAINT je_reference_largo
      CHECK (reference IS NULL OR char_length(btrim(reference)) BETWEEN 1 AND 100);
  END IF;
END $guard$;

-- La garantía que no depende del timing. Mismo patrón que la `034`.
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_idempotency_key_unique
  ON public.journal_entries (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.journal_entries.reference IS
  'Referencia del documento de respaldo (Nº de recibo, memo, planilla). Pedida por el acta del 25/08/2026. NO es la naturaleza del asiento: eso es `description`.';
COMMENT ON COLUMN public.journal_entries.idempotency_key IS
  'Token que genera la pantalla al abrir el formulario. Impide que un doble clic postee dos veces un asiento manual, que no tiene `source_id` y por lo tanto queda fuera del UNIQUE de la 034. NO entra en el hash: es transporte, no contabilidad.';

-- ---------------------------------------------------------------------------
-- 2) EL RPC — se DROPEA y se recrea con la firma de trece parámetros
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.post_journal_entry(
  uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date
);

CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_tenant_id         uuid,
  p_transaction_date  date,
  p_description       text,
  p_source_type       text,
  p_lines             jsonb,
  p_source_id         uuid DEFAULT NULL,
  p_source_cufe       text DEFAULT NULL,
  p_reverses_entry_id uuid DEFAULT NULL,
  p_reversal_reason   text DEFAULT NULL,
  p_created_by        uuid DEFAULT NULL,
  p_record_date       date DEFAULT NULL,
  -- Nuevos en la 039. Van al FINAL y con DEFAULT para que las llamadas que ya
  -- existen sigan compilando sin tocarlas.
  p_reference         text DEFAULT NULL,
  p_idempotency_key   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record_date date := coalesce(p_record_date, current_date);
  v_count       int;
  v_malas       int;
  v_faltantes   text;
  v_debitos     numeric(14,2);
  v_creditos    numeric(14,2);
  v_period_id   uuid;
  v_period_st   text;
  v_anio        int;
  v_anio_hoy    int;
  v_next        bigint;
  v_prev_hash   text;
  v_lineas_txt  text;
  v_content     text;
  v_content_h   text;
  v_hash        text;
  v_entry_id    uuid;
  c_genesis     text := repeat('0', 64);
BEGIN
  -- ---- 1) Argumentos --------------------------------------------------------
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'post_journal_entry: falta el tenant';
  END IF;
  IF p_transaction_date IS NULL THEN
    RAISE EXCEPTION 'post_journal_entry: falta la fecha de la transacción';
  END IF;
  IF coalesce(btrim(p_description), '') = '' THEN
    RAISE EXCEPTION 'El asiento necesita una descripción de su naturaleza (DE 34/1998 Art. 5.5)';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'post_journal_entry: las líneas deben venir como un array JSON';
  END IF;

  -- ---- 2) Materializar las líneas ------------------------------------------
  DROP TABLE IF EXISTS pg_temp._pje_lineas;
  CREATE TEMP TABLE _pje_lineas ON COMMIT DROP AS
  SELECT
    t.ord::int                                              AS ord,
    btrim(t.l->>'account_code')                             AS code,
    round(coalesce((t.l->>'debit')::numeric, 0), 2)         AS debit,
    round(coalesce((t.l->>'credit')::numeric, 0), 2)        AS credit,
    nullif(btrim(coalesce(t.l->>'description', '')), '')    AS descr
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(l, ord);

  SELECT count(*) INTO v_count FROM pg_temp._pje_lineas;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'Un asiento necesita al menos 2 líneas (partida doble); llegaron %', v_count;
  END IF;

  -- ---- 3) Cada línea: débito O crédito, positivo ---------------------------
  SELECT count(*) INTO v_malas
    FROM pg_temp._pje_lineas
   WHERE debit < 0 OR credit < 0
      OR (debit > 0 AND credit > 0)
      OR (debit = 0 AND credit = 0);
  IF v_malas > 0 THEN
    RAISE EXCEPTION
      '% línea(s) inválidas: cada línea lleva débito O crédito, mayor que cero, nunca ambos ni ninguno',
      v_malas;
  END IF;

  -- ---- 4) Las cuentas existen, son del tenant y están activas ---------------
  SELECT string_agg(DISTINCT l.code, ', ' ORDER BY l.code) INTO v_faltantes
    FROM pg_temp._pje_lineas l
   WHERE NOT EXISTS (
     SELECT 1 FROM public.chart_of_accounts c
      WHERE c.tenant_id = p_tenant_id AND c.code = l.code AND c.active
   );
  IF v_faltantes IS NOT NULL THEN
    RAISE EXCEPTION 'Cuenta(s) inexistentes o inactivas en el plan: %', v_faltantes;
  END IF;

  -- ---- 5) Partida doble ----------------------------------------------------
  SELECT round(sum(debit), 2), round(sum(credit), 2)
    INTO v_debitos, v_creditos
    FROM pg_temp._pje_lineas;

  IF v_debitos <> v_creditos THEN
    RAISE EXCEPTION
      'El asiento no cuadra: débitos % vs créditos % (diferencia %)',
      v_debitos, v_creditos, round(v_debitos - v_creditos, 2);
  END IF;
  IF v_debitos = 0 THEN
    RAISE EXCEPTION 'El asiento suma cero: no hay nada que registrar';
  END IF;

  -- ---- 6) Período ----------------------------------------------------------
  v_anio     := extract(year FROM p_transaction_date)::int;
  v_anio_hoy := extract(year FROM current_date)::int;

  SELECT id, status INTO v_period_id, v_period_st
    FROM public.accounting_periods
   WHERE tenant_id = p_tenant_id
     AND year  = v_anio
     AND month = extract(month FROM p_transaction_date)::int;

  -- AUTO-CREACIÓN ACOTADA al año en curso y al siguiente.
  --
  -- Sin esto, el 1 de enero el primer asiento del año fallaba hasta que alguien
  -- se acordara de provisionar los períodos — y enero es justo cuando el
  -- contador está cerrando un ejercicio y abriendo el otro, o sea el peor
  -- momento para un bloqueo administrativo.
  --
  -- La cota conserva el freno que importa: una fecha de 2029 escrita por error
  -- sigue fallando fuerte en vez de abrir doce períodos en silencio.
  --
  -- Los años PASADOS quedan fuera a propósito. Que un período viejo no exista
  -- significa que ese ejercicio nunca se abrió; crearlo ahora dejaría postear
  -- dentro de un año fiscal que el contador ya certificó.
  IF v_period_id IS NULL AND v_anio BETWEEN v_anio_hoy AND v_anio_hoy + 1 THEN
    PERFORM public.ensure_accounting_periods(p_tenant_id, v_anio);
    RAISE NOTICE 'Períodos contables de % creados automáticamente', v_anio;

    SELECT id, status INTO v_period_id, v_period_st
      FROM public.accounting_periods
     WHERE tenant_id = p_tenant_id
       AND year  = v_anio
       AND month = extract(month FROM p_transaction_date)::int;
  END IF;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION
      'No existe el período contable %-% para este tenant y está fuera del rango que se crea solo (% y %). Provisionalo con ensure_accounting_periods().',
      v_anio,
      lpad(extract(month FROM p_transaction_date)::text, 2, '0'),
      v_anio_hoy, v_anio_hoy + 1;
  END IF;
  IF v_period_st = 'cerrado' THEN
    RAISE EXCEPTION
      'El período %-% está CERRADO: no admite asientos nuevos.',
      v_anio, lpad(extract(month FROM p_transaction_date)::text, 2, '0');
  END IF;

  -- ---- 7) Correlativo + candado --------------------------------------------
  INSERT INTO public.accounting_sequences (tenant_id, sequence_type, last_number)
  VALUES (p_tenant_id, 'journal_entry', 0)
  ON CONFLICT (tenant_id, sequence_type) DO NOTHING;

  SELECT last_number INTO v_next
    FROM public.accounting_sequences
   WHERE tenant_id = p_tenant_id AND sequence_type = 'journal_entry'
   FOR UPDATE;

  v_next := v_next + 1;

  UPDATE public.accounting_sequences
     SET last_number = v_next, updated_at = now()
   WHERE tenant_id = p_tenant_id AND sequence_type = 'journal_entry';

  -- ---- 8) Cadena de hash ---------------------------------------------------
  SELECT hash INTO v_prev_hash
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id
   ORDER BY entry_number DESC
   LIMIT 1;

  v_prev_hash := coalesce(v_prev_hash, c_genesis);

  SELECT string_agg(
           concat_ws(':', code, debit::text, credit::text, coalesce(descr, '')),
           '|' ORDER BY ord
         )
    INTO v_lineas_txt
    FROM pg_temp._pje_lineas;

  v_content := concat_ws('|',
    p_tenant_id::text,
    v_next::text,
    p_transaction_date::text,
    v_record_date::text,
    p_description,
    p_source_type,
    coalesce(p_source_id::text, ''),
    coalesce(p_source_cufe, ''),
    coalesce(p_reverses_entry_id::text, ''),
    coalesce(p_reversal_reason, ''),
    -- `reference` SI entra: es contenido contable del asiento.
    -- `idempotency_key` NO: es un detalle de transporte, no parte del registro.
    coalesce(p_reference, ''),
    v_lineas_txt
  );

  v_content_h := encode(sha256(convert_to(v_content, 'UTF8')), 'hex');
  v_hash      := encode(sha256(convert_to(v_prev_hash || v_content_h, 'UTF8')), 'hex');

  -- ---- 9) Escritura --------------------------------------------------------
  INSERT INTO public.journal_entries (
    tenant_id, entry_number, period_id, transaction_date, record_date,
    description, source_type, source_id, source_cufe,
    reverses_entry_id, reversal_reason,
    content_hash, prev_hash, hash, created_by,
    reference, idempotency_key
  ) VALUES (
    p_tenant_id, v_next, v_period_id, p_transaction_date, v_record_date,
    btrim(p_description), p_source_type, p_source_id, p_source_cufe,
    p_reverses_entry_id, p_reversal_reason,
    v_content_h, v_prev_hash, v_hash, p_created_by,
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_idempotency_key, '')), '')
  )
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_entry_lines (
    tenant_id, entry_id, line_order, account_id, debit, credit, line_description
  )
  SELECT p_tenant_id, v_entry_id, l.ord, c.id, l.debit, l.credit, l.descr
    FROM pg_temp._pje_lineas l
    JOIN public.chart_of_accounts c
      ON c.tenant_id = p_tenant_id AND c.code = l.code
   ORDER BY l.ord;

  RETURN v_entry_id;
END $$;

COMMENT ON FUNCTION public.post_journal_entry IS
  'ÚNICA vía para escribir en el ledger. SECURITY DEFINER y EXECUTE solo para service_role: NO valida el tenant, confía en p_tenant_id. Quien la llame DEBE sacar el tenant del usuario autenticado y nunca del cuerpo del request. Valida partida doble, resuelve el período (creándolo si es el año en curso o el siguiente), toma el correlativo sin huecos y encadena el hash, todo en UNA transacción. Desde la 039 acepta `reference` (entra en el hash) e `idempotency_key` (no entra).';

-- ---------------------------------------------------------------------------
-- 3) REHACER LOS PERMISOS QUE EL DROP SE LLEVÓ
-- ---------------------------------------------------------------------------
-- 🔴 NO ES OPCIONAL. Sin esto la función nace con EXECUTE para PUBLIC y el RPC
-- vuelve a ser llamable desde la sesión del usuario — justo lo que cerró la 030.
REVOKE EXECUTE ON FUNCTION
  public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4) VERIFICACIÓN
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_funcs    int;
  v_definer  int;
  v_publico  int;
  v_cols     int;
  v_indice   int;
BEGIN
  -- Una sola función: si quedaron dos, el DROP no agarró la firma vieja y las
  -- llamadas de once argumentos seguirían entrando a la que pierde `reference`.
  SELECT COUNT(*) INTO v_funcs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'post_journal_entry';

  SELECT COUNT(*) INTO v_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'post_journal_entry' AND p.prosecdef;

  -- Que NADIE más que service_role pueda ejecutarla.
  SELECT COUNT(*) INTO v_publico
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'post_journal_entry'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  SELECT COUNT(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'journal_entries'
     AND column_name IN ('reference', 'idempotency_key');

  SELECT COUNT(*) INTO v_indice
    FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'journal_entries_idempotency_key_unique';

  RAISE NOTICE 'post_journal_entry ......... % (esperado 1, sin sobrecargas)', v_funcs;
  RAISE NOTICE 'SECURITY DEFINER ........... % (esperado 1)', v_definer;
  RAISE NOTICE 'ejecutable por anon/auth ... % (esperado 0)', v_publico;
  RAISE NOTICE 'columnas nuevas ............ % (esperado 2)', v_cols;
  RAISE NOTICE 'UNIQUE de idempotencia ..... % (esperado 1)', v_indice;

  IF v_funcs <> 1 THEN
    RAISE EXCEPTION
      'ABORT: hay % versiones de post_journal_entry. Con dos firmas vivas, una llamada de 11 argumentos entra a la vieja y PIERDE `reference` sin fallar.',
      v_funcs;
  END IF;
  IF v_definer <> 1 THEN RAISE EXCEPTION 'ABORT: la función no quedó SECURITY DEFINER'; END IF;
  IF v_publico <> 0 THEN
    RAISE EXCEPTION
      'ABORT: anon o authenticated pueden ejecutar el RPC. El DROP se llevó los GRANT de la 030 y el paso 3 no los rehizo.';
  END IF;
  IF v_cols   <> 2 THEN RAISE EXCEPTION 'ABORT: faltan columnas (% de 2)', v_cols; END IF;
  IF v_indice <> 1 THEN RAISE EXCEPTION 'ABORT: falta el UNIQUE de idempotencia'; END IF;

  RAISE NOTICE 'OK — 039 aplicada.';
END $verif$;

COMMIT;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- ⚠️ Volver atrás exige recrear la función de ONCE parámetros (está en la 030) y
--    rehacer sus GRANT. Dropear las columnas a secas dejaría el RPC roto.
--    Y si ya se postearon asientos con `reference`, ese dato se pierde.
-- ============================================================================
