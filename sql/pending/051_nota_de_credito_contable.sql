-- ============================================================================
-- 051 — NOTA DE CRÉDITO CONTABLE (Bloque 5, commit 1): el modelo.
-- ============================================================================
-- Diseño aprobado por Oliver el 22/09/2026 (D1-D7). Tres cosas:
--
--   1. `credit_notes` gana desde ya las TRECE columnas fiscales de `invoices`
--      (D1, opción B): el envío a la DGI es otro bloque, pero el modelo nace
--      preparado. `fe_estado` default 'no_emitida' es lo que la pantalla y el
--      PDF muestran como "documento interno, sin autorización de la DGI".
--   2. `invoices.credited_total`, DERIVADA por trigger de las NC `emitida` de
--      la factura, con guard (patrón 048/049): NO se escribe, se emite la NC.
--      T7a pasa a derivar el status contra el TOTAL NETO (`grand_total −
--      credited_total`): con pagos 0 y crédito = total, la factura queda
--      `emitida` con saldo 0 — NO `pagada` (D3). El badge "Acreditada total"
--      lo deriva la pantalla de `credited_total = grand_total`.
--   3. `invoices.balance_due` se RECREA como
--      `grand_total − amount_paid − credited_total` (era GENERATED ALWAYS sin
--      el crédito: una NC parcial no podía bajar el saldo).
--
-- 📋 DEPENDENCIAS DE `balance_due`, contadas en staging el 22/09 (regla de
--    Oliver, por FND-009): `pg_depend` sobre la columna tiene UNA entrada, su
--    propio `pg_attrdef`; vistas con `balance_due`: 0; funciones de `public`
--    con `balance_due` en el cuerpo: 0; índices: 0; políticas: 0; constraints:
--    0. Los 5 triggers de `invoices` no la nombran. La app la LEE en 16
--    archivos por nombre y no la escribe nunca. Nada que no se recree solo.
--    Consecuencia visible: cambia de `ordinal_position` (16 → última). Se avisa
--    a PostgREST con NOTIFY para que recargue el esquema.
--
-- 📋 Columnas verificadas contra information_schema el 22/09:
--    invoices: balance_due numeric GENERATED ALWAYS AS (grand_total - amount_paid)
--    STORED; sin credited_total. credit_notes: id, tenant_id,
--    credit_note_number, invoice_id, client_id, issue_date, reason, status,
--    currency, subtotal_total, tax_total, grand_total, created_at, updated_at,
--    created_by, observations — sin columna fiscal alguna. CHECK
--    credit_notes_status_check = (status = 'emitida'): UN valor, y se
--    re-declara con ese mismo valor (no hay anulación de NC en este bloque).
--    Los tipos de las 13 fiscales se copian de `invoices` (019): fe_estado
--    text NOT NULL 'no_emitida', i_amb smallint, punto_facturacion varchar(3),
--    numero_documento bigint, dgi_numero_documento / dgi_cufe /
--    dgi_protocolo_autorizacion / dgi_cafe_url / qr_content / cafe_storage_key
--    / xml_storage_key text, dgi_fecha_autorizacion timestamptz,
--    ef_invoice_uuid uuid.
--    Triggers: `finanzas_credit_note_immutability` protege una lista EXPLÍCITA
--    (id, tenant, número, factura, cliente, fecha, motivo, status, moneda,
--    created_*): las columnas fiscales quedan escribibles para el bloque
--    fiscal, a propósito. `finanzas_invoice_immutability` ídem: no nombra
--    `credited_total`, así que el trigger de acá puede escribirla; el guard de
--    abajo es el que impide que la escriba cualquier otro.
--
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS, DROP+ADD de CHECK, CREATE OR
-- REPLACE. El DROP/ADD de `balance_due` está protegido: solo corre si la
-- expresión actual no incluye `credited_total`. Re-ejecutable.
--
-- 📋 Pre-flight contra PRODUCCIÓN, el día que vaya (SELECT puros; NO ahora):
--   SELECT count(*) FROM credit_notes;                       -- cuántas NC hay
--   SELECT count(*) FROM invoices WHERE balance_due <> grand_total - amount_paid;  -- 0
--   Va DESPUÉS de la 032 (T7a/T4b) y de la 034.
--
-- Verificación: sql/tests/verificacion-051-nota-de-credito.sql (ROLLBACK).
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. credit_notes: las 13 columnas fiscales (los tipos de invoices, 019)
-- ----------------------------------------------------------------------------
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS fe_estado                  text        NOT NULL DEFAULT 'no_emitida';
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS i_amb                      smallint    NULL;
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS punto_facturacion          varchar(3)  NULL;
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS numero_documento           bigint      NULL;
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS dgi_numero_documento       text        NULL;
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS dgi_cufe                   text        NULL;
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS dgi_fecha_autorizacion     timestamptz NULL;
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS dgi_protocolo_autorizacion text        NULL;
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS dgi_cafe_url               text        NULL;
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS cafe_storage_key           text        NULL;
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS xml_storage_key            text        NULL;
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS qr_content                 text        NULL;
ALTER TABLE public.credit_notes ADD COLUMN IF NOT EXISTS ef_invoice_uuid            uuid        NULL;

-- Los CINCO valores de invoices_fe_estado_check (019), tal cual.
ALTER TABLE public.credit_notes DROP CONSTRAINT IF EXISTS credit_notes_fe_estado_check;
ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_fe_estado_check
  CHECK (fe_estado IN ('no_emitida', 'pending', 'authorized', 'canceled', 'error'));
ALTER TABLE public.credit_notes DROP CONSTRAINT IF EXISTS credit_notes_i_amb_check;
ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_i_amb_check
  CHECK (i_amb IS NULL OR i_amb IN (1, 2));

-- El CHECK de status, re-declarado COMPLETO con su único valor de hoy. Una NC
-- no se anula en este bloque; el día que se pueda, se agrega acá el valor.
ALTER TABLE public.credit_notes DROP CONSTRAINT IF EXISTS credit_notes_status_check;
ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_status_check
  CHECK (status IN ('emitida'));

COMMENT ON COLUMN public.credit_notes.fe_estado IS
  'Estado ante la DGI (051). no_emitida = documento INTERNO sin autorización fiscal: la pantalla y el PDF lo marcan. El envío al PAC (tipoDocumento 04 con documentosFiscalesReferenciados) es el bloque fiscal.';

-- ----------------------------------------------------------------------------
-- 2. invoices.credited_total derivada, su guard, y T7a con el total neto
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS credited_total numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_credited_total_range_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_credited_total_range_check CHECK (credited_total >= 0);

COMMENT ON COLUMN public.invoices.credited_total IS
  'DERIVADA (051): SUM(credit_notes.grand_total) de las NC emitida de la factura. No se escribe: se emite la NC. Acreditada al 100% = emitida con saldo 0 (NO pagada).';

-- T7a con el crédito: el status se deriva contra el total NETO. Con pagos 0 la
-- factura sigue `emitida` aunque el crédito la deje en saldo 0 (D3).
CREATE OR REPLACE FUNCTION public.finanzas_recalc_one_invoice_amount_paid(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_status      TEXT;
  v_grand       NUMERIC(12,2);
  v_credited    NUMERIC(12,2);
  v_paid        NUMERIC(12,2);
  v_new_status  TEXT;
BEGIN
  SELECT status, grand_total, credited_total INTO v_status, v_grand, v_credited
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount_applied), 0) INTO v_paid
  FROM payment_applications
  WHERE invoice_id = p_invoice_id;

  v_new_status := v_status;

  IF v_status = 'anulada' THEN
    -- terminal: T7a no toca status
    NULL;
  ELSIF v_status NOT IN ('emitida', 'parcialmente_pagada', 'pagada') THEN
    -- borrador, cancelada_pre_emision: T7a no opina sobre status
    NULL;
  ELSE
    IF v_paid = 0 THEN
      v_new_status := 'emitida';
    ELSIF v_paid >= v_grand - COALESCE(v_credited, 0) THEN
      v_new_status := 'pagada';
    ELSE
      v_new_status := 'parcialmente_pagada';
    END IF;
  END IF;

  -- ---- La llave de T4b. ---------------------------------------------------
  PERFORM set_config('finanzas.recalc', 'on', true);

  IF v_new_status IS DISTINCT FROM v_status THEN
    UPDATE invoices
    SET amount_paid = v_paid,
        status      = v_new_status
    WHERE id = p_invoice_id;
  ELSE
    UPDATE invoices
    SET amount_paid = v_paid
    WHERE id = p_invoice_id;
  END IF;

  PERFORM set_config('finanzas.recalc', 'off', true);
END;
$$;

COMMENT ON FUNCTION public.finanzas_recalc_one_invoice_amount_paid IS
  'T7a (032, ramificada en la 051): amount_paid = SUM(payment_applications) y el status contra el total NETO (grand_total − credited_total). Con pagos 0 la factura queda emitida aunque el crédito la deje en saldo 0.';

-- El recálculo del crédito: SUM de las NC emitida. Escribe credited_total con
-- la llave y después llama a T7a, que decide el status con el neto.
CREATE OR REPLACE FUNCTION public.finanzas_recalc_one_invoice_credited(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_credited numeric(12,2);
BEGIN
  SELECT COALESCE(SUM(grand_total), 0) INTO v_credited
    FROM public.credit_notes
   WHERE invoice_id = p_invoice_id AND status = 'emitida';

  PERFORM set_config('finanzas.recalc', 'on', true);
  UPDATE public.invoices SET credited_total = v_credited WHERE id = p_invoice_id;
  PERFORM set_config('finanzas.recalc', 'off', true);

  PERFORM public.finanzas_recalc_one_invoice_amount_paid(p_invoice_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.finanzas_trg_recalc_invoice_credited()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.finanzas_recalc_one_invoice_credited(OLD.invoice_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.finanzas_recalc_one_invoice_credited(OLD.invoice_id);
  END IF;
  PERFORM public.finanzas_recalc_one_invoice_credited(NEW.invoice_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_invoice_credited ON public.credit_notes;
CREATE TRIGGER trg_recalc_invoice_credited
  AFTER INSERT OR UPDATE OF grand_total, status, invoice_id OR DELETE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_trg_recalc_invoice_credited();

-- El guard: credited_total NO se escribe a mano (T4b'' — misma llave y misma
-- válvula que amount_paid).
CREATE OR REPLACE FUNCTION public.finanzas_guard_credited_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_recalc   text := current_setting('finanzas.recalc', true);
  v_override text := current_setting('finanzas.amount_paid_override', true);
BEGIN
  IF v_recalc = 'on' THEN
    RETURN NEW;
  END IF;
  IF v_override = 'on' THEN
    RAISE WARNING 'finanzas.amount_paid_override: escritura MANUAL de credited_total en la factura % (%). Ver sop.md SOP-017.',
      COALESCE(NEW.invoice_number, '(sin número)'), TG_OP;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.credited_total IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'La factura % no puede nacer con credited_total = %. Se DERIVA de las notas de crédito (051): para acreditar, se emite la NC.',
        COALESCE(NEW.invoice_number, '(sin número)'), NEW.credited_total
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.credited_total IS DISTINCT FROM OLD.credited_total THEN
    RAISE EXCEPTION 'Escritura directa de credited_total en la factura % (% → %). Se DERIVA de las notas de crédito (051): para acreditar, se emite la NC.',
      COALESCE(OLD.invoice_number, '(sin número)'), OLD.credited_total, NEW.credited_total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credited_total_guard ON public.invoices;
CREATE TRIGGER trg_credited_total_guard
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_guard_credited_total();

-- ----------------------------------------------------------------------------
-- 3. balance_due = grand_total − amount_paid − credited_total
-- ----------------------------------------------------------------------------
-- Una columna GENERATED no admite ALTER de su expresión: DROP + ADD. Protegido
-- para que la segunda pasada no toque nada.
DO $$
DECLARE v_expr text;
BEGIN
  SELECT generation_expression INTO v_expr
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'balance_due';
  IF v_expr IS NULL OR v_expr NOT ILIKE '%credited_total%' THEN
    ALTER TABLE public.invoices DROP COLUMN IF EXISTS balance_due;
    ALTER TABLE public.invoices
      ADD COLUMN balance_due numeric(12,2)
      GENERATED ALWAYS AS (grand_total - amount_paid - credited_total) STORED;
    RAISE NOTICE '051: balance_due recreada como grand_total - amount_paid - credited_total';
  ELSE
    RAISE NOTICE '051: balance_due ya incluye credited_total, no se toca';
  END IF;
END $$;

COMMENT ON COLUMN public.invoices.balance_due IS
  'GENERADA (051): grand_total − amount_paid − credited_total. Lo que falta cobrar después de pagos Y notas de crédito.';

-- Backfill de credited_total para las NC que ya existan (0 en staging al 22/09;
-- en producción, las que hubiera): idempotente.
DO $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN SELECT DISTINCT invoice_id FROM public.credit_notes LOOP
    PERFORM public.finanzas_recalc_one_invoice_credited(r.invoice_id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE '051: credited_total recalculada en % factura(s) con NC', v_n;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Verificación de cierre + PostgREST
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_fis int; v_chk int; v_trg int; v_expr text; v_neg int;
BEGIN
  SELECT count(*) INTO v_fis FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'credit_notes'
     AND column_name IN ('fe_estado','i_amb','punto_facturacion','numero_documento','dgi_numero_documento','dgi_cufe',
                         'dgi_fecha_autorizacion','dgi_protocolo_autorizacion','dgi_cafe_url','cafe_storage_key',
                         'xml_storage_key','qr_content','ef_invoice_uuid');
  SELECT count(*) INTO v_chk FROM pg_constraint
   WHERE conname IN ('credit_notes_fe_estado_check','credit_notes_i_amb_check','credit_notes_status_check','invoices_credited_total_range_check');
  SELECT count(*) INTO v_trg FROM pg_trigger WHERE tgname IN ('trg_recalc_invoice_credited','trg_credited_total_guard');
  SELECT generation_expression INTO v_expr FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'balance_due';
  SELECT count(*) INTO v_neg FROM public.invoices WHERE balance_due <> grand_total - amount_paid - credited_total;
  IF v_fis <> 13 OR v_chk <> 4 OR v_trg <> 2 OR v_expr NOT ILIKE '%credited_total%' OR v_neg <> 0 THEN
    RAISE EXCEPTION '051: verificación fallida (fiscales %, checks %, triggers %, balance_due = %, inconsistentes %)',
      v_fis, v_chk, v_trg, v_expr, v_neg;
  END IF;
  RAISE NOTICE '051 ✅ 13 columnas fiscales en credit_notes, credited_total derivada con guard, T7a con total neto, balance_due = %', v_expr;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
