-- ============================================================================
-- 071 — MOTOR v4: NÚMERO DE DOCUMENTO, REFERENCIA EXTERNA Y TERCERO OBLIGATORIO
-- ============================================================================
-- 01/10/2026. Plan: `docs/finanzas/plan-bloque1.md`, puntos 2 y 10 (E3).
-- Respuestas de Josuarth en §7 del plan (P-2b, P-2c, P-2d).
--
-- Qué hace, en orden:
--   1. Secuencias nuevas: `purchase` (FAC-CO-, compras Y gastos de trámite,
--      P-2b) y `manual_entry` (AD-, asientos de diario). Sembradas en 0.
--   2. `business_expenses.purchase_number` y `expenses.purchase_number`
--      (FAC-CO-000001). Únicos por bufete y por tabla, y una vez asignados no
--      cambian (trigger nuevo).
--   3. `journal_entries.referencia_externa`: el papel de AFUERA (factura del
--      proveedor, cheque, transferencia, la referencia libre del asiento de
--      diario, P-2d). `reference` sigue siendo el número PROPIO del documento.
--   4. `source_type` admite `'cierre'` (cierre anual, E11).
--   5. `post_journal_entry` v4 (14 parámetros):
--        · `p_referencia_externa` nuevo, al final, con DEFAULT: las llamadas de
--          13 argumentos de los otros RPC siguen resolviendo a ésta.
--        · numera `AD-` adentro de la transacción para `manual`, `apertura` y
--          `cierre`: una importación de 200 asientos que falla no deja huecos.
--          Para esos tipos `p_reference` tiene que venir vacío: el número lo
--          pone el motor y el texto libre va en `p_referencia_externa`.
--        · una reversión hereda la `referencia_externa` del asiento que revierte
--          (como ya heredaba `reference`, que la pasa cada RPC).
--        · 🔴 TERCERO OBLIGATORIO en las cuentas con `cuenta_control`
--          (100004 = clientes, 200001 = proveedores). Ver el bloque 4c.
--        · 🔬 HASH v4: `referencia_externa` entra al `content_hash`.
--   6. `post_journal_entries_batch` (067): la referencia del Excel pasa a
--      `referencia_externa` (parche verificado, como la 069).
--   7. `create_supplier_credit_note` (066/069): prefijo `NCP-` → `NC-CO-`
--      (parche verificado). Los `NCP-` ya emitidos se quedan.
--   8. `reject_expense_mutation_si_asentado` (068): congela el número de la
--      factura del proveedor de un gasto ASENTADO, salvo completarlo si estaba
--      vacío (ahora entra al asiento como `referencia_externa`).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 NO SE TOCA EL LIBRO
-- ─────────────────────────────────────────────────────────────────────────────
-- Cero UPDATE/DELETE sobre journal_entries / journal_entry_lines. El ADD COLUMN
-- no dispara triggers de fila: las filas viejas quedan con
-- `referencia_externa` NULL y conservan el `content_hash` con el que nacieron.
-- `verify_accounting_chain` no recalcula `content_hash` (030), así que la cadena
-- vieja sigue verde. La v4 vale desde el primer asiento posteado después de
-- aplicar esta migración; SOP-014 la lista con fecha junto a las otras tres.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 VA JUNTO CON EL CÓDIGO NUEVO, NUNCA ANTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Con el candado de tercero y el de `p_reference` puesto, el código de `develop`
-- (asiento manual con referencia libre en `reference`, constructores sin
-- `client_id` antes de E2) FALLA al postear. En producción entra en la ventana
-- del despliegue, sin nadie operando, en el mismo merge que el código de E3.
-- Runbook: `docs/runbooks/despliegue-025-055.md`, nota de la 071.
--
-- IDEMPOTENCIA: los ADD/CREATE llevan IF NOT EXISTS; el motor se recrea; los
--               parches detectan la segunda corrida y no hacen nada.
-- 🛑 SOLO STAGING hasta la ventana del despliegue. Depende de la 068 y la 070.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'supplier_invoice_number'
  ) THEN
    RAISE EXCEPTION '071: falta expenses.supplier_invoice_number. Aplicar primero la 070.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Secuencias nuevas
-- ----------------------------------------------------------------------------
-- Los NUEVE valores de la 066 más los dos de E3. Re-declarado completo.
ALTER TABLE public.numbering_sequences DROP CONSTRAINT IF EXISTS numbering_sequences_sequence_type_check;
ALTER TABLE public.numbering_sequences ADD CONSTRAINT numbering_sequences_sequence_type_check
  CHECK (sequence_type IN ('quote', 'invoice_hon', 'invoice_reim', 'credit_note', 'client',
                           'supplier', 'payment', 'supplier_payment', 'supplier_credit_note',
                           'purchase', 'manual_entry'));

INSERT INTO public.numbering_sequences (tenant_id, sequence_type, last_number)
SELECT t.id, s.tipo, 0
  FROM public.tenants t
 CROSS JOIN (VALUES ('purchase'), ('manual_entry')) AS s(tipo)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Número interno de compra y de gasto de trámite (FAC-CO-)
-- ----------------------------------------------------------------------------
-- Las dos tablas comparten la secuencia `purchase` (P-2b): el número no se
-- repite entre ellas. Las filas viejas quedan en NULL: no se numeran hacia atrás
-- (en pantalla se muestra el número de la factura del proveedor).
ALTER TABLE public.business_expenses ADD COLUMN IF NOT EXISTS purchase_number text;
ALTER TABLE public.expenses          ADD COLUMN IF NOT EXISTS purchase_number text;

ALTER TABLE public.business_expenses DROP CONSTRAINT IF EXISTS business_expenses_purchase_number_formato;
ALTER TABLE public.business_expenses ADD CONSTRAINT business_expenses_purchase_number_formato
  CHECK (purchase_number IS NULL OR purchase_number ~ '^FAC-CO-[0-9]{6,}$');
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_purchase_number_formato;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_purchase_number_formato
  CHECK (purchase_number IS NULL OR purchase_number ~ '^FAC-CO-[0-9]{6,}$');

CREATE UNIQUE INDEX IF NOT EXISTS business_expenses_purchase_number_unique
  ON public.business_expenses (tenant_id, purchase_number) WHERE purchase_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_purchase_number_unique
  ON public.expenses (tenant_id, purchase_number) WHERE purchase_number IS NOT NULL;

COMMENT ON COLUMN public.business_expenses.purchase_number IS
  'Número interno FAC-CO-000001 (071, secuencia purchase, compartida con expenses). Es la `reference` del asiento. Una vez asignado no cambia. NULL en las compras anteriores a E3.';
COMMENT ON COLUMN public.expenses.purchase_number IS
  'Número interno FAC-CO-000001 (071, secuencia purchase, compartida con business_expenses). Se asigna al registrar el gasto en el libro y es la `reference` del asiento. Una vez asignado no cambia.';

-- Una vez asignado, el número no cambia ni se borra. Vale con o sin asiento:
-- es el número que se le comunicó a alguien.
CREATE OR REPLACE FUNCTION public.finanzas_numero_de_compra_inmutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.purchase_number IS NOT NULL
     AND NEW.purchase_number IS DISTINCT FROM OLD.purchase_number THEN
    RAISE EXCEPTION 'El número % ya está asignado y no se cambia.', OLD.purchase_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_business_expenses_numero_inmutable ON public.business_expenses;
CREATE TRIGGER trg_business_expenses_numero_inmutable
  BEFORE UPDATE OF purchase_number ON public.business_expenses
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_numero_de_compra_inmutable();
DROP TRIGGER IF EXISTS trg_expenses_numero_inmutable ON public.expenses;
CREATE TRIGGER trg_expenses_numero_inmutable
  BEFORE UPDATE OF purchase_number ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_numero_de_compra_inmutable();

-- ----------------------------------------------------------------------------
-- 3. Referencia externa del asiento
-- ----------------------------------------------------------------------------
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS referencia_externa text;
ALTER TABLE public.journal_entries DROP CONSTRAINT IF EXISTS journal_entries_referencia_externa_largo;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_referencia_externa_largo
  CHECK (referencia_externa IS NULL OR char_length(referencia_externa) BETWEEN 1 AND 100);

COMMENT ON COLUMN public.journal_entries.referencia_externa IS
  'Documento de AFUERA que respalda el asiento (071): N.º de factura del proveedor, cheque o transferencia, o la referencia libre del asiento de diario. `reference` es el número PROPIO (FAC-HON-, CO-, PA-, FAC-CO-, NC-, NC-CO-, AD-). Entra en el hash desde la v4. NULL en todo asiento anterior a la 071.';

-- ----------------------------------------------------------------------------
-- 4. source_type: + 'cierre'
-- ----------------------------------------------------------------------------
ALTER TABLE public.journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IN ('factura', 'gasto', 'gasto_tramite', 'pago', 'pago_proveedor',
                         'nota_credito', 'nota_credito_proveedor', 'manual', 'reversion',
                         'apertura', 'cierre'));

-- ----------------------------------------------------------------------------
-- 5. El motor v4
-- ----------------------------------------------------------------------------
-- DROP y CREATE porque cambia la firma (13 → 14). Un CREATE OR REPLACE con un
-- parámetro más crearía una SEGUNDA función y las llamadas de 13 argumentos
-- serían ambiguas. Los RPC que la llaman (reversores, NC de compra, lote) son
-- plpgsql: resuelven la función al ejecutarse, no al crearse, y con el DEFAULT
-- del parámetro nuevo siguen encontrando ésta.
DROP FUNCTION IF EXISTS public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date, text, text);

CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_tenant_id          uuid,
  p_transaction_date   date,
  p_description        text,
  p_source_type        text,
  p_lines              jsonb,
  p_source_id          uuid DEFAULT NULL,
  p_source_cufe        text DEFAULT NULL,
  p_reverses_entry_id  uuid DEFAULT NULL,
  p_reversal_reason    text DEFAULT NULL,
  p_created_by         uuid DEFAULT NULL,
  p_record_date        date DEFAULT NULL,
  p_reference          text DEFAULT NULL,
  p_idempotency_key    text DEFAULT NULL,
  -- Nuevo en la 071. Al FINAL y con DEFAULT: las llamadas existentes no cambian.
  p_referencia_externa text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record_date date := coalesce(p_record_date, current_date);
  v_reference   text := nullif(btrim(coalesce(p_reference, '')), '');
  v_ref_ext     text := nullif(btrim(coalesce(p_referencia_externa, '')), '');
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

  -- 071: en un asiento de diario el número propio (AD-) lo pone el motor. Un
  -- texto en `p_reference` es un llamador viejo que todavía manda ahí la
  -- referencia libre: se rechaza en vez de pisarlo en silencio.
  IF p_source_type IN ('manual', 'apertura', 'cierre') AND v_reference IS NOT NULL THEN
    RAISE EXCEPTION
      'El número del asiento de diario (AD-) lo asigna el sistema. La referencia libre va en la referencia externa.';
  END IF;
  IF v_ref_ext IS NOT NULL AND char_length(v_ref_ext) > 100 THEN
    RAISE EXCEPTION 'La referencia externa no puede pasar de 100 caracteres (tiene %).', char_length(v_ref_ext);
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
  SELECT string_agg(ord::text, ', ' ORDER BY ord) INTO v_terceros
    FROM pg_temp._pje_lineas
   WHERE client_id IS NOT NULL AND supplier_id IS NOT NULL;
  IF v_terceros IS NOT NULL THEN
    RAISE EXCEPTION
      'Línea(s) % con cliente Y proveedor a la vez: una línea nombra a UN tercero, o a ninguno.',
      v_terceros;
  END IF;

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

  -- ---- 4c) 071: TERCERO OBLIGATORIO EN LAS CUENTAS CONTROL ------------------
  -- Toda línea contra una cuenta `cuenta_control = 'clientes'` (100004) nombra
  -- un CLIENTE, y contra `'proveedores'` (200001) un PROVEEDOR. Es lo que deja
  -- que la antigüedad cuadre contra el Mayor por construcción (punto 10).
  --
  -- Excepciones, todas deliberadas:
  --   · `reversion`: el espejo copia el tercero del original (E2), y el
  --     original de un asiento anterior a E2 no lo tiene. Exigirlo dejaría sin
  --     corrección posible a todo lo viejo.
  --   · El PROVEEDOR no se exige en `gasto`, `gasto_tramite` y `pago_proveedor`:
  --     un gasto sin ficha de proveedor se registra igual (SOP-033) y el pago
  --     hereda esa falta. Lo que sí se rechaza ahí es un tercero del tipo
  --     equivocado.
  --   · Los mensajes dicen el número de línea y la cuenta, para que se lean
  --     igual desde el formulario que desde la importación.
  IF p_source_type <> 'reversion' THEN
    SELECT string_agg(format('línea %s (%s)', l.ord, l.code), ', ' ORDER BY l.ord) INTO v_terceros
      FROM pg_temp._pje_lineas l
      JOIN public.chart_of_accounts c ON c.tenant_id = p_tenant_id AND c.code = l.code
     WHERE c.cuenta_control = 'clientes' AND (l.client_id IS NULL OR l.supplier_id IS NOT NULL);
    IF v_terceros IS NOT NULL THEN
      RAISE EXCEPTION
        'La cuenta de clientes necesita el cliente en cada línea: falta en %. Elige el cliente para que el movimiento entre en su antigüedad.',
        v_terceros;
    END IF;

    SELECT string_agg(format('línea %s (%s)', l.ord, l.code), ', ' ORDER BY l.ord) INTO v_terceros
      FROM pg_temp._pje_lineas l
      JOIN public.chart_of_accounts c ON c.tenant_id = p_tenant_id AND c.code = l.code
     WHERE c.cuenta_control = 'proveedores'
       AND (l.client_id IS NOT NULL
            OR (l.supplier_id IS NULL
                AND p_source_type NOT IN ('gasto', 'gasto_tramite', 'pago_proveedor')));
    IF v_terceros IS NOT NULL THEN
      RAISE EXCEPTION
        'La cuenta de proveedores necesita el proveedor en cada línea: falta en %. Elige el proveedor para que el movimiento entre en su antigüedad.',
        v_terceros;
    END IF;
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

  -- ---- 6) Período (sin cambios desde la 030) ---------------------------------
  v_anio     := extract(year FROM p_transaction_date)::int;
  v_anio_hoy := extract(year FROM current_date)::int;

  SELECT id, status INTO v_period_id, v_period_st
    FROM public.accounting_periods
   WHERE tenant_id = p_tenant_id
     AND year  = v_anio
     AND month = extract(month FROM p_transaction_date)::int;

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

  -- ---- 6b) 071: lo que hereda una reversión ---------------------------------
  -- La referencia externa del original (cheque, factura del proveedor), igual
  -- que `reference`, que ya la pasa cada RPC.
  IF p_source_type = 'reversion' AND v_ref_ext IS NULL AND p_reverses_entry_id IS NOT NULL THEN
    SELECT referencia_externa INTO v_ref_ext
      FROM public.journal_entries
     WHERE tenant_id = p_tenant_id AND id = p_reverses_entry_id;
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

  -- 071: el número AD- del asiento de diario. Adentro de ESTA transacción y
  -- después de todas las validaciones: si algo falla, se deshace con el resto y
  -- no queda hueco. Es lo que permite que un lote de importación sea todo o
  -- nada también en la numeración.
  IF p_source_type IN ('manual', 'apertura', 'cierre') THEN
    INSERT INTO public.numbering_sequences (tenant_id, sequence_type, last_number)
    VALUES (p_tenant_id, 'manual_entry', 0)
    ON CONFLICT DO NOTHING;
    v_reference := 'AD-' || lpad(public.get_next_sequence_number(p_tenant_id, 'manual_entry')::text, 6, '0');
  END IF;

  -- ---- 8) Cadena de hash ---------------------------------------------------
  SELECT hash INTO v_prev_hash
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id
   ORDER BY entry_number DESC
   LIMIT 1;

  v_prev_hash := coalesce(v_prev_hash, c_genesis);

  SELECT string_agg(
           concat_ws(':', code, debit::text, credit::text, coalesce(descr, ''),
                     coalesce(client_id::text, ''), coalesce(supplier_id::text, '')),
           '|' ORDER BY ord
         )
    INTO v_lineas_txt
    FROM pg_temp._pje_lineas;

  -- 🔬 v4 (071): `referencia_externa` entra, justo después de `reference`, y se
  -- concatena SIEMPRE (vacía si no hay): una fórmula de forma variable no se
  -- puede auditar. Las cuatro versiones, con fecha, en sop.md SOP-014.
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
    coalesce(v_reference, ''),
    coalesce(v_ref_ext, ''),
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
    reference, idempotency_key, referencia_externa
  ) VALUES (
    p_tenant_id, v_next, v_period_id, p_transaction_date, v_record_date,
    btrim(p_description), p_source_type, p_source_id, p_source_cufe,
    p_reverses_entry_id, p_reversal_reason,
    v_content_h, v_prev_hash, v_hash, p_created_by,
    v_reference,
    nullif(btrim(coalesce(p_idempotency_key, '')), ''),
    v_ref_ext
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

COMMENT ON FUNCTION public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date, text, text, text) IS
  'ÚNICA vía para escribir en el ledger. SECURITY DEFINER y EXECUTE solo para service_role: NO valida el tenant, confía en p_tenant_id. Quien la llame DEBE sacar el tenant del usuario autenticado y nunca del cuerpo del request. Valida partida doble, resuelve el período, toma el correlativo sin huecos y encadena el hash, todo en UNA transacción. 039: reference (en el hash) e idempotency_key (no). 054: tercero por línea (en el hash). 071 (v4): referencia_externa (en el hash), número AD- propio para manual/apertura/cierre y tercero obligatorio en las cuentas con cuenta_control (salvo reversiones, y el proveedor en gasto/gasto_tramite/pago_proveedor).';

-- Los permisos de la 030, otra vez: un DROP se los lleva y un CREATE nuevo le
-- da EXECUTE a PUBLIC.
REVOKE EXECUTE ON FUNCTION
  public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date, text, text, text)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 6, 7 y 8. Parches verificados (técnica de la 069)
-- ----------------------------------------------------------------------------
DO $parche$
DECLARE
  r record;
  v_def text;
  v_n int;
  v_hechos int := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- 6. El lote: la referencia del Excel ya no va en `p_reference` (el motor
      --    pone el AD-) sino en `p_referencia_externa`.
      ('public.post_journal_entries_batch(uuid,text,text,integer,jsonb,uuid)',
         E'nullif\\(btrim\\(coalesce\\(v_e->>''reference'', ''''\\)\\), ''''\\),\\s*''imp:'' \\|\\| v_import_id::text \\|\\| '':'' \\|\\| v_n::text\\s*\\);',
         E'NULL,  -- 071: el AD- lo pone el motor\n'
         '      ''imp:'' || v_import_id::text || '':'' || v_n::text,\n'
         '      nullif(btrim(coalesce(v_e->>''reference'', '''')), '''')  -- 071: referencia externa\n'
         '    );',
         1, '071: referencia externa'),
      -- 7. NC de compra: NCP- → NC-CO- (P-2e, plan punto 2).
      ('public.create_supplier_credit_note(uuid,uuid,text,date,text,text,date,jsonb,jsonb,uuid)',
         E'v_numero := ''NCP-'' \\|\\| lpad',
         E'v_numero := ''NC-CO-'' || lpad',
         1, 'v_numero := ''NC-CO-'''),
      -- 8. Gasto de trámite asentado: el N.º de factura del proveedor entra al
      --    asiento (referencia externa) y se congela. Completarlo si estaba
      --    vacío sigue permitido (los gastos anteriores a E3).
      ('public.reject_expense_mutation_si_asentado()',
         E'  RETURN NEW;\\s*END ?\\$function\\$',
         E'  IF OLD.supplier_invoice_number IS NOT NULL\n'
         '     AND NEW.supplier_invoice_number IS DISTINCT FROM OLD.supplier_invoice_number THEN\n'
         '    RAISE EXCEPTION\n'
         '      ''El gasto % ya está registrado en el libro contable (asiento %): el número de la factura del proveedor ya no se cambia.'',\n'
         '      OLD.id, v_asiento\n'
         '      USING ERRCODE = ''restrict_violation'';\n'
         '  END IF;\n\n'
         '  RETURN NEW;\nEND $function$',
         1, 'OLD.supplier_invoice_number IS NOT NULL')
    ) AS t(fn, patron, reemplazo, esperado, marca)
  LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    -- Segunda corrida: el texto nuevo ya está. Se mira ANTES de contar, porque
    -- el patrón del 8 (el RETURN final) sigue apareciendo después del parche.
    IF position(r.marca IN v_def) > 0 THEN
      RAISE NOTICE '071 · % ya estaba aplicado', r.fn;
      CONTINUE;
    END IF;
    v_n := regexp_count(v_def, r.patron);
    IF v_n <> r.esperado THEN
      RAISE EXCEPTION '071: en % el patrón «%» aparece % vez/veces (se esperaba %). No se toca nada: revisar la función a mano.',
        r.fn, left(r.patron, 60), v_n, r.esperado;
    END IF;
    EXECUTE regexp_replace(v_def, r.patron, r.reemplazo);
    v_hechos := v_hechos + 1;
  END LOOP;
  RAISE NOTICE '071 · % parche(s) aplicados', v_hechos;
END $parche$;

-- ----------------------------------------------------------------------------
-- 9. Verificación
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  c_firma CONSTANT text := 'public.post_journal_entry(uuid, date, text, text, jsonb, uuid, text, uuid, text, uuid, date, text, text, text)';
  v_def  text;
  v_n    int;
BEGIN
  -- Una sola versión del motor, la de 14.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'post_journal_entry';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '071: se esperaba UNA post_journal_entry, hay %', v_n;
  END IF;

  v_def := pg_get_functiondef(c_firma::regprocedure);
  IF position('coalesce(v_ref_ext, '''')' IN v_def) = 0 THEN
    RAISE EXCEPTION '071: la referencia externa no quedó en el hash';
  END IF;
  IF position('''manual_entry''' IN v_def) = 0 OR position('cuenta_control' IN v_def) = 0 THEN
    RAISE EXCEPTION '071: el motor no quedó con el AD- o con el tercero obligatorio';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = c_firma::regprocedure) THEN
    RAISE EXCEPTION '071: el motor perdió SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', c_firma, 'EXECUTE')
     OR has_function_privilege('authenticated', c_firma, 'EXECUTE')
     OR NOT has_function_privilege('service_role', c_firma, 'EXECUTE') THEN
    RAISE EXCEPTION '071: los permisos del motor no son los de la 030 (solo service_role)';
  END IF;

  v_def := pg_get_functiondef('public.post_journal_entries_batch(uuid,text,text,integer,jsonb,uuid)'::regprocedure);
  IF position('071: referencia externa' IN v_def) = 0 THEN
    RAISE EXCEPTION '071: el lote no quedó mandando la referencia a referencia_externa';
  END IF;

  v_def := pg_get_functiondef('public.create_supplier_credit_note(uuid,uuid,text,date,text,text,date,jsonb,jsonb,uuid)'::regprocedure);
  IF position('''NCP-''' IN v_def) > 0 OR position('''NC-CO-''' IN v_def) = 0 THEN
    RAISE EXCEPTION '071: la NC de compra no quedó con el prefijo NC-CO-';
  END IF;

  v_def := pg_get_functiondef('public.reject_expense_mutation_si_asentado()'::regprocedure);
  IF position('OLD.supplier_invoice_number' IN v_def) = 0 THEN
    RAISE EXCEPTION '071: el número de factura del proveedor no quedó congelado';
  END IF;

  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'journal_entries'   AND column_name = 'referencia_externa')
       OR (table_name = 'business_expenses' AND column_name = 'purchase_number')
       OR (table_name = 'expenses'          AND column_name = 'purchase_number'));
  IF v_n <> 3 THEN
    RAISE EXCEPTION '071: se esperaban 3 columnas nuevas, hay %', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.tenants t
   WHERE NOT EXISTS (SELECT 1 FROM public.numbering_sequences s
                      WHERE s.tenant_id = t.id AND s.sequence_type = 'purchase')
      OR NOT EXISTS (SELECT 1 FROM public.numbering_sequences s
                      WHERE s.tenant_id = t.id AND s.sequence_type = 'manual_entry');
  IF v_n > 0 THEN
    RAISE EXCEPTION '071: % bufete(s) sin las secuencias purchase/manual_entry', v_n;
  END IF;

  -- Informativo: en la primera corrida tiene que dar 0 (el libro no se tocó).
  SELECT count(*) INTO v_n FROM public.journal_entries WHERE referencia_externa IS NOT NULL;
  RAISE NOTICE '071 · asientos con referencia externa: % (0 en la primera corrida)', v_n;

  RAISE NOTICE '071 ✅ secuencias FAC-CO/AD, purchase_number, referencia_externa, cierre, motor v4 (14 parámetros, hash v4, AD-, tercero obligatorio), lote, NC-CO- y factura del proveedor congelada';
END $$;

COMMIT;
