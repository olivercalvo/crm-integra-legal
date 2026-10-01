-- ============================================================================
-- 074 — COBRO CON EXCEDENTE: SALDO A FAVOR DEL CLIENTE Y REFERENCIA OBLIGATORIA
-- ============================================================================
-- 01/10/2026. Plan: `docs/finanzas/plan-bloque1.md`, punto 5. Decisión de
-- Oliver (01/10): el cobro con excedente se permite con una advertencia en la
-- misma pantalla; el sobrante queda como saldo a favor del cliente en 100004,
-- en negativo en la antigüedad y aplicable a la próxima factura. La referencia
-- del cobro pasa a ser obligatoria.
--
-- Lo que YA existía y no cambia:
--   · `payments.amount_unapplied` lo mantienen T7b/T7c (b3e): amount − Σ
--     aplicaciones, con CHECK 0..amount. Un cobro con excedente nace con
--     amount_unapplied > 0 sin tocar nada.
--   · El asiento del cobro es UNO de dos líneas por el TOTAL (banco / 100004 con
--     el cliente). El excedente no va a otra cuenta: queda en 100004, a favor.
--   · Ninguna regla impide insertar una aplicación DESPUÉS del alta: T7a deriva
--     el amount_paid y el status de la factura, T7b el saldo del cobro.
--   · La reversión (046) borra TODAS las aplicaciones del cobro, también las
--     que se agregaron después. Se reversa entero.
--
-- Qué hace:
--   1. Referencia obligatoria AL CREAR el cobro (trigger BEFORE INSERT). No es
--      un CHECK NOT VALID a propósito: ese CHECK también se evalúa en cada
--      UPDATE, y reversar un cobro viejo sin referencia (2 en staging; en
--      producción no se sabe) cambia su `status` y fallaría.
--   2. RPC `apply_payment_credit`: aplicar el saldo a favor de un cobro a una o
--      varias facturas del MISMO cliente, en UNA transacción, SIN asiento (el
--      dinero ya entró y ya está en 100004: sólo cambia a qué factura cancela).
--      Bloquea el cobro y cada factura; rechaza más de lo disponible o más del
--      saldo de una factura.
--
-- 🔴 NO SE TOCA EL LIBRO. Aplicar un saldo a favor no postea nada.
-- IDEMPOTENCIA: DROP/CREATE TRIGGER, CREATE OR REPLACE.
-- 🛑 SOLO STAGING hasta la ventana del despliegue.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Referencia obligatoria (para adelante)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finanzas_cobro_referencia_obligatoria()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reference IS NULL OR btrim(NEW.reference) = '' THEN
    RAISE EXCEPTION 'El cobro necesita una referencia: número de transferencia, cheque o recibo.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cobro_referencia_obligatoria ON public.payments;
CREATE TRIGGER trg_cobro_referencia_obligatoria
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_cobro_referencia_obligatoria();

-- ----------------------------------------------------------------------------
-- 2. Aplicar el saldo a favor
-- ----------------------------------------------------------------------------
-- p_applications: [{invoice_id, amount}]
CREATE OR REPLACE FUNCTION public.apply_payment_credit(
  p_tenant_id    uuid,
  p_payment_id   uuid,
  p_applications jsonb,
  p_created_by   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pago     record;
  v_fac      record;
  v_x        jsonb;
  v_monto    numeric(12,2);
  v_total    numeric(12,2) := 0;
  v_n        int := 0;
  v_saldo    numeric(12,2);
BEGIN
  IF p_tenant_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'apply_payment_credit: faltan el bufete o el cobro';
  END IF;
  IF p_applications IS NULL OR jsonb_typeof(p_applications) <> 'array' OR jsonb_array_length(p_applications) = 0 THEN
    RAISE EXCEPTION 'Elige a qué factura aplicar el saldo a favor.';
  END IF;

  SELECT id, client_id, status, amount, amount_unapplied, payment_number
    INTO v_pago
    FROM public.payments
   WHERE tenant_id = p_tenant_id AND id = p_payment_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado.';
  END IF;
  IF v_pago.status = 'anulado' THEN
    RAISE EXCEPTION 'El cobro % está anulado: no tiene saldo a favor.', coalesce(v_pago.payment_number, '');
  END IF;
  -- El saldo a favor vive en 100004 sólo si el cobro está en el libro. Un cobro
  -- viejo sin asiento no tiene contrapartida contable que mover.
  IF NOT EXISTS (SELECT 1 FROM public.journal_entries
                  WHERE tenant_id = p_tenant_id AND source_type = 'pago' AND source_id = p_payment_id) THEN
    RAISE EXCEPTION 'El cobro % no está en el libro contable: su saldo no se puede aplicar desde acá.', coalesce(v_pago.payment_number, '');
  END IF;

  FOR v_x IN SELECT * FROM jsonb_array_elements(p_applications) LOOP
    v_monto := round(coalesce((v_x->>'amount')::numeric, 0), 2);
    IF v_monto <= 0 THEN
      RAISE EXCEPTION 'Cada aplicación lleva un monto mayor que cero.';
    END IF;

    SELECT id, client_id, status, balance_due, invoice_number
      INTO v_fac
      FROM public.invoices
     WHERE tenant_id = p_tenant_id AND id = (v_x->>'invoice_id')::uuid
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Factura no encontrada.';
    END IF;
    IF v_fac.client_id <> v_pago.client_id THEN
      RAISE EXCEPTION 'La factura % es de otro cliente: el saldo a favor sólo se aplica a facturas del mismo cliente.', v_fac.invoice_number;
    END IF;
    IF v_fac.status NOT IN ('emitida', 'parcialmente_pagada') THEN
      RAISE EXCEPTION 'La factura % no tiene saldo por cobrar (está %).', v_fac.invoice_number, v_fac.status;
    END IF;
    IF v_monto > v_fac.balance_due + 0.001 THEN
      RAISE EXCEPTION 'B/. % supera el saldo de la factura % (B/. %).', v_monto, v_fac.invoice_number, v_fac.balance_due;
    END IF;

    v_total := v_total + v_monto;
    IF v_total > v_pago.amount_unapplied + 0.001 THEN
      RAISE EXCEPTION 'El saldo a favor del cobro % es B/. %: no alcanza para aplicar B/. %.',
        coalesce(v_pago.payment_number, ''), v_pago.amount_unapplied, v_total;
    END IF;

    INSERT INTO public.payment_applications
      (tenant_id, payment_id, invoice_id, amount_applied, applied_by, created_by)
    VALUES (p_tenant_id, p_payment_id, v_fac.id, v_monto, p_created_by, p_created_by)
    ON CONFLICT (payment_id, invoice_id)
      DO UPDATE SET amount_applied = public.payment_applications.amount_applied + EXCLUDED.amount_applied,
                    applied_at = now(), applied_by = EXCLUDED.applied_by;
    v_n := v_n + 1;
  END LOOP;

  SELECT amount_unapplied INTO v_saldo FROM public.payments WHERE id = p_payment_id;
  RETURN jsonb_build_object('aplicado', v_total, 'facturas', v_n, 'saldo_a_favor', v_saldo);
END $$;

COMMENT ON FUNCTION public.apply_payment_credit(uuid, uuid, jsonb, uuid) IS
  'Aplica el saldo a favor (amount_unapplied) de un cobro contabilizado a facturas del mismo cliente, en UNA transacción y SIN asiento: el dinero ya está en 100004. T7a/T7b derivan los saldos. SECURITY DEFINER, EXECUTE solo service_role: confía en p_tenant_id, que la ruta saca del usuario autenticado.';

REVOKE EXECUTE ON FUNCTION public.apply_payment_credit(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_payment_credit(uuid, uuid, jsonb, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Verificación
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.payments'::regclass AND tgname = 'trg_cobro_referencia_obligatoria';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '074: falta el trigger de la referencia';
  END IF;
  IF has_function_privilege('authenticated', 'public.apply_payment_credit(uuid, uuid, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '074: authenticated puede aplicar saldos a favor';
  END IF;
  SELECT count(*) INTO v_n FROM public.payments WHERE reference IS NULL OR btrim(reference) = '';
  RAISE NOTICE '074 ✅ referencia obligatoria al crear (% cobro(s) viejo(s) sin referencia quedan como están) y apply_payment_credit', v_n;
END $$;

COMMIT;
