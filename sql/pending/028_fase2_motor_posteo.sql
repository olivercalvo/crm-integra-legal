-- =============================================================================
-- FEATURE: Fase 2 — motor de posteo del ledger
-- Sprint:  Contabilidad — Fase 2 (bloque que NO depende de respuestas del contador)
-- Fecha:   2026-08-27
-- Tenant:  a0000000-0000-0000-0000-000000000001 (Integra Legal)
--
-- QUÉ TRAE:
--   A. `apertura` en el CHECK de source_type.
--   B. `ensure_accounting_periods(tenant, año)` — los 12 períodos mensuales.
--   C. La fila de `accounting_sequences` del correlativo.
--   D. `post_journal_entry(...)` — EL MOTOR.
--   E. `verify_accounting_chain(tenant)` — verificador de la cadena de hash.
--
-- QUÉ NO TRAE (a propósito):
--   · El ASIENTO DE APERTURA. Depende de la fecha de corte de los saldos, que
--     está pendiente de confirmación del contador (consulta 1 del task_plan).
--     Lo cargado hoy es una foto de mitad de año, no una apertura al 1 de enero.
--   · El Libro Mayor y el módulo de compras: van después de la validación de RM.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EL MOTOR ES UNA FUNCIÓN DE POSTGRES Y NO CÓDIGO DE LA APP
-- ─────────────────────────────────────────────────────────────────────────────
-- No es una preferencia de estilo: es la única forma segura, y la causa son los
-- triggers de inmutabilidad de la migración 023.
--
-- Postear un asiento son DOS escrituras: la cabecera y las líneas. supabase-js
-- no tiene transacciones multi-statement, así que desde la app serían dos
-- requests. Si la segunda falla, la cabecera ya quedó escrita... y NO SE PUEDE
-- BORRAR: `trg_je_no_delete` rechaza el DELETE. El resultado sería un asiento
-- sin líneas, descuadrado, imposible de limpiar, y para siempre en los libros
-- que el contador certifica ante la DGI.
--
-- Dentro de una función todo corre en UNA transacción: si algo falla, no queda
-- nada. Es lo que ya anticipaba el encabezado de 023 ("la regla de partida doble
-- se valida en el RPC de posteo (Fase 2)").
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DESVÍO DELIBERADO DE 023: EL HASH SE CALCULA ACÁ, NO EN LA APP
-- ─────────────────────────────────────────────────────────────────────────────
-- La línea 23 de 023 decía "hash-chain SHA-256; se computa en la app, se
-- verifica en la BD". Se hace al revés, y por un motivo concreto:
--
--   `prev_hash` es el hash del asiento ANTERIOR. Calcularlo en la app obliga a
--   leer el último asiento y después escribir — un read-then-write. Dos posteos
--   concurrentes leerían el MISMO `prev_hash` y la cadena se bifurcaría en
--   silencio, que es exactamente lo que una cadena de hash existe para impedir.
--
-- Acá, el `SELECT ... FOR UPDATE` sobre la fila de la secuencia serializa a los
-- dos: el correlativo sin huecos y la cadena quedan protegidos por el mismo
-- candado. Y `sha256()` es nativo desde PostgreSQL 11 (la base corre 17.6), así
-- que no hace falta pgcrypto.
--
-- IDEMPOTENCIA:
--   CREATE OR REPLACE en las funciones, ON CONFLICT DO NOTHING en los datos,
--   y el CHECK se dropea antes de crearse. Re-ejecutable.
--
-- APLICACIÓN:
--   Staging: `node scripts/apply-staging-sql.mjs` (ya está en BUNDLE_2).
--   Producción: NO. Solo por merge a main.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A) source_type acepta 'apertura'
-- -----------------------------------------------------------------------------
-- Sirve para poder EXCLUIR el asiento de apertura de los reportes de movimiento
-- del período: no es una transacción del ejercicio, es el arrastre del anterior.
-- Con 'manual' quedaría mezclado con los asientos de diario de verdad.
--
-- El CHECK original se declaró inline y sin nombre, así que se busca por su
-- definición en vez de asumir el nombre que le puso Postgres.
--
-- ⚠️ EL FILTRO PIDE '%factura%' ADEMÁS DE '%source_type%', Y NO ES DECORATIVO.
-- La tabla tiene OTRO check que también menciona source_type:
--   je_reversion_requires_ref → source_type <> 'reversion' OR (reverses_entry_id
--   IS NOT NULL AND reversal_reason IS NOT NULL AND length(...) >= 3)
-- que hace cumplir el Art. 5.7 (una reversión debe apuntar al original y traer
-- motivo). La primera versión de esta migración filtraba solo por
-- '%source_type%' y lo dropeó junto con el enum, en silencio. Se reparó en la
-- migración 029. Solo el CHECK del enum lista los valores, así que '%factura%'
-- lo distingue sin ambigüedad.
DO $$
DECLARE
  v_nombre text;
BEGIN
  FOR v_nombre IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class     rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'journal_entries'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%source_type%'
       AND pg_get_constraintdef(con.oid) ILIKE '%factura%'
  LOOP
    EXECUTE format('ALTER TABLE public.journal_entries DROP CONSTRAINT %I', v_nombre);
    RAISE NOTICE 'CHECK viejo de source_type eliminado: %', v_nombre;
  END LOOP;
END $$;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IN (
    'factura', 'gasto', 'pago', 'nota_credito', 'manual', 'reversion', 'apertura'
  ));

-- -----------------------------------------------------------------------------
-- B) Períodos contables
-- -----------------------------------------------------------------------------
-- Los períodos son MENSUALES (year + month), no anuales: así lo definió la
-- tabla en 023. El período FISCAL sigue siendo el año calendario — ver
-- `src/lib/finanzas/contabilidad/periodo-fiscal.ts`, que es la fuente de esa
-- regla del lado de la app.
CREATE OR REPLACE FUNCTION public.ensure_accounting_periods(
  p_tenant_id uuid,
  p_year      int
)
RETURNS int
LANGUAGE plpgsql
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

COMMENT ON FUNCTION public.ensure_accounting_periods(uuid, int) IS
  'Crea los 12 períodos mensuales de un año fiscal, idempotente. NO los cierra ni los reabre: solo garantiza que existan para que se pueda postear.';

-- Provisión inicial: 2026 (el ejercicio en curso) y 2027 (para que el 1 de
-- enero no encuentre la casa sin períodos).
SELECT public.ensure_accounting_periods('a0000000-0000-0000-0000-000000000001', 2026);
SELECT public.ensure_accounting_periods('a0000000-0000-0000-0000-000000000001', 2027);

-- -----------------------------------------------------------------------------
-- C) Secuencia del correlativo
-- -----------------------------------------------------------------------------
-- Arranca en 0 → el primer asiento será el número 1. El formato del número
-- (¿correlativo único? ¿uno por tipo? ¿se reinicia cada año?) está PENDIENTE de
-- confirmación del contador — consulta 8 del task_plan. Mientras tanto se usa un
-- correlativo único por tenant, que es lo que exige la ley (sin huecos) y el
-- caso más restrictivo: de un correlativo único se puede derivar cualquier
-- presentación, al revés no.
INSERT INTO public.accounting_sequences (tenant_id, sequence_type, last_number)
VALUES ('a0000000-0000-0000-0000-000000000001', 'journal_entry', 0)
ON CONFLICT (tenant_id, sequence_type) DO NOTHING;

-- -----------------------------------------------------------------------------
-- D) EL MOTOR
-- -----------------------------------------------------------------------------
-- Las líneas llegan como jsonb:
--   [{"account_code": "100001", "debit": 1500, "credit": 0, "description": "..."}]
--
-- Se identifica la cuenta por CÓDIGO y no por id porque el código es la
-- identidad contable de la cuenta y es inmutable por regla de la app (ver
-- api/chart-of-accounts.ts). Además hace legible cualquier log o llamada.
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
  v_next        bigint;
  v_prev_hash   text;
  v_lineas_txt  text;
  v_content     text;
  v_content_h   text;
  v_hash        text;
  v_entry_id    uuid;
  -- Hash de arranque de la cadena: 64 ceros. Cualquier constante sirve mientras
  -- sea fija; se elige esta por ser la convención habitual de un bloque génesis.
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
  -- Va a una temp table para no repetir el mismo jsonb_array_elements en cada
  -- validación: repetirlo invita a que una copia se desincronice de otra.
  DROP TABLE IF EXISTS _pje_lineas;
  CREATE TEMP TABLE _pje_lineas ON COMMIT DROP AS
  SELECT
    t.ord::int                                              AS ord,
    btrim(t.l->>'account_code')                             AS code,
    round(coalesce((t.l->>'debit')::numeric, 0), 2)         AS debit,
    round(coalesce((t.l->>'credit')::numeric, 0), 2)        AS credit,
    nullif(btrim(coalesce(t.l->>'description', '')), '')    AS descr
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(l, ord);

  SELECT count(*) INTO v_count FROM _pje_lineas;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'Un asiento necesita al menos 2 líneas (partida doble); llegaron %', v_count;
  END IF;

  -- ---- 3) Cada línea: débito O crédito, positivo ---------------------------
  SELECT count(*) INTO v_malas
    FROM _pje_lineas
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
    FROM _pje_lineas l
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
    FROM _pje_lineas;

  IF v_debitos <> v_creditos THEN
    RAISE EXCEPTION
      'El asiento no cuadra: débitos % vs créditos % (diferencia %)',
      v_debitos, v_creditos, round(v_debitos - v_creditos, 2);
  END IF;
  IF v_debitos = 0 THEN
    RAISE EXCEPTION 'El asiento suma cero: no hay nada que registrar';
  END IF;

  -- ---- 6) Período ----------------------------------------------------------
  -- NO se crea solo. Si la fecha cae en un año sin períodos provisionados es
  -- casi seguro un error de tipeo (un 2029 por un 2026), y crear doce períodos
  -- en silencio lo escondería. Se provisiona a mano con
  -- ensure_accounting_periods().
  SELECT id, status INTO v_period_id, v_period_st
    FROM public.accounting_periods
   WHERE tenant_id = p_tenant_id
     AND year  = extract(year  FROM p_transaction_date)::int
     AND month = extract(month FROM p_transaction_date)::int;

  IF v_period_id IS NULL THEN
    RAISE EXCEPTION
      'No existe el período contable %-% para este tenant. Provisionalo con ensure_accounting_periods().',
      extract(year FROM p_transaction_date)::int,
      lpad(extract(month FROM p_transaction_date)::text, 2, '0');
  END IF;
  IF v_period_st = 'cerrado' THEN
    RAISE EXCEPTION
      'El período %-% está CERRADO: no admite asientos nuevos.',
      extract(year FROM p_transaction_date)::int,
      lpad(extract(month FROM p_transaction_date)::text, 2, '0');
  END IF;

  -- ---- 7) Correlativo + candado --------------------------------------------
  -- El FOR UPDATE hace DOS trabajos: garantiza el correlativo sin huecos y
  -- serializa la cadena de hash. Sin él, dos posteos concurrentes leerían el
  -- mismo prev_hash y la bifurcarían.
  -- El INSERT va PRIMERO y es idempotente: si se hiciera "SELECT, y si no hay
  -- entonces INSERT", dos posteos concurrentes contra un tenant nuevo llegarían
  -- los dos al INSERT y el segundo moriría por PK duplicada. Así, el que pierde
  -- no hace nada y ambos caen en el mismo FOR UPDATE, que es el que serializa.
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

  -- Serialización canónica. El ORDER BY ord es lo que la vuelve determinística:
  -- sin él, dos corridas sobre las mismas líneas podrían dar hashes distintos y
  -- el verificador reportaría corrupción donde no la hay.
  SELECT string_agg(
           concat_ws(':', code, debit::text, credit::text, coalesce(descr, '')),
           '|' ORDER BY ord
         )
    INTO v_lineas_txt
    FROM _pje_lineas;

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
    FROM _pje_lineas l
    JOIN public.chart_of_accounts c
      ON c.tenant_id = p_tenant_id AND c.code = l.code
   ORDER BY l.ord;

  RETURN v_entry_id;
END $$;

COMMENT ON FUNCTION public.post_journal_entry IS
  'ÚNICA vía para escribir en el ledger. Valida partida doble, resuelve el período, toma el correlativo sin huecos y encadena el hash, todo en UNA transacción. Es una función y no código de app porque los triggers de inmutabilidad (023) rechazan DELETE: un posteo a medias desde la app dejaría una cabecera sin líneas imposible de limpiar.';

-- -----------------------------------------------------------------------------
-- E) Verificador de la cadena
-- -----------------------------------------------------------------------------
-- Una cadena de hash que nadie verifica es decoración. Recorre los asientos en
-- orden y reporta el primer eslabón que no cierra.
--
-- Detecta dos cosas distintas:
--   · prev_hash roto  → alguien insertó, borró o reordenó asientos.
--   · hash roto       → el hash no corresponde a prev_hash + content_hash.
--
-- Lo que NO puede detectar es un content_hash recalculado sobre datos alterados:
-- para eso habría que rehacer la serialización canónica acá, y duplicarla sería
-- justo la clase de código que se desincroniza. Como los triggers de 023 ya
-- impiden el UPDATE, el vector real que queda cubierto es el de arriba.
CREATE OR REPLACE FUNCTION public.verify_accounting_chain(p_tenant_id uuid)
RETURNS TABLE (
  -- `nro_asiento` y no `entry_number`: los parámetros de salida de un
  -- RETURNS TABLE son variables, y una que se llame igual que la columna vuelve
  -- ambiguo el ORDER BY de la consulta de abajo.
  nro_asiento bigint,
  problema    text
)
LANGUAGE plpgsql
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

COMMENT ON FUNCTION public.verify_accounting_chain(uuid) IS
  'Recorre la cadena de asientos y devuelve una fila por eslabón roto. Sin filas = cadena íntegra.';

COMMIT;

-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================
DO $$
DECLARE
  v_tenant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_per    int;
  v_seq    int;
  v_check  int;
BEGIN
  SELECT COUNT(*) INTO v_per FROM public.accounting_periods WHERE tenant_id = v_tenant;
  SELECT COUNT(*) INTO v_seq FROM public.accounting_sequences WHERE tenant_id = v_tenant;
  SELECT COUNT(*) INTO v_check
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'journal_entries'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%apertura%';

  RAISE NOTICE '— POST-CHECK motor de posteo —';
  RAISE NOTICE 'períodos contables ......... % (esperado 24: 2026 + 2027)', v_per;
  RAISE NOTICE 'filas de secuencia ......... % (esperado 1)', v_seq;
  RAISE NOTICE 'CHECK con apertura ......... % (esperado 1)', v_check;

  IF v_per <> 24 THEN RAISE EXCEPTION 'ABORT: se esperaban 24 períodos y hay %', v_per; END IF;
  IF v_seq <> 1   THEN RAISE EXCEPTION 'ABORT: se esperaba 1 fila de secuencia y hay %', v_seq; END IF;
  IF v_check <> 1 THEN RAISE EXCEPTION 'ABORT: el CHECK de source_type no acepta apertura'; END IF;
END $$;

-- =============================================================================
-- ROLLBACK (descomentar solo si hay que revertir)
-- -----------------------------------------------------------------------------
-- Los períodos y la secuencia NO se borran si ya hay asientos: journal_entries
-- los referencia por FK y el correlativo no puede retroceder.
-- =============================================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.verify_accounting_chain(uuid);
-- DROP FUNCTION IF EXISTS public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date);
-- DROP FUNCTION IF EXISTS public.ensure_accounting_periods(uuid, int);
-- ALTER TABLE public.journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
-- ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_source_type_check
--   CHECK (source_type IN ('factura','gasto','pago','nota_credito','manual','reversion'));
-- COMMIT;
-- =============================================================================
