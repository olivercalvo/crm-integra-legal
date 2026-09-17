-- ============================================================================
-- 046 — REVERSIÓN DE UN COBRO: una función, una transacción
-- ============================================================================
-- Un cobro contabilizado NO se borra (gate de `deletePayment`, 04/09/2026): se
-- REVIERTE. Revertirlo son TRES escrituras que tienen que pasar juntas o no
-- pasar:
--
--   1. postear el asiento espejo del original (`source_type = 'reversion'`,
--      `reverses_entry_id` apuntando al asiento del cobro, con motivo);
--   2. borrar sus `payment_applications` — es lo que dispara T7a, que devuelve
--      la factura a `emitida` / `parcialmente_pagada` y recalcula `amount_paid`.
--      ⚠️ T7a cuelga de `payment_applications`, NO de `payments.status`: anular
--      el cobro sin tocar las aplicaciones dejaría la factura como "pagada";
--   3. marcar el cobro `anulado` (T3 permite registrado → anulado).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 POR QUÉ ES UNA FUNCIÓN DE POSTGRES Y NO TRES LLAMADAS DESDE LA RUTA
-- ─────────────────────────────────────────────────────────────────────────────
-- Desde `supabase-js` los tres pasos son tres requests, y entre uno y otro hay
-- una ventana. En `emitInvoice` esa ventana ya existe y se aceptó; acá NO se
-- acepta, porque el estado a medias es exactamente el que la reversión existe
-- para impedir: el asiento espejo posteado (inmutable, no se borra) y la
-- factura todavía "pagada" — el libro dice que la plata se devolvió y el
-- documento dice que se cobró.
--
-- Una función plpgsql corre dentro de UNA transacción: si cualquier paso
-- levanta una excepción, todo lo anterior se deshace, incluido el asiento
-- que `post_journal_entry` ya había escrito y el correlativo que había tomado.
-- `sql/tests/verificacion-046-reversion-cobro.sql` lo prueba forzando una
-- falla DESPUÉS del posteo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 LAS LÍNEAS LAS ARMA LA APP; LA FUNCIÓN LAS VERIFICA
-- ─────────────────────────────────────────────────────────────────────────────
-- El asiento espejo lo construye `contabilidad/reversion.ts` (módulo puro), y
-- es la MISMA función que dibuja la vista previa en la pantalla. Si esta
-- función recalculara el espejo por su cuenta, habría dos implementaciones y
-- algún día la vista previa mentiría sobre lo que se postea.
--
-- Lo que sí hace esta función es NEGARSE si lo que llega no es el espejo
-- exacto del original (misma cuenta, débito y crédito intercambiados). Es un
-- cerrojo, no una segunda implementación: no calcula nada que después se
-- escriba, solo compara.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA FECHA: la de la reversión, nunca la del original (acta del 09/09/2026)
-- ─────────────────────────────────────────────────────────────────────────────
-- "La reversión lleva SIEMPRE la fecha en que se hace, nunca la del asiento
-- que revierte." La función rechaza cualquier fecha que no sea hoy (±1 día de
-- tolerancia por la diferencia entre el reloj del servidor y el de la base).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- `payment_reversals`: la foto de lo que se deshizo
-- ─────────────────────────────────────────────────────────────────────────────
-- Al borrar las aplicaciones se pierde el vínculo cobro → factura, y con él la
-- fila del cobro en el detalle de la factura: un cobro reversado desaparecería
-- de la pantalla como si nunca hubiera existido. Esta tabla guarda, POR
-- APLICACIÓN, qué factura y cuánto se le había aplicado, con el asiento de
-- reversión y el motivo. Es lo que lee `getPaymentsForInvoice` para mostrar el
-- cobro tachado, y lo que lee el Libro Mayor para seguir enlazando el asiento
-- original a su factura.
--
-- No se cambia la fórmula de T7a (`amount_paid = SUM(payment_applications)`)
-- para excluir aplicaciones "reversadas": esa igualdad la verifica la 032 y la
-- asume el guard T4b. Borrar la aplicación la conserva literal.
--
-- SEGURIDAD: SECURITY DEFINER, EXECUTE solo para service_role. Igual que
-- `post_journal_entry`: NO valida el tenant, confía en `p_tenant_id`. La ruta
-- lo saca del perfil del usuario autenticado, nunca del body (SOP-014).
--
-- IDEMPOTENCIA: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
--
-- APLICACIÓN:
--   Staging: `node scripts/run-sql.mjs sql/pending/046_reversion_de_cobro.sql`
--   🔴 Producción: NO desde una máquina. Solo por merge a `main`.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) LA TABLA
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_reversals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_id         uuid NOT NULL REFERENCES public.payments(id),
  invoice_id         uuid NOT NULL REFERENCES public.invoices(id),
  amount_applied     numeric(12,2) NOT NULL,
  -- El asiento espejo y el que revierte. Los dos son inmutables (023).
  reversal_entry_id  uuid NOT NULL REFERENCES public.journal_entries(id),
  reversed_entry_id  uuid NOT NULL REFERENCES public.journal_entries(id),
  reason             text NOT NULL,
  reversed_at        timestamptz NOT NULL DEFAULT now(),
  reversed_by        uuid NULL REFERENCES public.users(id),

  CONSTRAINT payment_reversals_amount_positive CHECK (amount_applied > 0),
  CONSTRAINT payment_reversals_reason_min CHECK (length(btrim(reason)) >= 3),
  -- Un cobro se reversa UNA vez por factura.
  CONSTRAINT payment_reversals_payment_invoice_unique UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_reversals_invoice
  ON public.payment_reversals(tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_reversals_payment
  ON public.payment_reversals(tenant_id, payment_id);

ALTER TABLE public.payment_reversals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_reversals_tenant_isolation ON public.payment_reversals;
CREATE POLICY payment_reversals_tenant_isolation ON public.payment_reversals
  FOR ALL USING (tenant_id = public.get_tenant_id());

COMMENT ON TABLE public.payment_reversals IS
  'Foto de cada payment_application que se borró al reversar un cobro: factura, monto aplicado, asiento espejo, asiento revertido y motivo. La escribe SOLO reverse_payment(). Es lo que mantiene visible el cobro reversado en el detalle de la factura y el enlace del asiento original en el Libro Mayor.';

-- ---------------------------------------------------------------------------
-- 2) LA FUNCIÓN
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_payment(
  p_tenant_id        uuid,
  p_payment_id       uuid,
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
  v_status     text;
  v_orig_id    uuid;
  v_orig_nro   bigint;
  v_orig_ref   text;
  v_orig_date  date;
  v_ya_nro     bigint;
  v_dif        int;
  v_entry_id   uuid;
  v_entry_nro  bigint;
  v_apps       int;
  v_facturas   jsonb;
BEGIN
  -- ---- 1) Argumentos --------------------------------------------------------
  IF p_tenant_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'reverse_payment: faltan el tenant o el cobro';
  END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'La reversión necesita un motivo de al menos 3 caracteres (DE 34/1998 Art. 5.7)';
  END IF;
  IF p_transaction_date IS NULL OR abs(p_transaction_date - current_date) > 1 THEN
    RAISE EXCEPTION
      'La reversión lleva la fecha en que se hace (hoy, %), nunca otra: llegó %',
      current_date, coalesce(p_transaction_date::text, 'NULL');
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'reverse_payment: las líneas del asiento espejo deben venir como un array JSON de al menos 2';
  END IF;

  -- ---- 2) El cobro, con candado --------------------------------------------
  SELECT status INTO v_status
    FROM public.payments
   WHERE tenant_id = p_tenant_id AND id = p_payment_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado';
  END IF;
  IF v_status = 'anulado' THEN
    RAISE EXCEPTION 'Este cobro ya está anulado.';
  END IF;
  IF v_status <> 'registrado' THEN
    RAISE EXCEPTION 'Un cobro en estado "%" no se puede reversar.', v_status;
  END IF;

  -- ---- 3) El asiento original y que nadie lo haya reversado ya --------------
  SELECT id, entry_number, reference, transaction_date
    INTO v_orig_id, v_orig_nro, v_orig_ref, v_orig_date
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND source_type = 'pago' AND source_id = p_payment_id;

  IF v_orig_id IS NULL THEN
    RAISE EXCEPTION
      'Este cobro no está en el libro contable, así que no hay nada que reversar. Un cobro sin asiento se elimina.';
  END IF;
  IF p_transaction_date < v_orig_date THEN
    RAISE EXCEPTION
      'La reversión (%) no puede ser anterior al asiento que revierte (asiento %, %)',
      p_transaction_date, v_orig_nro, v_orig_date;
  END IF;

  SELECT entry_number INTO v_ya_nro
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id AND reverses_entry_id = v_orig_id
   LIMIT 1;
  IF v_ya_nro IS NOT NULL THEN
    RAISE EXCEPTION 'El asiento % ya fue reversado por el asiento %.', v_orig_nro, v_ya_nro;
  END IF;

  -- ---- 4) Lo que llega es EXACTAMENTE el espejo del original ---------------
  -- Misma cuenta, débito y crédito intercambiados, línea por línea. Se compara
  -- como multiconjunto en los dos sentidos: ni una línea de más ni una de menos.
  WITH esperado AS (
    SELECT c.code AS code, l.credit AS debit, l.debit AS credit
      FROM public.journal_entry_lines l
      JOIN public.chart_of_accounts c ON c.id = l.account_id
     WHERE l.entry_id = v_orig_id
  ), recibido AS (
    SELECT btrim(x->>'account_code')                            AS code,
           round(coalesce((x->>'debit')::numeric, 0), 2)        AS debit,
           round(coalesce((x->>'credit')::numeric, 0), 2)       AS credit
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

  -- ---- 5) Postear el espejo ---------------------------------------------------
  -- Va primero porque es el paso con más motivos legítimos para fallar (período
  -- cerrado, cuenta inactiva). En una transacción el orden no cambia el
  -- resultado; cambia qué queda en el log cuando falla.
  v_entry_id := public.post_journal_entry(
    p_tenant_id,
    p_transaction_date,
    p_description,
    'reversion',
    p_lines,
    p_payment_id,          -- source_id: el cobro. El UNIQUE de la 034 impide un segundo espejo.
    NULL,                  -- source_cufe
    v_orig_id,             -- reverses_entry_id
    btrim(p_reason),       -- reversal_reason
    p_created_by,
    NULL,                  -- record_date: hoy
    v_orig_ref,            -- misma referencia que el original (el N° de factura)
    NULL                   -- idempotency_key: el source_id ya lo cubre
  );

  SELECT entry_number INTO v_entry_nro FROM public.journal_entries WHERE id = v_entry_id;

  -- ---- 6) La foto, y después el borrado que dispara T7a ----------------------
  INSERT INTO public.payment_reversals (
    tenant_id, payment_id, invoice_id, amount_applied,
    reversal_entry_id, reversed_entry_id, reason, reversed_by
  )
  SELECT a.tenant_id, a.payment_id, a.invoice_id, a.amount_applied,
         v_entry_id, v_orig_id, btrim(p_reason), p_created_by
    FROM public.payment_applications a
   WHERE a.tenant_id = p_tenant_id AND a.payment_id = p_payment_id;
  GET DIAGNOSTICS v_apps = ROW_COUNT;

  DELETE FROM public.payment_applications
   WHERE tenant_id = p_tenant_id AND payment_id = p_payment_id;

  -- ---- 7) Anular el cobro (T3: registrado → anulado) -------------------------
  UPDATE public.payments
     SET status = 'anulado'
   WHERE tenant_id = p_tenant_id AND id = p_payment_id;

  -- ---- 8) Cómo quedaron las facturas, para la respuesta ----------------------
  SELECT jsonb_agg(jsonb_build_object(
           'invoice_id',     r.invoice_id,
           'invoice_number', i.invoice_number,
           'status',         i.status,
           'amount_paid',    i.amount_paid
         ) ORDER BY i.invoice_number)
    INTO v_facturas
    FROM public.payment_reversals r
    JOIN public.invoices i ON i.id = r.invoice_id
   WHERE r.reversal_entry_id = v_entry_id;

  RETURN jsonb_build_object(
    'entry_id',              v_entry_id,
    'entry_number',          v_entry_nro,
    'reversed_entry_number', v_orig_nro,
    'transaction_date',      p_transaction_date,
    'applications',          v_apps,
    'invoices',              coalesce(v_facturas, '[]'::jsonb)
  );
END $$;

COMMENT ON FUNCTION public.reverse_payment IS
  'Reversa un cobro contabilizado en UNA transacción: postea el asiento espejo (vía post_journal_entry, con reverses_entry_id y motivo), fotografía y borra sus payment_applications (T7a devuelve la factura a su estado) y marca el cobro anulado. Rechaza líneas que no sean el espejo exacto del original y fechas que no sean hoy. SECURITY DEFINER, EXECUTE solo service_role: confía en p_tenant_id, que la ruta saca del usuario autenticado.';

-- ---------------------------------------------------------------------------
-- 3) PERMISOS — los mismos que post_journal_entry
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  public.reverse_payment(uuid, uuid, text, date, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.reverse_payment(uuid, uuid, text, date, text, jsonb, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4) VERIFICACIÓN
-- ---------------------------------------------------------------------------
DO $verif$
DECLARE
  v_tabla   int;
  v_funcs   int;
  v_definer int;
  v_publico int;
BEGIN
  SELECT COUNT(*) INTO v_tabla
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'payment_reversals';

  SELECT COUNT(*) INTO v_funcs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'reverse_payment';

  SELECT COUNT(*) INTO v_definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'reverse_payment' AND p.prosecdef;

  SELECT COUNT(*) INTO v_publico
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'reverse_payment'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  RAISE NOTICE 'payment_reversals .......... % (esperado 1)', v_tabla;
  RAISE NOTICE 'reverse_payment ............ % (esperado 1)', v_funcs;
  RAISE NOTICE 'SECURITY DEFINER ........... % (esperado 1)', v_definer;
  RAISE NOTICE 'ejecutable por anon/auth ... % (esperado 0)', v_publico;

  IF v_tabla   <> 1 THEN RAISE EXCEPTION 'ABORT: falta payment_reversals'; END IF;
  IF v_funcs   <> 1 THEN RAISE EXCEPTION 'ABORT: hay % versiones de reverse_payment', v_funcs; END IF;
  IF v_definer <> 1 THEN RAISE EXCEPTION 'ABORT: la función no quedó SECURITY DEFINER'; END IF;
  IF v_publico <> 0 THEN
    RAISE EXCEPTION 'ABORT: anon o authenticated pueden ejecutar reverse_payment';
  END IF;

  RAISE NOTICE 'OK — 046 aplicada.';
END $verif$;

COMMIT;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- DROP FUNCTION public.reverse_payment(uuid, uuid, text, date, text, jsonb, uuid);
-- DROP TABLE public.payment_reversals;
-- ⚠️ Los asientos de reversión ya posteados NO se borran (023). Dropear la
--    tabla pierde el vínculo cobro → factura de los cobros ya reversados.
-- ============================================================================
