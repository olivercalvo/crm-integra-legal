-- ============================================================================
-- 076 · NOTAS DE CRÉDITO COMO MÓDULO PROPIO, VENTA Y COMPRA (Bloque 1, E8, punto 4)
-- ============================================================================
-- Pedido de Oliver (01/10/2026): se elige cliente o proveedor; la factura (o la
-- compra) es OPCIONAL; si se elige, se cargan sus líneas y todo queda editable;
-- si no, la pantalla avisa antes de guardar.
--
-- QUÉ CAMBIA EN LA BASE
--   1. `credit_notes.invoice_id` y `supplier_credit_notes.business_expense_id`
--      pasan a NULL-ables. Una NC sin documento queda como SALDO A FAVOR del
--      tercero: su asiento ya movió 100004 / 200001 con el cliente o el
--      proveedor, y se aplica después a una factura o compra.
--   2. APLICACIONES: `credit_note_applications` y
--      `supplier_credit_note_applications`, calcadas de `payment_applications`.
--      Aplicar NO genera asiento (el crédito ya está en la cuenta control, a
--      nombre del tercero): mismo criterio que `apply_payment_credit` (074).
--   3. `credited_total` (051 / 066) se deriva de DOS fuentes:
--        Σ grand_total de las NC `emitida` que nacieron sobre ese documento
--      + Σ aplicaciones de NC `emitida`.
--      🔴 Decisión: la NC que nace CON factura sigue acreditando su factura
--      entera por `invoice_id`, como hasta hoy (tope D7: no más que el saldo).
--      No se reescribe a "una aplicación por NC": el backfill tocaría las 16 NC
--      de staging y las de producción sin necesidad, y la anulación (052) sigue
--      funcionando sin un solo cambio. La migración verifica que ninguna
--      factura ni compra cambie su `credited_total`.
--   4. CHECK `credited_total <= grand_total` en facturas (el de compras ya
--      existía en la 066).
--   5. NC de compra: líneas libres (`expense_line_id` NULL-able, `tax_code_id`
--      propio). `create_supplier_credit_note` se redefine con firma nueva
--      (compra opcional, proveedor, líneas con cuenta, monto e impuesto) y la
--      verificación del asiento se generaliza a todas sus cuentas.
--   6. RPC `apply_credit_note` (venta) y `apply_supplier_credit_note` (compra).
--
-- QUÉ NO CAMBIA
--   · La NC de venta SIN factura queda apagada en la APP detrás de UNA
--     constante (`PERMITIR_NC_VENTA_SIN_FACTURA`, P-4a de Josuarth). La base la
--     admite para no volver a migrar cuando conteste.
--   · La anulación (052/063), la reversión de NC (060/069) y la emisión fiscal.
--
-- 🛡️ Sólo staging hasta el «aplica» de Oliver. En producción va en la ventana,
--    después de la 075.
-- ============================================================================
BEGIN;

-- La foto de antes: credited_total de cada factura y de cada compra. Al final
-- se compara y la migración aborta si una sola cambió.
CREATE TEMP TABLE _076_antes ON COMMIT DROP AS
  SELECT 'f'::text AS t, id, credited_total FROM public.invoices
  UNION ALL
  SELECT 'c', id, credited_total FROM public.business_expenses;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. VENTA
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.credit_notes ALTER COLUMN invoice_id DROP NOT NULL;

COMMENT ON COLUMN public.credit_notes.invoice_id IS
  'La factura sobre la que NACE la NC (076: opcional). Con factura, la NC la acredita entera (tope: su saldo). Sin factura, la NC es saldo a favor del cliente y se aplica con credit_note_applications.';

CREATE TABLE IF NOT EXISTS public.credit_note_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  credit_note_id  uuid NOT NULL REFERENCES public.credit_notes(id),
  invoice_id      uuid NOT NULL REFERENCES public.invoices(id),
  amount_applied  numeric(12,2) NOT NULL CHECK (amount_applied > 0),
  created_by      uuid NULL REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cna_por_nc ON public.credit_note_applications (credit_note_id);
CREATE INDEX IF NOT EXISTS cna_por_factura ON public.credit_note_applications (invoice_id);

ALTER TABLE public.credit_note_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cna_lectura ON public.credit_note_applications;
CREATE POLICY cna_lectura ON public.credit_note_applications
  FOR SELECT USING (tenant_id = get_tenant_id());
-- Se escribe SÓLO por el RPC (SECURITY DEFINER).
REVOKE ALL ON public.credit_note_applications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.credit_note_applications TO authenticated, service_role;

-- Una aplicación no se edita ni se borra: aplicar saldo es un hecho, y el que
-- se equivocó reversa la NC (que libera todas sus aplicaciones por estado).
CREATE OR REPLACE FUNCTION public.finanzas_aplicacion_inmutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Una aplicación de nota de crédito no se modifica ni se borra: si fue un error, se reversa la nota de crédito.'
    USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_cna_inmutable ON public.credit_note_applications;
CREATE TRIGGER trg_cna_inmutable BEFORE UPDATE OR DELETE ON public.credit_note_applications
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_aplicacion_inmutable();

-- credited_total = lo que nació sobre la factura + lo aplicado, de NC emitida.
CREATE OR REPLACE FUNCTION public.finanzas_recalc_one_invoice_credited(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_credited numeric(12,2);
BEGIN
  IF p_invoice_id IS NULL THEN
    RETURN;
  END IF;
  SELECT COALESCE((SELECT SUM(cn.grand_total) FROM public.credit_notes cn
                    WHERE cn.invoice_id = p_invoice_id AND cn.status = 'emitida'), 0)
       + COALESCE((SELECT SUM(ap.amount_applied) FROM public.credit_note_applications ap
                     JOIN public.credit_notes cn2 ON cn2.id = ap.credit_note_id
                    WHERE ap.invoice_id = p_invoice_id AND cn2.status = 'emitida'), 0)
    INTO v_credited;

  PERFORM set_config('finanzas.recalc', 'on', true);
  UPDATE public.invoices SET credited_total = v_credited WHERE id = p_invoice_id;
  PERFORM set_config('finanzas.recalc', 'off', true);

  PERFORM public.finanzas_recalc_one_invoice_amount_paid(p_invoice_id);
END;
$$;

COMMENT ON FUNCTION public.finanzas_recalc_one_invoice_credited IS
  'DERIVA credited_total (051, 076): Σ grand_total de las NC emitida nacidas sobre la factura + Σ aplicaciones de NC emitida. Después T7a deriva el status contra el neto.';

-- Al cambiar una NC (alta, anulación) se recalculan su factura y todas las
-- facturas a las que se aplicó.
CREATE OR REPLACE FUNCTION public.finanzas_trg_recalc_invoice_credited()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_fac uuid;
  v_nc  uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.finanzas_recalc_one_invoice_credited(OLD.invoice_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.finanzas_recalc_one_invoice_credited(OLD.invoice_id);
  END IF;
  PERFORM public.finanzas_recalc_one_invoice_credited(NEW.invoice_id);
  v_nc := NEW.id;
  FOR v_fac IN SELECT DISTINCT ap.invoice_id FROM public.credit_note_applications ap WHERE ap.credit_note_id = v_nc LOOP
    PERFORM public.finanzas_recalc_one_invoice_credited(v_fac);
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finanzas_trg_recalc_por_aplicacion_de_nc()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.finanzas_recalc_one_invoice_credited(NEW.invoice_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cna_recalc ON public.credit_note_applications;
CREATE TRIGGER trg_cna_recalc AFTER INSERT ON public.credit_note_applications
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_trg_recalc_por_aplicacion_de_nc();

-- El tope que faltaba en ventas: no se acredita más que la factura.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_credited_hasta_el_total;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_credited_hasta_el_total
  CHECK (credited_total <= grand_total);

-- Aplicar el saldo a favor de una NC de venta a una factura del mismo cliente.
CREATE OR REPLACE FUNCTION public.apply_credit_note(
  p_tenant_id      uuid,
  p_credit_note_id uuid,
  p_invoice_id     uuid,
  p_amount         numeric,
  p_created_by     uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nc       record;
  v_fac      record;
  v_monto    numeric(12,2) := round(coalesce(p_amount, 0), 2);
  v_aplicado numeric(12,2);
  v_saldo    numeric(12,2);
BEGIN
  IF p_tenant_id IS NULL OR p_credit_note_id IS NULL OR p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'apply_credit_note: faltan el bufete, la nota de crédito o la factura';
  END IF;
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a aplicar tiene que ser mayor que cero.';
  END IF;

  SELECT id, credit_note_number, client_id, invoice_id, status, grand_total
    INTO v_nc
    FROM public.credit_notes
   WHERE tenant_id = p_tenant_id AND id = p_credit_note_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota de crédito no encontrada.';
  END IF;
  IF v_nc.status <> 'emitida' THEN
    RAISE EXCEPTION 'La nota de crédito % está anulada: no tiene saldo a favor.', v_nc.credit_note_number;
  END IF;
  IF v_nc.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'La nota de crédito % ya acredita la factura sobre la que se emitió: no tiene saldo a favor.', v_nc.credit_note_number;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.journal_entries
                  WHERE tenant_id = p_tenant_id AND source_type = 'nota_credito' AND source_id = p_credit_note_id) THEN
    RAISE EXCEPTION 'La nota de crédito % no está en el libro contable: su saldo no se puede aplicar.', v_nc.credit_note_number;
  END IF;

  SELECT id, client_id, status, balance_due, invoice_number
    INTO v_fac
    FROM public.invoices
   WHERE tenant_id = p_tenant_id AND id = p_invoice_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada.';
  END IF;
  IF v_fac.client_id <> v_nc.client_id THEN
    RAISE EXCEPTION 'La factura % es de otro cliente: el saldo de una nota de crédito sólo se aplica a facturas del mismo cliente.', v_fac.invoice_number;
  END IF;
  IF v_fac.status NOT IN ('emitida', 'parcialmente_pagada') THEN
    RAISE EXCEPTION 'La factura % no tiene saldo por cobrar (está %).', v_fac.invoice_number, v_fac.status;
  END IF;
  IF v_monto > v_fac.balance_due + 0.001 THEN
    RAISE EXCEPTION 'B/. % supera el saldo de la factura % (B/. %).', v_monto, v_fac.invoice_number, v_fac.balance_due;
  END IF;

  SELECT COALESCE(SUM(amount_applied), 0) INTO v_aplicado
    FROM public.credit_note_applications WHERE credit_note_id = p_credit_note_id;
  v_saldo := v_nc.grand_total - v_aplicado;
  IF v_monto > v_saldo + 0.001 THEN
    RAISE EXCEPTION 'El saldo a favor de la nota de crédito % es B/. %: no alcanza para aplicar B/. %.',
      v_nc.credit_note_number, v_saldo, v_monto;
  END IF;

  INSERT INTO public.credit_note_applications (tenant_id, credit_note_id, invoice_id, amount_applied, created_by)
  VALUES (p_tenant_id, p_credit_note_id, p_invoice_id, v_monto, p_created_by);

  RETURN jsonb_build_object('aplicado', v_monto, 'saldo_a_favor', v_saldo - v_monto,
                            'invoice_number', v_fac.invoice_number);
END $$;

REVOKE ALL ON FUNCTION public.apply_credit_note(uuid, uuid, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_note(uuid, uuid, uuid, numeric, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. COMPRA
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.supplier_credit_notes ALTER COLUMN business_expense_id DROP NOT NULL;
ALTER TABLE public.supplier_credit_notes DROP CONSTRAINT IF EXISTS scn_compra_o_proveedor;
ALTER TABLE public.supplier_credit_notes ADD CONSTRAINT scn_compra_o_proveedor
  CHECK (business_expense_id IS NOT NULL OR supplier_id IS NOT NULL);

ALTER TABLE public.supplier_credit_note_lines ALTER COLUMN expense_line_id DROP NOT NULL;
ALTER TABLE public.supplier_credit_note_lines
  ADD COLUMN IF NOT EXISTS tax_code_id uuid NULL REFERENCES public.tax_codes(id);

COMMENT ON COLUMN public.supplier_credit_notes.business_expense_id IS
  'La compra sobre la que NACE la NC (076: opcional). Sin compra, la NC es saldo a favor con el proveedor y se aplica con supplier_credit_note_applications.';

CREATE TABLE IF NOT EXISTS public.supplier_credit_note_applications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  credit_note_id       uuid NOT NULL REFERENCES public.supplier_credit_notes(id),
  business_expense_id  uuid NOT NULL REFERENCES public.business_expenses(id),
  amount_applied       numeric(12,2) NOT NULL CHECK (amount_applied > 0),
  created_by           uuid NULL REFERENCES public.users(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scna_por_nc ON public.supplier_credit_note_applications (credit_note_id);
CREATE INDEX IF NOT EXISTS scna_por_compra ON public.supplier_credit_note_applications (business_expense_id);

ALTER TABLE public.supplier_credit_note_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scna_lectura ON public.supplier_credit_note_applications;
CREATE POLICY scna_lectura ON public.supplier_credit_note_applications
  FOR SELECT USING (tenant_id = get_tenant_id());
REVOKE ALL ON public.supplier_credit_note_applications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supplier_credit_note_applications TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_scna_inmutable ON public.supplier_credit_note_applications;
CREATE TRIGGER trg_scna_inmutable BEFORE UPDATE OR DELETE ON public.supplier_credit_note_applications
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_aplicacion_inmutable();

CREATE OR REPLACE FUNCTION public.finanzas_recalc_one_expense_credited(p_expense_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_cred numeric(12,2);
BEGIN
  IF p_expense_id IS NULL THEN
    RETURN;
  END IF;
  SELECT COALESCE((SELECT SUM(n.grand_total) FROM public.supplier_credit_notes n
                    WHERE n.business_expense_id = p_expense_id AND n.status = 'emitida'), 0)
       + COALESCE((SELECT SUM(ap.amount_applied) FROM public.supplier_credit_note_applications ap
                     JOIN public.supplier_credit_notes n2 ON n2.id = ap.credit_note_id
                    WHERE ap.business_expense_id = p_expense_id AND n2.status = 'emitida'), 0)
    INTO v_cred;
  PERFORM set_config('finanzas.recalc', 'on', true);
  UPDATE public.business_expenses SET credited_total = v_cred WHERE id = p_expense_id;
  PERFORM set_config('finanzas.recalc', 'off', true);
  PERFORM public.finanzas_recalc_one_expense_amount_paid(p_expense_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.finanzas_trg_recalc_expense_credited()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_compra uuid;
  v_nc     uuid;
BEGIN
  PERFORM public.finanzas_recalc_one_expense_credited(NEW.business_expense_id);
  v_nc := NEW.id;
  FOR v_compra IN SELECT DISTINCT ap.business_expense_id FROM public.supplier_credit_note_applications ap
                   WHERE ap.credit_note_id = v_nc LOOP
    PERFORM public.finanzas_recalc_one_expense_credited(v_compra);
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finanzas_trg_recalc_por_aplicacion_de_ncp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.finanzas_recalc_one_expense_credited(NEW.business_expense_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_scna_recalc ON public.supplier_credit_note_applications;
CREATE TRIGGER trg_scna_recalc AFTER INSERT ON public.supplier_credit_note_applications
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_trg_recalc_por_aplicacion_de_ncp();

-- El alta, con firma nueva. La vieja (10 argumentos) se va: su único llamador
-- es `createSupplierCreditNote`, que cambia en el mismo commit.
DROP FUNCTION IF EXISTS public.create_supplier_credit_note(uuid, uuid, text, date, text, text, date, jsonb, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.create_supplier_credit_note(
  p_tenant_id           uuid,
  p_business_expense_id uuid,      -- opcional
  p_supplier_id         uuid,      -- obligatorio sin compra; con compra, el de la compra
  p_doc_numero          text,
  p_doc_fecha           date,
  p_doc_cufe            text,
  p_reason              text,
  p_issue_date          date,      -- fecha de REGISTRO, elegida
  p_lineas              jsonb,     -- [{expense_line_id?, chart_account_code, description, amount, tax_code_id?, tax_amount}]
  p_asiento             jsonb,
  p_created_by          uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_compra      record;
  v_cuenta      record;
  v_tasa        record;
  v_x           jsonb;
  v_proveedor   uuid;
  v_prov_nombre text;
  v_sub         numeric(12,2) := 0;
  v_tax         numeric(12,2) := 0;
  v_monto       numeric(12,2);
  v_tax_linea   numeric(12,2);
  v_tax_sugerido numeric(12,2);
  v_tasa_rate   numeric(5,4);
  v_tasa_cuenta text;
  v_tax_code    uuid;
  v_el_id       uuid;
  v_desc_linea  text;
  v_cod_cuenta  text;
  v_acreditado  numeric(12,2);
  v_tax_acred   numeric(12,2);
  -- La línea de la compra, en ESCALARES: leer un campo de un record sin asignar
  -- falla en plpgsql aunque esté detrás de un AND.
  v_l_orden     int;
  v_l_desc      text;
  v_l_cuenta    text;
  v_l_amount    numeric(12,2);
  v_l_tax       numeric(12,2);
  v_l_tax_code  uuid;
  v_l_rate      numeric(5,4);
  v_orden       int := 0;
  v_dif         int;
  v_seq         int;
  v_numero      text;
  v_nc_id       uuid;
  v_entry_id    uuid;
  v_entry_nro   bigint;
  v_desc        text;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'create_supplier_credit_note: falta el bufete';
  END IF;
  IF coalesce(char_length(btrim(p_reason)), 0) < 3 THEN
    RAISE EXCEPTION 'El motivo de la nota de crédito necesita al menos 3 caracteres.';
  END IF;
  IF coalesce(char_length(btrim(p_doc_numero)), 0) = 0 THEN
    RAISE EXCEPTION 'Falta el número del documento del proveedor.';
  END IF;
  IF p_issue_date IS NULL THEN
    RAISE EXCEPTION 'La nota de crédito de proveedor necesita una fecha de registro (la elige el contador, en un período abierto).';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'La nota de crédito necesita al menos una línea con monto.';
  END IF;

  -- El documento de origen (opcional), BLOQUEADO: dos NC a la vez no pueden
  -- pasarse del saldo.
  IF p_business_expense_id IS NOT NULL THEN
    SELECT id, description, supplier_id, supplier_name, balance_due
      INTO v_compra
      FROM public.business_expenses
     WHERE tenant_id = p_tenant_id AND id = p_business_expense_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Compra no encontrada.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.journal_entries
                    WHERE tenant_id = p_tenant_id AND source_type = 'gasto' AND source_id = p_business_expense_id) THEN
      RAISE EXCEPTION 'La compra no está registrada en el libro contable: no se le puede aplicar una nota de crédito.';
    END IF;
    IF p_supplier_id IS NOT NULL AND p_supplier_id IS DISTINCT FROM v_compra.supplier_id THEN
      RAISE EXCEPTION 'La compra es de otro proveedor.';
    END IF;
    v_proveedor := v_compra.supplier_id;
  ELSE
    v_proveedor := p_supplier_id;
  END IF;
  IF v_proveedor IS NULL THEN
    RAISE EXCEPTION 'La nota de crédito acredita Cuentas por pagar (200001), y cada movimiento ahí dice de qué proveedor es: elige el proveedor.';
  END IF;
  SELECT coalesce(nullif(btrim(trade_name), ''), legal_name) INTO v_prov_nombre
    FROM public.suppliers WHERE tenant_id = p_tenant_id AND id = v_proveedor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proveedor no encontrado.';
  END IF;

  -- PASADA 1: validar cada línea y fijar sus montos, SIN escribir nada.
  CREATE TEMP TABLE IF NOT EXISTS _ncp_lineas (
    orden int, expense_line_id uuid, description text, cuenta text,
    amount numeric(12,2), tax_code_id uuid, tax_rate numeric(5,4),
    tax_amount numeric(12,2), tax_cuenta text
  ) ON COMMIT DROP;
  TRUNCATE _ncp_lineas;

  FOR v_x IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v_monto := round(coalesce((v_x->>'amount')::numeric, 0), 2);
    IF v_monto <= 0 THEN
      RAISE EXCEPTION 'Cada línea de la nota de crédito lleva un monto mayor que cero.';
    END IF;
    v_el_id := nullif(v_x->>'expense_line_id', '')::uuid;
    v_desc_linea := btrim(coalesce(v_x->>'description', ''));
    v_cod_cuenta := btrim(coalesce(v_x->>'chart_account_code', ''));
    v_tax_code := nullif(v_x->>'tax_code_id', '')::uuid;

    v_acreditado := 0;
    v_tax_acred := 0;
    v_l_orden := NULL; v_l_desc := NULL; v_l_cuenta := NULL;
    v_l_amount := NULL; v_l_tax := NULL; v_l_tax_code := NULL; v_l_rate := NULL;
    IF v_el_id IS NOT NULL THEN
      IF p_business_expense_id IS NULL THEN
        RAISE EXCEPTION 'Una línea viene de una compra, pero la nota de crédito no está asociada a ninguna.';
      END IF;
      SELECT line_order, description, chart_account_code, amount, tax_amount, tax_code_id, tax_rate
        INTO v_l_orden, v_l_desc, v_l_cuenta, v_l_amount, v_l_tax, v_l_tax_code, v_l_rate
        FROM public.expense_lines
       WHERE tenant_id = p_tenant_id AND business_expense_id = p_business_expense_id AND id = v_el_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Una línea de la nota de crédito no pertenece a esta compra.';
      END IF;
      SELECT COALESCE(SUM(l.amount), 0), COALESCE(SUM(l.tax_amount), 0) INTO v_acreditado, v_tax_acred
        FROM public.supplier_credit_note_lines l
        JOIN public.supplier_credit_notes n ON n.id = l.credit_note_id
       WHERE l.expense_line_id = v_el_id AND n.status = 'emitida';
      IF v_monto > v_l_amount - v_acreditado THEN
        RAISE EXCEPTION 'Línea % ("%"): se puede acreditar hasta B/. % de base; ya se acreditaron B/. % con otras notas de crédito.',
          v_l_orden, v_l_desc, (v_l_amount - v_acreditado), v_acreditado;
      END IF;
      IF v_desc_linea = '' THEN v_desc_linea := v_l_desc; END IF;
      IF v_cod_cuenta = '' THEN v_cod_cuenta := coalesce(v_l_cuenta, ''); END IF;
    END IF;

    IF char_length(v_desc_linea) < 3 OR char_length(v_desc_linea) > 300 THEN
      RAISE EXCEPTION 'La descripción de cada línea debe tener entre 3 y 300 caracteres.';
    END IF;

    -- La cuenta: activa, que sirva para un gasto (no ingreso, pasivo ni
    -- patrimonio: el mismo predicado que `esTipoValidoParaGasto`) y que no sea
    -- una cuenta control.
    SELECT code, account_type, active, cuenta_control INTO v_cuenta
      FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = v_cod_cuenta;
    IF NOT FOUND OR NOT v_cuenta.active THEN
      RAISE EXCEPTION 'La cuenta % no existe o está desactivada.', v_cod_cuenta;
    END IF;
    IF v_cuenta.account_type IN ('income', 'equity', 'liability') OR v_cuenta.cuenta_control IS NOT NULL THEN
      RAISE EXCEPTION 'La cuenta % no sirve para una línea de compra.', v_cod_cuenta;
    END IF;

    -- El impuesto. Si la línea viene de la compra con su MISMA tasa, la de la
    -- línea (las anteriores a la 045 no tienen tax_code_id pero sí tax_rate).
    -- Si no, la tasa del catálogo (nunca la del body) y su cuenta (073).
    v_tasa_rate := 0;
    v_tasa_cuenta := NULL;
    IF v_el_id IS NOT NULL AND v_tax_code IS NOT DISTINCT FROM v_l_tax_code THEN
      v_tasa_rate := coalesce(v_l_rate, 0);
      IF v_tax_code IS NOT NULL THEN
        SELECT account_code INTO v_tasa_cuenta FROM public.tax_codes WHERE tenant_id = p_tenant_id AND id = v_tax_code;
      END IF;
    ELSIF v_tax_code IS NOT NULL THEN
      SELECT rate, account_code, active INTO v_tasa
        FROM public.tax_codes WHERE tenant_id = p_tenant_id AND id = v_tax_code;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Una línea tiene un impuesto que no existe en el catálogo.';
      END IF;
      IF NOT v_tasa.active AND v_tax_code IS DISTINCT FROM v_l_tax_code THEN
        RAISE EXCEPTION 'Una línea tiene un impuesto desactivado.';
      END IF;
      v_tasa_rate := v_tasa.rate;
      v_tasa_cuenta := v_tasa.account_code;
    END IF;

    -- Si acredita TODO lo que queda de una línea de la compra con su misma
    -- tasa, el ITBMS es el remanente exacto (el de la compra se cargó con
    -- ±0,02). Si no, el que escribió la persona, con la tolerancia de la compra.
    v_tax_sugerido := round(v_monto * v_tasa_rate, 2);
    IF v_el_id IS NOT NULL AND v_monto = v_l_amount - v_acreditado
       AND v_tax_code IS NOT DISTINCT FROM v_l_tax_code THEN
      v_tax_linea := coalesce(v_l_tax, 0) - v_tax_acred;
    ELSE
      v_tax_linea := round(coalesce((v_x->>'tax_amount')::numeric, v_tax_sugerido), 2);
      IF v_tax_linea < 0 OR abs(v_tax_linea - v_tax_sugerido) > 0.02 THEN
        RAISE EXCEPTION 'El impuesto de la línea "%" (B/. %) no corresponde a su tasa (B/. %).',
          v_desc_linea, v_tax_linea, v_tax_sugerido;
      END IF;
    END IF;
    IF v_tax_linea > 0 AND v_tasa_cuenta IS NULL THEN
      v_tasa_cuenta := '200003';
    END IF;

    v_orden := v_orden + 1;
    INSERT INTO _ncp_lineas VALUES (v_orden, v_el_id, v_desc_linea, v_cod_cuenta,
      v_monto, v_tax_code, v_tasa_rate, v_tax_linea, v_tasa_cuenta);
    v_sub := v_sub + v_monto;
    v_tax := v_tax + v_tax_linea;
  END LOOP;

  -- Tope del documento: lo que falta pagar de la compra (J-3). Sin compra no hay
  -- tope: la NC entera es saldo a favor con el proveedor.
  IF p_business_expense_id IS NOT NULL AND v_sub + v_tax > v_compra.balance_due THEN
    RAISE EXCEPTION 'La nota de crédito (B/. %) supera lo que falta pagar de esta compra (B/. %). Regístrala sin asociarla a la compra: queda como saldo a favor con el proveedor.',
      (v_sub + v_tax), v_compra.balance_due;
  END IF;

  -- El asiento que armó la app tiene que ser EXACTAMENTE el que salen de estas
  -- líneas, cuenta por cuenta y lado por lado (generaliza la verificación de
  -- 200001/200003 de la 066 y la 073).
  WITH esperado AS (
    SELECT '200001'::text AS code, round(v_sub + v_tax, 2) AS debit, 0::numeric AS credit
    UNION ALL
    SELECT cuenta, 0, round(SUM(amount), 2) FROM _ncp_lineas GROUP BY cuenta
    UNION ALL
    SELECT tax_cuenta, 0, round(SUM(tax_amount), 2) FROM _ncp_lineas
     WHERE tax_amount > 0 GROUP BY tax_cuenta
  ), esperado_neto AS (
    SELECT code, round(SUM(debit), 2) AS debit, round(SUM(credit), 2) AS credit FROM esperado GROUP BY code
  ), recibido AS (
    SELECT btrim(x->>'account_code') AS code,
           round(SUM(coalesce((x->>'debit')::numeric, 0)), 2) AS debit,
           round(SUM(coalesce((x->>'credit')::numeric, 0)), 2) AS credit
      FROM jsonb_array_elements(p_asiento) x
     GROUP BY btrim(x->>'account_code')
  )
  SELECT count(*) INTO v_dif FROM (
    (SELECT code, debit, credit FROM esperado_neto EXCEPT SELECT code, debit, credit FROM recibido)
    UNION ALL
    (SELECT code, debit, credit FROM recibido EXCEPT SELECT code, debit, credit FROM esperado_neto)
  ) d;
  IF v_dif > 0 THEN
    RAISE EXCEPTION 'El asiento no coincide con la nota de crédito (cuentas o montos distintos). No se registró nada.';
  END IF;

  -- PASADA 2: escribir. El número dentro de la transacción: si algo falla
  -- después, también se deshace y no queda hueco.
  v_seq := public.get_next_sequence_number(p_tenant_id, 'supplier_credit_note');
  v_numero := 'NC-CO-' || lpad(v_seq::text, 6, '0');

  INSERT INTO public.supplier_credit_notes (
    tenant_id, credit_note_number, business_expense_id, supplier_id,
    supplier_document_number, supplier_document_date, supplier_cufe,
    issue_date, reason, status, subtotal_total, tax_total, grand_total, created_by)
  VALUES (p_tenant_id, v_numero, p_business_expense_id, v_proveedor,
    btrim(p_doc_numero), p_doc_fecha, nullif(btrim(coalesce(p_doc_cufe, '')), ''),
    p_issue_date, btrim(p_reason), 'emitida', v_sub, v_tax, v_sub + v_tax, p_created_by)
  RETURNING id INTO v_nc_id;

  INSERT INTO public.supplier_credit_note_lines (
    tenant_id, credit_note_id, expense_line_id, line_order, description,
    chart_account_code, amount, tax_rate, tax_amount, tax_code_id)
  SELECT p_tenant_id, v_nc_id, expense_line_id, orden, description, cuenta, amount,
         tax_rate, tax_amount, tax_code_id
    FROM _ncp_lineas ORDER BY orden;

  v_desc := format('Nota de crédito de proveedor %s: %s, %s (documento del proveedor %s)',
    v_numero,
    CASE WHEN p_business_expense_id IS NOT NULL THEN 'compra ' || v_compra.description ELSE 'sin compra asociada' END,
    v_prov_nombre, btrim(p_doc_numero));

  v_entry_id := public.post_journal_entry(
    p_tenant_id, p_issue_date, v_desc, 'nota_credito_proveedor', p_asiento,
    v_nc_id, NULL, NULL, NULL, p_created_by, NULL, v_numero, 'nota-credito-proveedor:' || v_nc_id::text,
    btrim(p_doc_numero)
  );
  SELECT entry_number INTO v_entry_nro FROM public.journal_entries WHERE id = v_entry_id;

  RETURN jsonb_build_object(
    'id', v_nc_id, 'credit_note_number', v_numero,
    'subtotal', v_sub, 'tax', v_tax, 'total', v_sub + v_tax,
    'entry_id', v_entry_id, 'entry_number', v_entry_nro
  );
END $$;

REVOKE ALL ON FUNCTION public.create_supplier_credit_note(uuid, uuid, uuid, text, date, text, text, date, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_supplier_credit_note(uuid, uuid, uuid, text, date, text, text, date, jsonb, jsonb, uuid) TO service_role;

-- Aplicar el saldo a favor de una NC de compra a una compra del mismo proveedor.
CREATE OR REPLACE FUNCTION public.apply_supplier_credit_note(
  p_tenant_id           uuid,
  p_credit_note_id      uuid,
  p_business_expense_id uuid,
  p_amount              numeric,
  p_created_by          uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nc       record;
  v_compra   record;
  v_monto    numeric(12,2) := round(coalesce(p_amount, 0), 2);
  v_aplicado numeric(12,2);
  v_saldo    numeric(12,2);
BEGIN
  IF p_tenant_id IS NULL OR p_credit_note_id IS NULL OR p_business_expense_id IS NULL THEN
    RAISE EXCEPTION 'apply_supplier_credit_note: faltan el bufete, la nota de crédito o la compra';
  END IF;
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a aplicar tiene que ser mayor que cero.';
  END IF;

  SELECT id, credit_note_number, supplier_id, business_expense_id, status, grand_total
    INTO v_nc
    FROM public.supplier_credit_notes
   WHERE tenant_id = p_tenant_id AND id = p_credit_note_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota de crédito de proveedor no encontrada.';
  END IF;
  IF v_nc.status <> 'emitida' THEN
    RAISE EXCEPTION 'La nota de crédito % está anulada: no tiene saldo a favor.', v_nc.credit_note_number;
  END IF;
  IF v_nc.business_expense_id IS NOT NULL THEN
    RAISE EXCEPTION 'La nota de crédito % ya acredita la compra sobre la que se registró: no tiene saldo a favor.', v_nc.credit_note_number;
  END IF;

  SELECT id, supplier_id, status, balance_due, description
    INTO v_compra
    FROM public.business_expenses
   WHERE tenant_id = p_tenant_id AND id = p_business_expense_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra no encontrada.';
  END IF;
  IF v_compra.supplier_id IS DISTINCT FROM v_nc.supplier_id THEN
    RAISE EXCEPTION 'La compra "%" es de otro proveedor.', v_compra.description;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.journal_entries
                  WHERE tenant_id = p_tenant_id AND source_type = 'gasto' AND source_id = p_business_expense_id) THEN
    RAISE EXCEPTION 'La compra "%" no está en el libro contable.', v_compra.description;
  END IF;
  IF v_monto > v_compra.balance_due + 0.001 THEN
    RAISE EXCEPTION 'B/. % supera lo que falta pagar de la compra "%" (B/. %).', v_monto, v_compra.description, v_compra.balance_due;
  END IF;

  SELECT COALESCE(SUM(amount_applied), 0) INTO v_aplicado
    FROM public.supplier_credit_note_applications WHERE credit_note_id = p_credit_note_id;
  v_saldo := v_nc.grand_total - v_aplicado;
  IF v_monto > v_saldo + 0.001 THEN
    RAISE EXCEPTION 'El saldo a favor de la nota de crédito % es B/. %: no alcanza para aplicar B/. %.',
      v_nc.credit_note_number, v_saldo, v_monto;
  END IF;

  INSERT INTO public.supplier_credit_note_applications (tenant_id, credit_note_id, business_expense_id, amount_applied, created_by)
  VALUES (p_tenant_id, p_credit_note_id, p_business_expense_id, v_monto, p_created_by);

  RETURN jsonb_build_object('aplicado', v_monto, 'saldo_a_favor', v_saldo - v_monto);
END $$;

REVOKE ALL ON FUNCTION public.apply_supplier_credit_note(uuid, uuid, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_supplier_credit_note(uuid, uuid, uuid, numeric, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VERIFICACIÓN: nada cambió en lo que ya existía
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n int;
BEGIN
  -- La fórmula nueva, calculada con un SELECT (sin escribir en facturas ni
  -- compras), contra la foto de antes. Hoy no hay aplicaciones, así que tiene
  -- que dar exactamente lo mismo que la fórmula de la 051 / 066.
  SELECT count(*) INTO v_n
    FROM _076_antes a
   WHERE a.credited_total IS DISTINCT FROM (
     CASE WHEN a.t = 'f' THEN
       COALESCE((SELECT SUM(cn.grand_total) FROM public.credit_notes cn
                  WHERE cn.invoice_id = a.id AND cn.status = 'emitida'), 0)
     + COALESCE((SELECT SUM(ap.amount_applied) FROM public.credit_note_applications ap
                   JOIN public.credit_notes cn2 ON cn2.id = ap.credit_note_id
                  WHERE ap.invoice_id = a.id AND cn2.status = 'emitida'), 0)
     ELSE
       COALESCE((SELECT SUM(n.grand_total) FROM public.supplier_credit_notes n
                  WHERE n.business_expense_id = a.id AND n.status = 'emitida'), 0)
     + COALESCE((SELECT SUM(ap.amount_applied) FROM public.supplier_credit_note_applications ap
                   JOIN public.supplier_credit_notes n2 ON n2.id = ap.credit_note_id
                  WHERE ap.business_expense_id = a.id AND n2.status = 'emitida'), 0)
     END);
  IF v_n > 0 THEN
    RAISE EXCEPTION '076: % documento(s) cambiaron su credited_total con la fórmula nueva. No se toca nada.', v_n;
  END IF;

  IF to_regprocedure('public.create_supplier_credit_note(uuid,uuid,text,date,text,text,date,jsonb,jsonb,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '076: quedó la firma vieja de create_supplier_credit_note';
  END IF;
  IF has_function_privilege('authenticated', 'public.apply_credit_note(uuid,uuid,uuid,numeric,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_supplier_credit_note(uuid,uuid,uuid,numeric,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_supplier_credit_note(uuid,uuid,uuid,text,date,text,text,date,jsonb,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '076: un RPC quedó ejecutable por la sesión del usuario';
  END IF;
  IF has_table_privilege('authenticated', 'public.credit_note_applications', 'INSERT')
     OR has_table_privilege('authenticated', 'public.supplier_credit_note_applications', 'INSERT') THEN
    RAISE EXCEPTION '076: las aplicaciones quedaron escribibles por la sesión del usuario';
  END IF;

  RAISE NOTICE '076 ✅ NC con documento opcional, aplicaciones, credited_total idéntico en % documento(s)',
    (SELECT count(*) FROM _076_antes);
END $$;

COMMIT;
