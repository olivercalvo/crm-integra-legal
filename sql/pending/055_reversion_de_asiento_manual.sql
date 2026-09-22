-- ============================================================================
-- 055 — REVERSAR UN ASIENTO MANUAL, y una sola reversión por asiento
-- ============================================================================
-- Bloque 7, commit 6 (22/09/2026). Hasta hoy un asiento de diario mal cargado
-- se quedaba en el libro y la única salida era escribir otro a mano: la propia
-- pantalla de carga lo decía («…requiere un asiento de reversión, que todavía
-- no está disponible en el sistema»).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- GENÉRICO EN LA FIRMA, FILTRADO A `manual` ADENTRO (D8)
-- ─────────────────────────────────────────────────────────────────────────────
-- Los otros tres reversores —`reverse_payment` (046), `reverse_supplier_payment`
-- (048/049) y `reverse_expense_tramite` (050)— son específicos porque cada uno
-- tiene que TOCAR SU DOCUMENTO además de postear el espejo: borrar las
-- `payment_applications` y marcar el cobro `anulado`, marcar el pago `anulado`,
-- marcar el gasto `anulado`. Eso es lo que no se puede generalizar.
--
-- Un asiento manual NO tiene documento. No hay estado que cambiar, no hay filas
-- que borrar, no hay derivada que recalcular: queda el espejo y nada más. Por
-- eso este es el más chico de los cuatro y toma el `entry_id` en vez de un
-- documento.
--
-- 🔴 **Y por eso mismo filtra `source_type = 'manual'` adentro.** Reversar desde
-- acá el asiento de una FACTURA sería saltarse `cancelInvoice`, el gate de mes
-- cerrado y toda la lógica de nota de crédito del Bloque 5; el de un COBRO
-- dejaría la factura pagada con la plata devuelta (T7a cuelga de
-- `payment_applications`, no del asiento). El camino de cada documento es el
-- suyo. Tres capas lo sostienen:
--
--   1. este RPC, que es el permiso (`EXECUTE` solo para `service_role`);
--   2. la ruta de API, con sus roles;
--   3. la pantalla, que solo ofrece el botón en los manuales.
--
-- Y no hay una cuarta puerta: `POST /api/finanzas/asientos` fuerza
-- `source_type: 'manual'` y **nunca acepta `reverses_entry_id`**, así que una
-- reversión no se puede fabricar por el camino de la carga normal.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔒 UNA SOLA REVERSIÓN POR ASIENTO — el índice que faltaba
-- ─────────────────────────────────────────────────────────────────────────────
-- Hasta hoy, "no reversar dos veces lo mismo" vivía SOLO dentro de cada RPC
-- (`IF v_ya_nro IS NOT NULL THEN RAISE`), repetido tres veces y a punto de
-- repetirse una cuarta. Verificado el 22/09: `journal_entries` tenía cuatro
-- índices únicos —`pkey`, `(tenant_id, entry_number)`, `(tenant_id,
-- idempotency_key)` parcial y `(tenant_id, source_type, source_id)` parcial— y
-- ninguno sobre `reverses_entry_id`.
--
-- El índice cierra los cuatro caminos de una vez, en la base. 📋 Pre-flight
-- corrido en staging antes de crearlo: 9 reversiones sobre 9 asientos
-- distintos, **ningún asiento reversado dos veces**. En producción hay que
-- repetir ese conteo antes de aplicar (la consulta está en el §5 de abajo).
--
-- 📋 Verificado contra information_schema / pg_constraint el 22/09/2026:
--    `journal_entries.reverses_entry_id` es uuid NULL con FK a `journal_entries`;
--    `source_type` es text NOT NULL con el CHECK de nueve valores de la `042`.
--
-- IDEMPOTENCIA: CREATE OR REPLACE + CREATE UNIQUE INDEX IF NOT EXISTS.
-- Verificación: sql/tests/verificacion-055-reversion-de-asiento.sql
-- (ROLLBACK, con falla forzada después de postear).
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Una sola reversión por asiento (D8)
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_dobles int;
BEGIN
  SELECT count(*) INTO v_dobles FROM (
    SELECT tenant_id, reverses_entry_id
      FROM public.journal_entries
     WHERE reverses_entry_id IS NOT NULL
     GROUP BY tenant_id, reverses_entry_id
    HAVING count(*) > 1
  ) d;
  IF v_dobles > 0 THEN
    RAISE EXCEPTION
      '% asiento(s) ya están reversados DOS veces. El índice único no se puede crear sin decidir qué hacer con ellos: pará y avisá.',
      v_dobles;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_una_reversion_por_asiento
  ON public.journal_entries (tenant_id, reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

COMMENT ON INDEX public.journal_entries_una_reversion_por_asiento IS
  'Un asiento se reversa UNA vez (055). Antes esto vivía solo dentro de cada RPC de reversión, repetido en tres funciones. Parcial: los asientos que no reversan nada no compiten entre sí.';

-- ----------------------------------------------------------------------------
-- 2. El reversor
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
  p_tenant_id        uuid,
  p_entry_id         uuid,
  p_reason           text,
  p_transaction_date date,
  p_description      text,
  p_lines            jsonb,
  p_created_by       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_type text;
  v_orig_nro    bigint;
  v_orig_ref    text;
  v_orig_date   date;
  v_ya_nro      bigint;
  v_dif         int;
  v_entry_id    uuid;
  v_entry_nro   bigint;
BEGIN
  IF p_tenant_id IS NULL OR p_entry_id IS NULL THEN
    RAISE EXCEPTION 'reverse_journal_entry: faltan el tenant o el asiento';
  END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'La reversión necesita un motivo de al menos 3 caracteres (DE 34/1998 Art. 5.7)';
  END IF;
  -- La fecha es la de HOY, como en las otras tres (acta del 09/09). El margen
  -- de un día cubre la medianoche y las zonas horarias, nada más.
  IF p_transaction_date IS NULL OR abs(p_transaction_date - current_date) > 1 THEN
    RAISE EXCEPTION 'La reversión lleva la fecha en que se hace (hoy, %), nunca otra: llegó %',
      current_date, coalesce(p_transaction_date::text, 'NULL');
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'reverse_journal_entry: las líneas del espejo deben venir como un array JSON de al menos 2';
  END IF;

  SELECT source_type, entry_number, reference, transaction_date
    INTO v_source_type, v_orig_nro, v_orig_ref, v_orig_date
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND id = p_entry_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asiento no encontrado';
  END IF;

  -- 🔴 EL FILTRO (D8). Desde acá solo se reversa lo que se cargó a mano.
  IF v_source_type <> 'manual' THEN
    RAISE EXCEPTION
      'El asiento % salió de un documento (%), no de una carga manual: desde acá no se reversa. Se corrige por su documento —anulando la factura, reversando el cobro o el gasto—, que además actualiza el estado de ese documento.',
      v_orig_nro, v_source_type;
  END IF;

  IF p_transaction_date < v_orig_date THEN
    RAISE EXCEPTION 'La reversión (%) no puede ser anterior al asiento que revierte (asiento %, %)',
      p_transaction_date, v_orig_nro, v_orig_date;
  END IF;

  -- Doble candado: el mensaje entendible acá, el índice único abajo. El índice
  -- es el que sostiene la regla si alguien llama sin pasar por este camino.
  SELECT entry_number INTO v_ya_nro
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND reverses_entry_id = p_entry_id
   LIMIT 1;
  IF v_ya_nro IS NOT NULL THEN
    RAISE EXCEPTION 'El asiento % ya fue reversado por el asiento %.', v_orig_nro, v_ya_nro;
  END IF;

  -- El espejo se VERIFICA, no se recalcula: lo arma `construirAsientoDeReversion`
  -- —la misma función que dibuja la vista previa— y acá se comprueba que sea el
  -- reflejo exacto, con EXCEPT ALL en los dos sentidos (mismo cerrojo que 046).
  WITH esperado AS (
    SELECT c.code AS code, l.credit AS debit, l.debit AS credit
      FROM public.journal_entry_lines l
      JOIN public.chart_of_accounts c ON c.id = l.account_id
     WHERE l.entry_id = p_entry_id
  ), recibido AS (
    SELECT btrim(x->>'account_code')                      AS code,
           round(coalesce((x->>'debit')::numeric, 0), 2)  AS debit,
           round(coalesce((x->>'credit')::numeric, 0), 2) AS credit
      FROM jsonb_array_elements(p_lines) x
  )
  SELECT count(*) INTO v_dif
    FROM (
      (SELECT code, debit, credit FROM esperado EXCEPT ALL SELECT code, debit, credit FROM recibido)
      UNION ALL
      (SELECT code, debit, credit FROM recibido EXCEPT ALL SELECT code, debit, credit FROM esperado)
    ) d;
  IF v_dif > 0 THEN
    RAISE EXCEPTION
      'Las líneas recibidas no son el espejo exacto del asiento %: se rechaza la reversión para no descuadrar el libro.',
      v_orig_nro;
  END IF;

  -- El espejo NO lleva el tercero de vuelta: `p_lines` son cuenta, débito,
  -- crédito y glosa. Es una decisión, no un olvido — el tercero de la reversión
  -- se hereda mirando el asiento original, que queda enlazado por
  -- `reverses_entry_id`, y duplicarlo abriría la puerta a que difieran.
  v_entry_id := public.post_journal_entry(
    p_tenant_id, p_transaction_date, p_description, 'reversion', p_lines,
    -- `source_id` NULL: un asiento manual no tiene documento, y ponerle el id
    -- del asiento original haría que el Mayor intentara abrirlo como si lo
    -- fuera. El vínculo es `reverses_entry_id`.
    NULL, NULL, p_entry_id, btrim(p_reason), p_created_by, NULL, v_orig_ref, NULL
  );
  SELECT entry_number INTO v_entry_nro FROM public.journal_entries WHERE id = v_entry_id;

  RETURN jsonb_build_object(
    'entry_id',              v_entry_id,
    'entry_number',          v_entry_nro,
    'reversed_entry_id',     p_entry_id,
    'reversed_entry_number', v_orig_nro,
    'transaction_date',      p_transaction_date
  );
END $$;

REVOKE EXECUTE ON FUNCTION
  public.reverse_journal_entry(uuid, uuid, text, date, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.reverse_journal_entry(uuid, uuid, text, date, text, jsonb, uuid)
  TO service_role;

COMMENT ON FUNCTION public.reverse_journal_entry IS
  'Reversa un asiento MANUAL: verifica que el espejo sea exacto (EXCEPT ALL), que nadie lo haya reversado antes y que la fecha sea la de hoy, y lo postea con reverses_entry_id. Rechaza cualquier source_type que no sea manual: un asiento con documento se corrige por su documento. SECURITY DEFINER, EXECUTE solo service_role.';

-- ----------------------------------------------------------------------------
-- 3. Verificación de la migración
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_n int; v_def text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'reverse_journal_entry';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '055: se esperaba una firma de reverse_journal_entry, hay %', v_n;
  END IF;
  IF has_function_privilege('anon', 'public.reverse_journal_entry(uuid, uuid, text, date, text, jsonb, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reverse_journal_entry(uuid, uuid, text, date, text, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '055: anon o authenticated pueden ejecutar el reversor';
  END IF;
  SELECT pg_get_functiondef('public.reverse_journal_entry(uuid, uuid, text, date, text, jsonb, uuid)'::regprocedure) INTO v_def;
  IF position('v_source_type <> ''manual''' IN v_def) = 0 THEN
    RAISE EXCEPTION '055: el filtro por source_type manual no quedó en la función';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'journal_entries' AND indexname = 'journal_entries_una_reversion_por_asiento'
  ) THEN
    RAISE EXCEPTION '055: falta el índice único de una reversión por asiento';
  END IF;
  RAISE NOTICE '055 ✅ reverse_journal_entry (solo manual) y el índice de una reversión por asiento';
END $$;

COMMIT;

-- ============================================================================
-- 5. PRE-FLIGHT PARA PRODUCCIÓN — correr ANTES de aplicar esta migración
-- ============================================================================
-- Tiene que devolver CERO filas. Si devuelve alguna, hay un asiento reversado
-- dos veces y el índice único no se puede crear sin decidir qué hacer con él.
--
--   SELECT reverses_entry_id, count(*) AS veces,
--          string_agg(entry_number::text, ', ' ORDER BY entry_number) AS espejos
--     FROM journal_entries
--    WHERE reverses_entry_id IS NOT NULL
--    GROUP BY tenant_id, reverses_entry_id
--   HAVING count(*) > 1;
-- ============================================================================
