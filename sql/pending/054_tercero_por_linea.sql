-- ============================================================================
-- 054 — EL TERCERO DE CADA LÍNEA DEL LIBRO
-- ============================================================================
-- Bloque 7, commit 1 (22/09/2026). Pedido de Josuarth en la reunión: que una
-- línea de asiento pueda decir de qué cliente o de qué proveedor se trata,
-- porque un movimiento contra cuentas por cobrar o por pagar sin tercero no le
-- sirve al auxiliar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DOS FK REALES, NO UN DISCRIMINADOR (D1)
-- ─────────────────────────────────────────────────────────────────────────────
-- En el repo conviven los dos patrones y NO son equivalentes:
--
--   · arco exclusivo con FK de verdad — `expense_lines`
--     (`(expense_id IS NOT NULL) <> (business_expense_id IS NOT NULL)`) y
--     `supplier_payments` (`num_nonnulls(business_expense_id, expense_id) = 1`);
--   · discriminador suelto — `documents` (`entity_type` + `entity_id`), que en
--     `pg_constraint` NO tiene ninguna FK a las entidades que nombra.
--
-- Una línea del libro es INMUTABLE y eterna: un puntero colgado ahí no se
-- arregla nunca. Por eso van dos FK reales y un CHECK de "cero o uno".
--
-- 🔴 `ON DELETE NO ACTION`, NUNCA `SET NULL`. Los triggers `trg_jel_no_update`
-- y `trg_jel_no_delete` (023) rechazan todo UPDATE sobre estas líneas: un
-- `SET NULL` intentaría modificarlas y haría fallar el DELETE del cliente con
-- un error sobre el ledger, disparado desde la pantalla de Clientes. Con
-- NO ACTION el rechazo es el de la FK, claro y atrapable — y la app lo traduce
-- a "no se puede eliminar porque aparece en un asiento del libro contable".
-- Consecuencia buscada: un cliente o proveedor nombrado en el libro ya no se
-- borra.
--
-- El tercero se puede poner en CUALQUIER línea (D3), no solo en las cuentas de
-- control: acotarlo sería una regla contable que nadie pidió.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔬 EL TERCERO ENTRA AL `content_hash` (D4)
-- ─────────────────────────────────────────────────────────────────────────────
-- Dice contra quién se movió la cuenta: es contenido contable, como `reference`
-- en la 039. **Es la SEGUNDA vez que cambia la fórmula** (la primera fue el
-- 2026-09-03). Igual que entonces: `verify_accounting_chain()` (028) NO
-- recalcula `content_hash` desde las columnas —solo encadena `prev_hash` y
-- comprueba `hash = sha256(prev_hash || content_hash)`—, así que los asientos
-- ya posteados conservan el suyo y la cadena sigue íntegra. No hay nada que
-- reconstruir.
--
-- 🔴 Las tres versiones de la fórmula quedan listadas en `sop.md` SOP-014, que
-- es el lugar que manda: el encabezado de la 039 ya está aplicado y no se
-- corrige en su sitio (misma lección que el de la 023).
--
-- 📋 Verificado contra information_schema / pg_constraint el 22/09/2026:
--    `journal_entry_lines` tenía OCHO columnas (id, tenant_id, entry_id,
--    line_order, account_id, debit, credit, line_description) y ninguna de
--    tercero; sus CHECK son `jel_debit_xor_credit`, `jel_not_zero` y los dos de
--    no-negativo, y no se tocan. `clients.id` y `suppliers.id` son uuid PK.
--
-- El tercero viaja DENTRO de `p_lines` (`client_id` / `supplier_id` por línea),
-- así que la FIRMA del RPC no cambia y ningún llamador actual se toca.
--
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE. Re-ejecutable.
-- Verificación: sql/tests/verificacion-054-tercero-por-linea.sql
-- (ROLLBACK, con falla forzada después de postear).
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Las dos columnas
-- ----------------------------------------------------------------------------
ALTER TABLE public.journal_entry_lines
  ADD COLUMN IF NOT EXISTS client_id   uuid NULL REFERENCES public.clients(id)   ON DELETE NO ACTION,
  ADD COLUMN IF NOT EXISTS supplier_id uuid NULL REFERENCES public.suppliers(id) ON DELETE NO ACTION;

ALTER TABLE public.journal_entry_lines
  DROP CONSTRAINT IF EXISTS jel_tercero_unico;
ALTER TABLE public.journal_entry_lines
  ADD CONSTRAINT jel_tercero_unico
  CHECK (num_nonnulls(client_id, supplier_id) <= 1);

COMMENT ON COLUMN public.journal_entry_lines.client_id IS
  'Cliente al que se refiere ESTA línea (054). Opcional, y excluyente con supplier_id (jel_tercero_unico). ON DELETE NO ACTION a propósito: la línea es inmutable, así que un SET NULL fallaría contra trg_jel_no_update. Entra en el content_hash.';
COMMENT ON COLUMN public.journal_entry_lines.supplier_id IS
  'Proveedor al que se refiere ESTA línea (054). Opcional, excluyente con client_id. Mismo régimen que client_id.';

-- Parciales: la enorme mayoría de las líneas no tiene tercero.
CREATE INDEX IF NOT EXISTS idx_jel_client
  ON public.journal_entry_lines (tenant_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jel_supplier
  ON public.journal_entry_lines (tenant_id, supplier_id) WHERE supplier_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. El motor: mismo nombre, MISMA FIRMA, el tercero adentro de p_lines
-- ----------------------------------------------------------------------------
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
  v_terceros    text;
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
    nullif(btrim(coalesce(t.l->>'description', '')), '')    AS descr,
    -- 054: el tercero de la línea. Viaja DENTRO de `p_lines` y no como
    -- parámetro nuevo: un asiento puede nombrar un tercero distinto por línea,
    -- que es justamente lo que pidió Josuarth.
    nullif(btrim(coalesce(t.l->>'client_id', '')), '')::uuid    AS client_id,
    nullif(btrim(coalesce(t.l->>'supplier_id', '')), '')::uuid  AS supplier_id
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

  -- ---- 4b) El TERCERO de cada línea (054) -----------------------------------
  -- Uno u otro, nunca los dos: el CHECK de la tabla lo impide igual, pero acá
  -- el mensaje nombra la línea en vez de hablar de una constraint.
  SELECT string_agg(ord::text, ', ' ORDER BY ord) INTO v_terceros
    FROM pg_temp._pje_lineas
   WHERE client_id IS NOT NULL AND supplier_id IS NOT NULL;
  IF v_terceros IS NOT NULL THEN
    RAISE EXCEPTION
      'Línea(s) % con cliente Y proveedor a la vez: una línea nombra a UN tercero, o a ninguno.',
      v_terceros;
  END IF;

  -- Y el tercero es de ESTE bufete. Sin esto, un id de otro tenant quedaría
  -- escrito en un libro inmutable (la FK sola no mira el tenant).
  SELECT string_agg(DISTINCT l.client_id::text, ', ') INTO v_terceros
    FROM pg_temp._pje_lineas l
   WHERE l.client_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.clients c
        WHERE c.id = l.client_id AND c.tenant_id = p_tenant_id
     );
  IF v_terceros IS NOT NULL THEN
    RAISE EXCEPTION 'Cliente(s) inexistentes o de otro bufete: %', v_terceros;
  END IF;

  SELECT string_agg(DISTINCT l.supplier_id::text, ', ') INTO v_terceros
    FROM pg_temp._pje_lineas l
   WHERE l.supplier_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.suppliers s
        WHERE s.id = l.supplier_id AND s.tenant_id = p_tenant_id
     );
  IF v_terceros IS NOT NULL THEN
    RAISE EXCEPTION 'Proveedor(es) inexistentes o de otro bufete: %', v_terceros;
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

  -- 🔬 054: el tercero entra al `content_hash`. Es contenido contable —dice
  -- CONTRA QUIÉN se movió la cuenta—, con el mismo criterio con el que entró
  -- `reference` en la 039 y con el que quedó afuera `idempotency_key`.
  -- Los dos campos se concatenan SIEMPRE, también cuando van vacíos: una
  -- fórmula con forma variable no se puede auditar. Ver sop.md SOP-014 §
  -- "Las tres versiones de la fórmula".
  SELECT string_agg(
           concat_ws(':', code, debit::text, credit::text, coalesce(descr, ''),
                     coalesce(client_id::text, ''), coalesce(supplier_id::text, '')),
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
    tenant_id, entry_id, line_order, account_id, debit, credit, line_description,
    client_id, supplier_id
  )
  SELECT p_tenant_id, v_entry_id, l.ord, c.id, l.debit, l.credit, l.descr,
         l.client_id, l.supplier_id
    FROM pg_temp._pje_lineas l
    JOIN public.chart_of_accounts c
      ON c.tenant_id = p_tenant_id AND c.code = l.code
   ORDER BY l.ord;

  RETURN v_entry_id;
END $$;

COMMENT ON FUNCTION public.post_journal_entry IS
  'ÚNICA vía para escribir en el ledger. SECURITY DEFINER y EXECUTE solo para service_role: NO valida el tenant, confía en p_tenant_id. Quien la llame DEBE sacar el tenant del usuario autenticado y nunca del cuerpo del request. Valida partida doble, resuelve el período (creándolo si es el año en curso o el siguiente), toma el correlativo sin huecos y encadena el hash, todo en UNA transacción. Desde la 039 acepta `reference` (entra en el hash) e `idempotency_key` (no entra). Desde la 054 cada línea puede llevar `client_id` o `supplier_id` (uno o ninguno), que SÍ entran en el hash.';

-- ----------------------------------------------------------------------------
-- 3. Verificación de la migración
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_cols int;
  v_chk  text;
  v_def  text;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='journal_entry_lines'
     AND column_name IN ('client_id','supplier_id');
  IF v_cols <> 2 THEN
    RAISE EXCEPTION '054: se esperaban las 2 columnas de tercero, hay %', v_cols;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_chk FROM pg_constraint
   WHERE conrelid='public.journal_entry_lines'::regclass AND conname='jel_tercero_unico';
  IF v_chk IS NULL OR v_chk NOT ILIKE '%num_nonnulls%' THEN
    RAISE EXCEPTION '054: falta el CHECK jel_tercero_unico';
  END IF;

  -- Las FK tienen que ser NO ACTION (confdeltype 'a'): un SET NULL ('n') sería
  -- una bomba que solo estalla el día que alguien borra un cliente.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.journal_entry_lines'::regclass AND contype='f'
       AND conname IN ('journal_entry_lines_client_id_fkey','journal_entry_lines_supplier_id_fkey')
       AND confdeltype <> 'a'
  ) THEN
    RAISE EXCEPTION '054: alguna FK de tercero no quedó con ON DELETE NO ACTION';
  END IF;

  SELECT pg_get_functiondef('public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date, text, text)'::regprocedure)
    INTO v_def;
  IF position('client_id' IN v_def) = 0 OR position('supplier_id' IN v_def) = 0 THEN
    RAISE EXCEPTION '054: el motor no quedó con el tercero';
  END IF;
  IF has_function_privilege('anon', 'public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '054: anon o authenticated pueden ejecutar el motor';
  END IF;

  RAISE NOTICE '054 ✅ tercero por línea (client_id/supplier_id), CHECK, FK NO ACTION, índices y motor con el tercero en el hash';
END $$;

COMMIT;
