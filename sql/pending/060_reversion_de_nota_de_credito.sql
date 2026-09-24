-- ============================================================================
-- 060 — REVERSAR UNA NOTA DE CRÉDITO
-- ============================================================================
-- Bloque 9C (24/09/2026). Es lo ÚNICO que quedó sin construir del Bloque 5: la
-- nota de crédito se emitía y no había forma de deshacerla. `CLAUDE.md` lo dice
-- desde el 22/09 — «Lo que sigue sin existir es la reversión de una nota de
-- crédito» — y la pantalla no ofrecía ningún botón.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 LO QUE NO HACE ESTA MIGRACIÓN: SUMAR NI RESTAR
-- ─────────────────────────────────────────────────────────────────────────────
-- `invoices.credited_total` es DERIVADA desde la `051`: el trigger
-- `trg_recalc_invoice_credited` llama a `finanzas_recalc_one_invoice_credited`,
-- que hace `SUM(grand_total) WHERE status = 'emitida'`, y ésa a su vez llama a
-- `finanzas_recalc_one_invoice_amount_paid`, que rehace `balance_due` y el
-- `status` de la factura (T7a).
--
-- Así que la reversión NO toca ninguno de los tres números. Cambia UN estado:
--
--     UPDATE credit_notes SET status = 'anulada' ...
--
-- y el trigger que ya existía recalcula `credited_total`, `balance_due` y
-- `status` solo, con la MISMA función que los calculó al emitirla. Es la
-- propiedad que importa: emisión y reversión no pueden discrepar porque no hay
-- dos fórmulas, hay una. Restar `grand_total` a mano habría sido más corto y
-- habría creado la segunda.
--
-- Corolario: `finanzas_guard_credited_total` NO necesita una válvula nueva. El
-- recalculador ya abre `finanzas.recalc` por su cuenta.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 UNA NC SIN ASIENTO NO SE REVERSA DESDE ACÁ (el filtro, como en la 055)
-- ─────────────────────────────────────────────────────────────────────────────
-- Hay dos clases de nota de crédito, y la diferencia es exactamente D5:
--
--   • NC posterior o parcial → tiene asiento PROPIO (`source_type =
--     'nota_credito'`). Ésta es la que se reversa acá.
--   • NC de una ANULACIÓN de factura → **no tiene asiento propio**, porque la
--     anulación ya reversó el asiento de la factura y contabilizarla aparte
--     sería contar dos veces.
--
-- Reversar la segunda sería des-anular una factura por la puerta de atrás, sin
-- pasar por `cancelInvoice` ni por el gate de mes cerrado. El RPC lo rechaza
-- con un mensaje que dice qué hacer en su lugar. Medido hoy en staging: de 6
-- NC, 2 tienen asiento propio y 4 salieron de anulaciones.
--
-- 📋 Verificado contra information_schema / pg_constraint / pg_trigger el
--    24/09/2026 en staging (xtyenhakplrkyifbcaow):
--      · `credit_notes.status` es text NOT NULL con CHECK (status = 'emitida')
--        — un único valor. Contado en la base: 6 filas, todas `emitida`.
--      · `credit_notes` NO tiene ninguna columna `cancel*`, `anul*`, `revers*`
--        ni `posted*`. El asiento se resuelve por (source_type, source_id).
--      · `finanzas_credit_note_immutability` rechaza HOY todo cambio de
--        `status`; por eso hay que reemplazarla, no basta con el CHECK.
--      · `journal_entries_una_reversion_por_asiento` (055) ya existe: UNIQUE
--        (tenant_id, reverses_entry_id) WHERE reverses_entry_id IS NOT NULL.
--      · `journal_entries_un_asiento_por_documento`: UNIQUE (tenant_id,
--        source_type, source_id) WHERE source_id IS NOT NULL — el espejo va
--        con source_type 'reversion', así que no choca con el 'nota_credito'.
--
-- IDEMPOTENCIA: DROP/ADD CONSTRAINT con nombre fijo, ADD COLUMN IF NOT EXISTS,
--               CREATE OR REPLACE FUNCTION.
-- Verificación: sql/tests/verificacion-060-reversion-nota-de-credito.sql
--               (ROLLBACK, con falla forzada después de postear).
-- 🛑 SOLO STAGING. En producción no está aplicada ni la 051.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. El status admite 'anulada'
-- ----------------------------------------------------------------------------
-- El CHECK se re-declara COMPLETO con los valores contados desde la base
-- (`emitida` = 6 filas, ningún otro), no incrementalmente.
ALTER TABLE public.credit_notes DROP CONSTRAINT IF EXISTS credit_notes_status_check;
ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_status_check
  CHECK (status IN ('emitida', 'anulada'));

-- ----------------------------------------------------------------------------
-- 2. El rastro de la anulación
-- ----------------------------------------------------------------------------
ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- Las tres cosas van juntas o no va ninguna. Una NC `anulada` sin motivo es un
-- agujero en la auditoría, y una `emitida` con `cancelled_at` es basura que
-- después nadie sabe leer.
ALTER TABLE public.credit_notes DROP CONSTRAINT IF EXISTS credit_notes_anulacion_completa_check;
ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_anulacion_completa_check
  CHECK (
    (status = 'anulada'
      AND cancelled_at IS NOT NULL
      AND cancellation_reason IS NOT NULL
      AND length(btrim(cancellation_reason)) >= 3)
    OR
    (status <> 'anulada' AND cancelled_at IS NULL AND cancellation_reason IS NULL)
  );

COMMENT ON COLUMN public.credit_notes.cancelled_at IS
  'Cuándo se reversó la NC. NULL mientras está emitida (CHECK credit_notes_anulacion_completa_check).';
COMMENT ON COLUMN public.credit_notes.cancellation_reason IS
  'Motivo de la reversión, mínimo 3 caracteres. Va al reversal_reason del asiento espejo.';

-- ----------------------------------------------------------------------------
-- 3. Inmutabilidad: se abre UNA transición, y sólo una
-- ----------------------------------------------------------------------------
-- La versión anterior rechazaba TODO cambio de `status`. Se reemplaza para
-- permitir exactamente `emitida` → `anulada`. Sigue rechazando el camino de
-- vuelta (`anulada` → `emitida`): una NC reversada no revive, se emite otra.
CREATE OR REPLACE FUNCTION public.finanzas_credit_note_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- Si CUALQUIER campo no-whitelisted cambió → rechazar.
  -- Whitelist: subtotal_total, tax_total, grand_total, updated_at, las columnas
  -- fiscales (fe_estado, dgi_*, qr_content, ef_invoice_uuid…) y, desde la 060,
  -- la transición de anulación.
  IF OLD.id                  IS DISTINCT FROM NEW.id
     OR OLD.tenant_id          IS DISTINCT FROM NEW.tenant_id
     OR OLD.credit_note_number IS DISTINCT FROM NEW.credit_note_number
     OR OLD.invoice_id         IS DISTINCT FROM NEW.invoice_id
     OR OLD.client_id          IS DISTINCT FROM NEW.client_id
     OR OLD.issue_date         IS DISTINCT FROM NEW.issue_date
     OR OLD.reason             IS DISTINCT FROM NEW.reason
     OR OLD.currency           IS DISTINCT FROM NEW.currency
     OR OLD.created_at         IS DISTINCT FROM NEW.created_at
     OR OLD.created_by         IS DISTINCT FROM NEW.created_by
  THEN
    RAISE EXCEPTION 'Nota de crédito % es inmutable: solo se permiten cambios a subtotal_total, tax_total, grand_total, updated_at, los campos fiscales y la anulación',
      OLD.credit_note_number
      USING ERRCODE = 'check_violation';
  END IF;

  -- 🔴 El status ya no está en la lista de arriba, así que se controla acá: la
  -- ÚNICA transición permitida es emitida → anulada.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'emitida' AND NEW.status = 'anulada')
  THEN
    RAISE EXCEPTION 'Nota de crédito %: la única transición de estado permitida es emitida → anulada (llegó % → %)',
      OLD.credit_note_number, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Y el rastro de la anulación no se re-escribe ni se borra una vez puesto.
  IF OLD.cancelled_at IS NOT NULL
     AND (OLD.cancelled_at        IS DISTINCT FROM NEW.cancelled_at
       OR OLD.cancellation_reason IS DISTINCT FROM NEW.cancellation_reason)
  THEN
    RAISE EXCEPTION 'Nota de crédito %: la anulación ya está registrada y no se modifica',
      OLD.credit_note_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.finanzas_credit_note_immutability IS
  'Inmutabilidad de la NC. Desde la 060 permite la ÚNICA transición emitida → anulada, y congela cancelled_at / cancellation_reason una vez puestos.';

-- ----------------------------------------------------------------------------
-- 4. El reversor
-- ----------------------------------------------------------------------------
-- Mismo molde que `reverse_payment` (046), `reverse_supplier_payment` (048),
-- `reverse_expense_tramite` (050) y `reverse_journal_entry` (055): UNA
-- transacción, fecha de hoy, el espejo se VERIFICA (no se recalcula) y el
-- documento cambia de estado adentro.
--
-- DOS escrituras, no tres como en los cobros: acá no hay filas que borrar. El
-- `UPDATE` del status dispara `trg_recalc_invoice_credited` y la factura se
-- recalcula sola. Ver el encabezado.
CREATE OR REPLACE FUNCTION public.reverse_credit_note(
  p_tenant_id        uuid,
  p_credit_note_id   uuid,
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
AS $fn$
DECLARE
  v_nc_numero   text;
  v_nc_status   text;
  v_invoice_id  uuid;
  v_inv_numero  text;
  v_orig_id     uuid;
  v_orig_nro    bigint;
  v_orig_ref    text;
  v_orig_date   date;
  v_ya_nro      bigint;
  v_dif         int;
  v_entry_id    uuid;
  v_entry_nro   bigint;
  v_credited    numeric(12,2);
  v_balance     numeric(12,2);
  v_inv_status  text;
BEGIN
  IF p_tenant_id IS NULL OR p_credit_note_id IS NULL THEN
    RAISE EXCEPTION 'reverse_credit_note: faltan el tenant o la nota de crédito';
  END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'La reversión necesita un motivo de al menos 3 caracteres (DE 34/1998 Art. 5.7)';
  END IF;
  -- La fecha es la de HOY, como en las otras cuatro (acta del 09/09). El margen
  -- de un día cubre la medianoche y las zonas horarias, nada más.
  IF p_transaction_date IS NULL OR abs(p_transaction_date - current_date) > 1 THEN
    RAISE EXCEPTION 'La reversión lleva la fecha en que se hace (hoy, %), nunca otra: llegó %',
      current_date, coalesce(p_transaction_date::text, 'NULL');
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'reverse_credit_note: las líneas del espejo deben venir como un array JSON de al menos 2';
  END IF;

  SELECT credit_note_number, status, invoice_id
    INTO v_nc_numero, v_nc_status, v_invoice_id
    FROM public.credit_notes
   WHERE tenant_id = p_tenant_id AND id = p_credit_note_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota de crédito no encontrada';
  END IF;
  IF v_nc_status = 'anulada' THEN
    RAISE EXCEPTION 'La nota de crédito % ya está anulada.', v_nc_numero;
  END IF;

  SELECT invoice_number INTO v_inv_numero FROM public.invoices WHERE id = v_invoice_id;

  -- 🔴 EL FILTRO. Una NC sin asiento propio salió de la anulación de su factura
  --    (D5) y des-anularla desde acá se saltaría `cancelInvoice` entera.
  SELECT id, entry_number, reference, transaction_date
    INTO v_orig_id, v_orig_nro, v_orig_ref, v_orig_date
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id
     AND source_type = 'nota_credito'
     AND source_id = p_credit_note_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La nota de crédito % no tiene asiento propio: salió de la anulación de la factura %, que ya reversó el asiento de esa factura. No hay nada que reversar acá. Si la anulación fue un error, se corrige emitiendo una factura nueva.',
      v_nc_numero, coalesce(v_inv_numero, '(sin número)');
  END IF;

  IF p_transaction_date < v_orig_date THEN
    RAISE EXCEPTION 'La reversión (%) no puede ser anterior al asiento que revierte (asiento %, %)',
      p_transaction_date, v_orig_nro, v_orig_date;
  END IF;

  -- Doble candado: el mensaje entendible acá, el índice único de la 055 abajo.
  SELECT entry_number INTO v_ya_nro
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND reverses_entry_id = v_orig_id
   LIMIT 1;
  IF v_ya_nro IS NOT NULL THEN
    RAISE EXCEPTION 'La nota de crédito % ya fue reversada por el asiento %.', v_nc_numero, v_ya_nro;
  END IF;

  -- El espejo se VERIFICA, no se recalcula: lo arma `construirAsientoDeReversion`
  -- —la misma función que dibuja la vista previa— y acá se comprueba que sea el
  -- reflejo exacto, con EXCEPT ALL en los dos sentidos (mismo cerrojo que 046).
  WITH esperado AS (
    SELECT c.code AS code, l.credit AS debit, l.debit AS credit
      FROM public.journal_entry_lines l
      JOIN public.chart_of_accounts c ON c.id = l.account_id
     WHERE l.entry_id = v_orig_id
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
      'Las líneas recibidas no son el espejo exacto del asiento % de la nota de crédito %: se rechaza la reversión para no descuadrar el libro.',
      v_orig_nro, v_nc_numero;
  END IF;

  -- ESCRITURA 1 — el espejo.
  v_entry_id := public.post_journal_entry(
    p_tenant_id, p_transaction_date, p_description, 'reversion', p_lines,
    p_credit_note_id, NULL, v_orig_id, btrim(p_reason), p_created_by, NULL, v_orig_ref, NULL
  );
  SELECT entry_number INTO v_entry_nro FROM public.journal_entries WHERE id = v_entry_id;

  -- ESCRITURA 2 — el estado. Y NADA MÁS: `trg_recalc_invoice_credited` recalcula
  -- credited_total, y en cascada balance_due y el status de la factura.
  UPDATE public.credit_notes
     SET status              = 'anulada',
         cancelled_at        = now(),
         cancellation_reason = btrim(p_reason)
   WHERE tenant_id = p_tenant_id AND id = p_credit_note_id;

  SELECT credited_total, balance_due, status
    INTO v_credited, v_balance, v_inv_status
    FROM public.invoices WHERE id = v_invoice_id;

  RETURN jsonb_build_object(
    'entry_id',              v_entry_id,
    'entry_number',          v_entry_nro,
    'reversed_entry_id',     v_orig_id,
    'reversed_entry_number', v_orig_nro,
    'transaction_date',      p_transaction_date,
    'credit_note_number',    v_nc_numero,
    'invoice', jsonb_build_object(
      'invoice_id',     v_invoice_id,
      'invoice_number', v_inv_numero,
      'credited_total', v_credited,
      'balance_due',    v_balance,
      'status',         v_inv_status
    )
  );
END $fn$;

REVOKE EXECUTE ON FUNCTION
  public.reverse_credit_note(uuid, uuid, text, date, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.reverse_credit_note(uuid, uuid, text, date, text, jsonb, uuid)
  TO service_role;

COMMENT ON FUNCTION public.reverse_credit_note IS
  'Reversa una nota de crédito CON asiento propio: verifica que el espejo sea exacto (EXCEPT ALL), que nadie la haya reversado antes y que la fecha sea la de hoy, postea con reverses_entry_id y marca la NC anulada. credited_total, balance_due y el status de la factura NO se escriben: los recalcula trg_recalc_invoice_credited. Rechaza las NC sin asiento (las que salen de anular una factura). SECURITY DEFINER, EXECUTE solo service_role.';

-- ----------------------------------------------------------------------------
-- 5. Verificación de la migración
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_n int; v_def text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'reverse_credit_note';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '060: se esperaba una firma de reverse_credit_note, hay %', v_n;
  END IF;
  IF has_function_privilege('anon', 'public.reverse_credit_note(uuid, uuid, text, date, text, jsonb, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reverse_credit_note(uuid, uuid, text, date, text, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '060: anon o authenticated pueden ejecutar el reversor';
  END IF;

  -- El CHECK admite los dos valores y NINGÚN otro.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.credit_notes'::regclass AND conname = 'credit_notes_status_check';
  IF position('anulada' IN v_def) = 0 OR position('emitida' IN v_def) = 0 THEN
    RAISE EXCEPTION '060: el CHECK de status no quedó con los dos valores (%)', v_def;
  END IF;

  -- 🔴 La propiedad del encabezado: el reversor NO escribe credited_total.
  SELECT pg_get_functiondef('public.reverse_credit_note(uuid, uuid, text, date, text, jsonb, uuid)'::regprocedure) INTO v_def;
  IF position('credited_total =' IN v_def) > 0 OR position('balance_due =' IN v_def) > 0 THEN
    RAISE EXCEPTION '060: el reversor escribe credited_total o balance_due a mano; deben quedar DERIVADOS por el trigger';
  END IF;
  IF position('nota de crédito % no tiene asiento propio' IN v_def) = 0 THEN
    RAISE EXCEPTION '060: el filtro de las NC sin asiento no quedó en la función';
  END IF;

  -- El índice de la 055 es el que sostiene "una sola reversión".
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'journal_entries' AND indexname = 'journal_entries_una_reversion_por_asiento'
  ) THEN
    RAISE EXCEPTION '060: falta el índice único de una reversión por asiento (055)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='credit_notes' AND column_name='cancelled_at'
  ) THEN
    RAISE EXCEPTION '060: falta credit_notes.cancelled_at';
  END IF;

  RAISE NOTICE '060 ✅ reverse_credit_note, el status anulada y la inmutabilidad con UNA transición';
END $$;

COMMIT;
