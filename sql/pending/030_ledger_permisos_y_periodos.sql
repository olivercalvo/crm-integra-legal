-- =============================================================================
-- FEATURE: cerrar la escritura directa al ledger + auto-creación de períodos
-- Sprint:  Contabilidad — Fase 2 (endurecimiento)
-- Fecha:   2026-08-27
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- ═════════════════════════════════════════════════════════════════════════════
-- EL PROBLEMA
-- ═════════════════════════════════════════════════════════════════════════════
-- Toda la integridad del ledger —partida doble, correlativo sin huecos, cadena
-- de hash— vive DENTRO de `post_journal_entry`. Pero hasta esta migración nada
-- obligaba a pasar por ahí:
--
--   · `authenticated` tenía INSERT sobre `journal_entries`, y la política RLS
--     `tenant_isolation` deja pasar cualquier fila de su propio tenant. O sea:
--     cualquier usuario logueado del bufete podía hacer un POST a
--     /rest/v1/journal_entries con el `prev_hash` que quisiera y la cadena
--     dejaba de probar nada.
--   · `service_role` bypasea RLS por completo. Este es el riesgo más probable en
--     la práctica, y no es un atacante: es un colega que escribe
--     `db.from('journal_entries').insert(...)` sin saber que existe el RPC.
--   · Las tres funciones eran SECURITY INVOKER con EXECUTE a PUBLIC — el default
--     de `CREATE FUNCTION`, que es fácil de no ver.
--   · Y TRUNCATE no lo frenaba NADA. Los triggers de inmutabilidad de 023 son
--     `FOR EACH ROW` sobre UPDATE y DELETE: TRUNCATE no dispara triggers de fila
--     y tampoco pasa por RLS. Una tabla diseñada para ser imborrable se podía
--     vaciar entera.
--
-- (`anon` sí estaba cubierto: sin claim de tenant, el WITH CHECK de la RLS
--  evalúa a NULL y el INSERT no pasa.)
--
-- El verificador de la cadena detecta la ruptura DESPUÉS. Esto la impide.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- ⚠️ EL ORDEN DE LOS TRES PASOS NO ES DECORATIVO — INVERTIRLO ABRE ALGO PEOR
-- ═════════════════════════════════════════════════════════════════════════════
-- Van: (1) revocar la escritura, (2) EXECUTE solo a service_role, (3) recién ahí
-- SECURITY DEFINER.
--
-- El paso 2 NO es opcional y NO puede ir después del 3. Con SECURITY DEFINER la
-- función deja de correr bajo RLS y pasa a confiar en el `p_tenant_id` que
-- recibe como argumento. Si el EXECUTE siguiera en PUBLIC, un usuario logueado
-- podría llamarla pasando el tenant de OTRO bufete.
--
-- Es decir, se pasaría de:
--     "puede falsificar la cadena de SU PROPIO tenant"
-- a:
--     "puede escribir en el ledger de CUALQUIERA".
--
-- El agujero que abriría sería estrictamente peor que el que esta migración
-- cierra. Por eso los tres pasos van juntos y en este orden.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- POR QUÉ ESTA MIGRACIÓN TIENE QUE ESTAR EN BUNDLE_2
-- ═════════════════════════════════════════════════════════════════════════════
-- El RESET_SQL de `scripts/apply-staging-sql.mjs` hace:
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES
--       TO postgres, anon, authenticated, service_role;
--
-- Esa línea es la causa raíz de los permisos de arriba, y se vuelve a aplicar en
-- cada `--reset`. Si este revoke viviera fuera del bundle de migraciones, la
-- primera base recreada volvería a nacer abierta y nadie se enteraría.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- LO QUE NO SE REVOCA, Y POR QUÉ
-- ═════════════════════════════════════════════════════════════════════════════
--   · SELECT se queda en todos lados: los reportes y el futuro Libro Mayor leen.
--   · `accounting_periods`: se revoca INSERT/DELETE/TRUNCATE (crear va por
--     `ensure_accounting_periods`) pero service_role CONSERVA UPDATE, porque
--     cerrar y reabrir un período es una operación administrativa legítima y
--     todavía no existe una función que la encapsule.
--   · Al DUEÑO de las tablas no se le toca nada: es quien ejecuta las funciones
--     SECURITY DEFINER y necesita esos permisos para que el motor funcione.
--
-- IDEMPOTENCIA: REVOKE/GRANT y CREATE OR REPLACE son re-ejecutables.
--
-- APLICACIÓN:
--   Staging: `node scripts/apply-staging-sql.mjs` (ya está en BUNDLE_2).
--   Producción: NO. Solo por merge a main.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- PASO 1 — Revocar la escritura directa
-- -----------------------------------------------------------------------------
-- UPDATE y DELETE ya estaban muertos por los triggers de 023. Se revocan igual:
-- un permiso concedido que no sirve es una mentira en el catálogo, y el próximo
-- que lo lea va a creer que puede.
--
-- TRUNCATE es el que de verdad faltaba. Hoy no llega por HTTP (PostgREST no lo
-- expone) pero tampoco aporta nada, y es el único camino que vaciaba una tabla
-- imborrable sin disparar un solo trigger.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.journal_entries, public.journal_entry_lines, public.accounting_legajos
  FROM anon, authenticated, service_role;

-- El correlativo sin huecos depende de esta fila. Un UPDATE directo podría
-- retrocederlo y duplicar números de asiento.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.accounting_sequences
  FROM anon, authenticated, service_role;

-- Períodos: configuración, no ledger. anon/authenticated no tienen nada que
-- hacer acá; service_role conserva UPDATE para cerrar y reabrir.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.accounting_periods
  FROM anon, authenticated;
REVOKE INSERT, DELETE, TRUNCATE ON public.accounting_periods
  FROM service_role;

-- -----------------------------------------------------------------------------
-- PASO 2 — EXECUTE solo para service_role
-- -----------------------------------------------------------------------------
-- `CREATE FUNCTION` concede EXECUTE a PUBLIC por defecto, y además estas tres
-- tenían grants explícitos para anon y authenticated. Hay que sacar los dos: un
-- REVOKE a PUBLIC no borra un grant nominal.
--
-- Con esto, el RPC deja de ser llamable desde la sesión del usuario. Todo el
-- posteo pasa a ser server-side con el cliente de servicio. Ver la consecuencia
-- para la Fase 3 en CLAUDE.md.
REVOKE EXECUTE ON FUNCTION
  public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_accounting_periods(uuid, int)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_accounting_chain(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_accounting_periods(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_accounting_chain(uuid)        TO service_role;

-- -----------------------------------------------------------------------------
-- PASO 3 — SECURITY DEFINER en las funciones que ESCRIBEN
-- -----------------------------------------------------------------------------
-- Solo las dos que escriben. `verify_accounting_chain` únicamente lee y
-- service_role conserva SELECT, así que se queda como INVOKER: menos privilegio
-- por defecto.
--
-- `SET search_path = public, pg_temp` con pg_temp AL FINAL es el endurecimiento
-- estándar de una función DEFINER: si pg_temp fuera primero, cualquiera podría
-- crear un objeto temporal que sombree uno de `public` y hacérselo ejecutar a la
-- función con los privilegios del dueño. Por lo mismo, las referencias a la
-- tabla temporal van calificadas con `pg_temp.`.

CREATE OR REPLACE FUNCTION public.ensure_accounting_periods(
  p_tenant_id uuid,
  p_year      int
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_creados int;
BEGIN
  IF p_tenant_id IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'ensure_accounting_periods: tenant y año son obligatorios';
  END IF;
  IF p_year < 2000 OR p_year > 2100 THEN
    RAISE EXCEPTION 'ensure_accounting_periods: año fuera de rango (%)', p_year;
  END IF;

  INSERT INTO public.accounting_periods (tenant_id, year, month, status)
  SELECT p_tenant_id, p_year, m, 'abierto'
    FROM generate_series(1, 12) AS m
  ON CONFLICT (tenant_id, year, month) DO NOTHING;

  GET DIAGNOSTICS v_creados = ROW_COUNT;
  RETURN v_creados;
END $$;

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
  p_record_date       date DEFAULT NULL
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
    v_lineas_txt
  );

  v_content_h := encode(sha256(convert_to(v_content, 'UTF8')), 'hex');
  v_hash      := encode(sha256(convert_to(v_prev_hash || v_content_h, 'UTF8')), 'hex');

  -- ---- 9) Escritura --------------------------------------------------------
  INSERT INTO public.journal_entries (
    tenant_id, entry_number, period_id, transaction_date, record_date,
    description, source_type, source_id, source_cufe,
    reverses_entry_id, reversal_reason,
    content_hash, prev_hash, hash, created_by
  ) VALUES (
    p_tenant_id, v_next, v_period_id, p_transaction_date, v_record_date,
    btrim(p_description), p_source_type, p_source_id, p_source_cufe,
    p_reverses_entry_id, p_reversal_reason,
    v_content_h, v_prev_hash, v_hash, p_created_by
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
  'ÚNICA vía para escribir en el ledger. SECURITY DEFINER y EXECUTE solo para service_role: NO valida el tenant, confía en p_tenant_id. Quien la llame DEBE sacar el tenant del usuario autenticado y nunca del cuerpo del request. Valida partida doble, resuelve el período (creándolo si es el año en curso o el siguiente), toma el correlativo sin huecos y encadena el hash, todo en UNA transacción.';

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
  r          record;
BEGIN
  FOR r IN
    SELECT je.entry_number, je.prev_hash, je.content_hash, je.hash
      FROM public.journal_entries je
     WHERE je.tenant_id = p_tenant_id
     ORDER BY je.entry_number
  LOOP
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

    v_esperado := r.hash;
  END LOOP;

  RETURN;
END $$;

COMMIT;

-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================
DO $$
DECLARE
  v_escritura int;
  v_execute   int;
  v_definer   int;
BEGIN
  -- Ningún permiso de escritura para anon/authenticated/service_role en las
  -- tablas del ledger.
  SELECT COUNT(*) INTO v_escritura
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('journal_entries','journal_entry_lines','accounting_legajos','accounting_sequences')
     AND grantee IN ('anon','authenticated','service_role')
     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');

  -- anon/authenticated no pueden ejecutar ninguna de las tres funciones.
  SELECT COUNT(*) INTO v_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('post_journal_entry','ensure_accounting_periods','verify_accounting_chain')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  SELECT COUNT(*) INTO v_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('post_journal_entry','ensure_accounting_periods')
     AND p.prosecdef;

  RAISE NOTICE '— POST-CHECK permisos del ledger —';
  RAISE NOTICE 'grants de escritura restantes ..... % (esperado 0)', v_escritura;
  RAISE NOTICE 'funciones ejecutables por el user . % (esperado 0)', v_execute;
  RAISE NOTICE 'funciones SECURITY DEFINER ........ % (esperado 2)', v_definer;

  IF v_escritura > 0 THEN
    RAISE EXCEPTION 'ABORT: quedaron % permisos de escritura sobre el ledger', v_escritura;
  END IF;
  IF v_execute > 0 THEN
    RAISE EXCEPTION 'ABORT: % funcion(es) siguen siendo ejecutables desde la sesión del usuario', v_execute;
  END IF;
  IF v_definer <> 2 THEN
    RAISE EXCEPTION 'ABORT: se esperaban 2 funciones SECURITY DEFINER y hay %', v_definer;
  END IF;
END $$;

SELECT table_name, grantee,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS permisos
FROM   information_schema.role_table_grants
WHERE  table_schema = 'public'
  AND  table_name IN ('journal_entries','journal_entry_lines','accounting_sequences','accounting_periods','accounting_legajos')
  AND  grantee IN ('anon','authenticated','service_role')
GROUP  BY table_name, grantee
ORDER  BY table_name, grantee;

-- =============================================================================
-- ROLLBACK (descomentar solo si hay que revertir)
-- -----------------------------------------------------------------------------
-- Devolver los permisos reabre la escritura directa al ledger. Hacerlo solo si
-- algo se rompió de verdad, y volver a cerrarlo después.
-- =============================================================================
-- BEGIN;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE
--   ON public.journal_entries, public.journal_entry_lines,
--      public.accounting_legajos, public.accounting_sequences
--   TO service_role;
-- GRANT EXECUTE ON FUNCTION public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date) TO PUBLIC;
-- COMMIT;
-- =============================================================================
