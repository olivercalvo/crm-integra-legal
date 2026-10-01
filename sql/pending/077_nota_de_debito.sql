-- ============================================================================
-- 077 · NOTA DE DÉBITO (Bloque 1, decisión 14)
-- ============================================================================
-- Pedido de Oliver (01/10/2026): "Nota de débito (d14): mismo efecto que una
-- factura de venta, como tipo de documento".
--
-- Una nota de débito ES una factura de venta con otro tipo de documento: se
-- carga en el mismo formulario, se emite igual, su asiento es el de la factura
-- (DEBE 100004 con el cliente / HABER ingreso e impuesto), suma en la
-- antigüedad, en el resumen de ITBMS y en el Estado de Resultado igual que una
-- factura. Lo único propio:
--   1. `invoice_kind = 'NOTA_DEBITO'` y su serie `ND-000001` (secuencia
--      `debit_note`, que no se reinicia).
--   2. `referenced_invoice_id`: la factura que ajusta (OPCIONAL), del mismo
--      cliente y ya emitida. Es lo que la DGI va a pedir para el tipo 05; el
--      envío al PAC queda apagado en la app hasta probarlo en el sandbox.
--   3. T4 congela `referenced_invoice_id` al emitir, como el resto del
--      documento.
--
-- No toca el libro ni el motor: el asiento sigue siendo `source_type = 'factura'`.
-- 🛡️ Sólo staging hasta el «aplica» de Oliver. En producción va en la ventana.
-- ============================================================================
BEGIN;

-- 1. El tipo de documento y su serie
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_invoice_kind_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_invoice_kind_check
  CHECK (invoice_kind = ANY (ARRAY['HONORARIOS'::text, 'REEMBOLSO'::text, 'NOTA_DEBITO'::text]));

ALTER TABLE public.numbering_sequences DROP CONSTRAINT IF EXISTS numbering_sequences_sequence_type_check;
ALTER TABLE public.numbering_sequences ADD CONSTRAINT numbering_sequences_sequence_type_check
  CHECK (sequence_type = ANY (ARRAY['quote'::text, 'invoice_hon'::text, 'invoice_reim'::text, 'credit_note'::text,
    'client'::text, 'supplier'::text, 'payment'::text, 'supplier_payment'::text, 'supplier_credit_note'::text,
    'purchase'::text, 'manual_entry'::text, 'debit_note'::text]));

INSERT INTO public.numbering_sequences (tenant_id, sequence_type, last_number)
SELECT tn.id, 'debit_note', 0 FROM public.tenants tn
 WHERE NOT EXISTS (SELECT 1 FROM public.numbering_sequences ns
                    WHERE ns.tenant_id = tn.id AND ns.sequence_type = 'debit_note');

-- 2. La factura que ajusta (opcional)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS referenced_invoice_id uuid NULL REFERENCES public.invoices(id);
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_referencia_solo_en_nd;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_referencia_solo_en_nd
  CHECK (referenced_invoice_id IS NULL OR invoice_kind = 'NOTA_DEBITO');
CREATE INDEX IF NOT EXISTS invoices_por_referencia ON public.invoices (referenced_invoice_id)
  WHERE referenced_invoice_id IS NOT NULL;

COMMENT ON COLUMN public.invoices.referenced_invoice_id IS
  'Sólo en una NOTA_DEBITO (077): la factura que ajusta. Opcional, del mismo cliente, ya emitida y que no sea otra nota de débito. Se congela al emitir (T4).';

CREATE OR REPLACE FUNCTION public.finanzas_referencia_de_nota_de_debito()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ref record;
BEGIN
  IF NEW.referenced_invoice_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.referenced_invoice_id IS NOT DISTINCT FROM OLD.referenced_invoice_id
     AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
    RETURN NEW;
  END IF;
  SELECT tenant_id, client_id, status, invoice_kind, invoice_number INTO v_ref
    FROM public.invoices WHERE id = NEW.referenced_invoice_id;
  IF NOT FOUND OR v_ref.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'La factura que ajusta la nota de débito no existe.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_ref.client_id IS DISTINCT FROM NEW.client_id THEN
    RAISE EXCEPTION 'La factura % es de otro cliente: la nota de débito sólo ajusta facturas del mismo cliente.',
      v_ref.invoice_number USING ERRCODE = 'check_violation';
  END IF;
  IF v_ref.invoice_kind = 'NOTA_DEBITO' THEN
    RAISE EXCEPTION 'Una nota de débito ajusta una factura, no otra nota de débito.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_ref.status NOT IN ('emitida', 'parcialmente_pagada', 'pagada') THEN
    RAISE EXCEPTION 'La factura % no está emitida (está %): no se puede ajustar con una nota de débito.',
      coalesce(v_ref.invoice_number, '(borrador)'), v_ref.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_referencia_de_nota_de_debito ON public.invoices;
CREATE TRIGGER trg_referencia_de_nota_de_debito
  BEFORE INSERT OR UPDATE OF referenced_invoice_id, client_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_referencia_de_nota_de_debito();

-- 3. T4: la referencia se congela al emitir, como el resto del documento.
--    Es la definición vigente de T4 (068) con UNA columna más.
CREATE OR REPLACE FUNCTION public.finanzas_invoice_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status IN ('borrador', 'cancelada_pre_emision') THEN
    RETURN NEW;
  END IF;

  IF OLD.invoice_number  IS DISTINCT FROM NEW.invoice_number
     OR OLD.invoice_kind   IS DISTINCT FROM NEW.invoice_kind
     OR OLD.quote_id       IS DISTINCT FROM NEW.quote_id
     OR OLD.client_id      IS DISTINCT FROM NEW.client_id
     OR OLD.case_id        IS DISTINCT FROM NEW.case_id
     OR OLD.issue_date     IS DISTINCT FROM NEW.issue_date
     OR OLD.accounting_date IS DISTINCT FROM NEW.accounting_date
     OR OLD.due_date       IS DISTINCT FROM NEW.due_date
     OR OLD.currency       IS DISTINCT FROM NEW.currency
     OR OLD.subtotal_total IS DISTINCT FROM NEW.subtotal_total
     OR OLD.tax_total      IS DISTINCT FROM NEW.tax_total
     OR OLD.grand_total    IS DISTINCT FROM NEW.grand_total
     OR OLD.notes          IS DISTINCT FROM NEW.notes
     OR OLD.referenced_invoice_id IS DISTINCT FROM NEW.referenced_invoice_id
     OR OLD.tenant_id      IS DISTINCT FROM NEW.tenant_id
     OR OLD.created_at     IS DISTINCT FROM NEW.created_at
     OR OLD.created_by     IS DISTINCT FROM NEW.created_by
  THEN
    RAISE EXCEPTION 'Factura % está en status "%": solo se permiten cambios a status, amount_paid o updated_at',
      OLD.invoice_number, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. Verificación
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.tenants tn
   WHERE NOT EXISTS (SELECT 1 FROM public.numbering_sequences ns
                      WHERE ns.tenant_id = tn.id AND ns.sequence_type = 'debit_note');
  IF v_n > 0 THEN
    RAISE EXCEPTION '077: % bufete(s) sin la secuencia debit_note', v_n;
  END IF;
  IF position('referenced_invoice_id' IN pg_get_functiondef('public.finanzas_invoice_immutability()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '077: T4 no congela referenced_invoice_id';
  END IF;
  IF position('accounting_date' IN pg_get_functiondef('public.finanzas_invoice_immutability()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '077: T4 perdió accounting_date (068)';
  END IF;
  RAISE NOTICE '077 ✅ tipo NOTA_DEBITO, serie debit_note y referencia opcional a la factura';
END $$;

COMMIT;
