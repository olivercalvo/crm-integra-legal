-- ============================================================================
-- 068 — FECHA DE DOCUMENTO Y FECHA DE REGISTRO (Bloque 1, E1)
-- ============================================================================
-- 30/09/2026. Plan: `docs/finanzas/plan-bloque1.md`, punto 1.
--
-- Josuarth (revisión del 28/09 y reunión del 30/09): todo documento tipo factura
-- lleva DOS fechas.
--   · La del DOCUMENTO: informativa. La que va a la DGI, la base del
--     vencimiento y de la ventana de 182 h. Es la columna que ya existía:
--     `invoices.issue_date`, `business_expenses.expense_date`, `expenses.date`,
--     `credit_notes.issue_date`.
--   · La de REGISTRO: la contable. Es la `transaction_date` del asiento, define
--     el período y no puede caer en un mes cerrado. Columna NUEVA:
--     `accounting_date`, en las cuatro tablas.
--   · `supplier_credit_notes` ya tenía las dos desde la `066`: su `issue_date`
--     ES la de registro y `supplier_document_date` la del proveedor. No se le
--     agrega nada.
--
-- ⚠️ NO CONFUNDIR con `journal_entries.record_date`: ese es el sello de
--    GRABACIÓN del asiento (`current_date` del día en que se posteó). La
--    "fecha de registro" de Josuarth es `journal_entries.transaction_date`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 NO SE TOCA EL LIBRO
-- ─────────────────────────────────────────────────────────────────────────────
-- Ningún UPDATE ni DELETE sobre `journal_entries` ni `journal_entry_lines`. El
-- libro sólo se LEE para el backfill: la fecha de registro de un documento que
-- ya está en el libro es la `transaction_date` de SU asiento (el UNIQUE de la
-- `034` garantiza que hay a lo sumo uno). Un documento sin asiento toma la
-- fecha del documento, que era con la que se iba a postear.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL BACKFILL Y LOS TRIGGERS DE INMUTABILIDAD
-- ─────────────────────────────────────────────────────────────────────────────
-- T4 (facturas), T5 (NC) y el de la `049` (gastos de trámite) congelan listas
-- EXPLÍCITAS de columnas. `accounting_date` todavía no está en ninguna, así que
-- el backfill pasa. RECIÉN DESPUÉS se agrega a las tres listas (§4): desde ahí,
-- un documento emitido o posteado ya no mueve su fecha de registro.
-- `business_expenses` no tiene trigger de inmutabilidad (lo cuida
-- `gateContable` en la app); esta migración no le agrega uno.
--
-- Los triggers de `updated_at` se APAGAN durante el backfill y se vuelven a
-- prender en la misma transacción: llenar una columna nueva no es "modificar"
-- el documento, y 102 facturas de producción no tienen que aparecer como
-- editadas hoy.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL VALOR POR DEFECTO, EN LA BASE
-- ─────────────────────────────────────────────────────────────────────────────
-- Un trigger BEFORE INSERT completa `accounting_date` con la fecha del
-- documento si el INSERT no la trae. La app nueva siempre la manda; el trigger
-- es para los caminos que no la conocen (conversión de cotización, seeds,
-- scripts) y para el código de `main` en la ventana del despliegue.
--
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS, backfill sólo de NULL,
--               CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE.
-- 🛑 SOLO STAGING hasta la ventana del despliegue. Va después de la `067`.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.supplier_credit_notes') IS NULL THEN
    RAISE EXCEPTION '068: falta la 066 (supplier_credit_notes). Aplicar la cola en orden.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'reject_expense_mutation_si_asentado'
  ) THEN
    RAISE EXCEPTION '068: falta la 038/049 (reject_expense_mutation_si_asentado).';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Las columnas
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoices          ADD COLUMN IF NOT EXISTS accounting_date date;
ALTER TABLE public.business_expenses ADD COLUMN IF NOT EXISTS accounting_date date;
ALTER TABLE public.expenses          ADD COLUMN IF NOT EXISTS accounting_date date;
ALTER TABLE public.credit_notes      ADD COLUMN IF NOT EXISTS accounting_date date;

-- ----------------------------------------------------------------------------
-- 2. El backfill: la fecha del asiento si lo hay, si no la del documento
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoices          DISABLE TRIGGER trg_invoices_updated_at;
ALTER TABLE public.credit_notes      DISABLE TRIGGER trg_credit_notes_updated_at;
ALTER TABLE public.business_expenses DISABLE TRIGGER trg_business_expenses_updated_at;

UPDATE public.invoices i
   SET accounting_date = coalesce(
         (SELECT je.transaction_date FROM public.journal_entries je
           WHERE je.tenant_id = i.tenant_id AND je.source_type = 'factura' AND je.source_id = i.id),
         i.issue_date)
 WHERE i.accounting_date IS NULL;

UPDATE public.business_expenses b
   SET accounting_date = coalesce(
         (SELECT je.transaction_date FROM public.journal_entries je
           WHERE je.tenant_id = b.tenant_id AND je.source_type = 'gasto' AND je.source_id = b.id),
         b.expense_date)
 WHERE b.accounting_date IS NULL;

UPDATE public.expenses e
   SET accounting_date = coalesce(
         (SELECT je.transaction_date FROM public.journal_entries je
           WHERE je.tenant_id = e.tenant_id AND je.source_type = 'gasto_tramite' AND je.source_id = e.id),
         e.date)
 WHERE e.accounting_date IS NULL;

-- La NC de una ANULACIÓN no tiene asiento propio (D5): toma su `issue_date`,
-- que es la fecha con la que se posteó la reversión de su factura.
UPDATE public.credit_notes c
   SET accounting_date = coalesce(
         (SELECT je.transaction_date FROM public.journal_entries je
           WHERE je.tenant_id = c.tenant_id AND je.source_type = 'nota_credito' AND je.source_id = c.id),
         c.issue_date)
 WHERE c.accounting_date IS NULL;

ALTER TABLE public.invoices          ENABLE TRIGGER trg_invoices_updated_at;
ALTER TABLE public.credit_notes      ENABLE TRIGGER trg_credit_notes_updated_at;
ALTER TABLE public.business_expenses ENABLE TRIGGER trg_business_expenses_updated_at;

ALTER TABLE public.invoices          ALTER COLUMN accounting_date SET NOT NULL;
ALTER TABLE public.business_expenses ALTER COLUMN accounting_date SET NOT NULL;
ALTER TABLE public.expenses          ALTER COLUMN accounting_date SET NOT NULL;
ALTER TABLE public.credit_notes      ALTER COLUMN accounting_date SET NOT NULL;

COMMENT ON COLUMN public.invoices.accounting_date IS
  'Fecha de REGISTRO (contable): la transaction_date del asiento, define el período. La de documento es issue_date (la que va a la DGI). 068, Bloque 1.';
COMMENT ON COLUMN public.business_expenses.accounting_date IS
  'Fecha de REGISTRO (contable): la transaction_date del asiento de la compra. La de documento es expense_date (base del vencimiento). 068, Bloque 1.';
COMMENT ON COLUMN public.expenses.accounting_date IS
  'Fecha de REGISTRO (contable): la transaction_date del asiento del gasto de trámite. La de documento es date (base del vencimiento). 068, Bloque 1.';
COMMENT ON COLUMN public.credit_notes.accounting_date IS
  'Fecha de REGISTRO (contable) de la NC, la elige el contador en un período abierto. La de documento es issue_date (el día en que se emite; la que va a la DGI). 068, Bloque 1.';

-- ----------------------------------------------------------------------------
-- 3. El valor por defecto: la fecha del documento, si el INSERT no la trae
-- ----------------------------------------------------------------------------
-- La columna del documento llega por argumento del trigger y se lee con
-- `to_jsonb(NEW)`: una sola función para las cuatro tablas sin nombrar un campo
-- que alguna de ellas no tiene.
CREATE OR REPLACE FUNCTION public.finanzas_fecha_de_registro_por_defecto()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.accounting_date IS NULL THEN
    NEW.accounting_date := (to_jsonb(NEW) ->> TG_ARGV[0])::date;
  END IF;
  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION public.finanzas_fecha_de_registro_por_defecto IS
  'BEFORE INSERT: si no viene accounting_date, toma la fecha del documento (la columna llega en TG_ARGV[0]). 068.';

DROP TRIGGER IF EXISTS trg_invoices_fecha_de_registro ON public.invoices;
CREATE TRIGGER trg_invoices_fecha_de_registro
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_fecha_de_registro_por_defecto('issue_date');

DROP TRIGGER IF EXISTS trg_business_expenses_fecha_de_registro ON public.business_expenses;
CREATE TRIGGER trg_business_expenses_fecha_de_registro
  BEFORE INSERT ON public.business_expenses
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_fecha_de_registro_por_defecto('expense_date');

DROP TRIGGER IF EXISTS trg_expenses_fecha_de_registro ON public.expenses;
CREATE TRIGGER trg_expenses_fecha_de_registro
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_fecha_de_registro_por_defecto('date');

DROP TRIGGER IF EXISTS trg_credit_notes_fecha_de_registro ON public.credit_notes;
CREATE TRIGGER trg_credit_notes_fecha_de_registro
  BEFORE INSERT ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_fecha_de_registro_por_defecto('issue_date');

-- ----------------------------------------------------------------------------
-- 4. La fecha de registro entra a las listas CONGELADAS
-- ----------------------------------------------------------------------------
-- Copias textuales de la versión vigente (032, 060 y 049), con UNA columna más
-- cada una: `accounting_date`. Nada más cambia.

-- 4.a T4 — facturas (versión vigente: 032).
CREATE OR REPLACE FUNCTION public.finanzas_invoice_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;
COMMENT ON FUNCTION public.finanzas_invoice_immutability IS
  'T4. En una factura que ya no está en borrador, congela todo salvo status, amount_paid y updated_at. Desde la 068 congela también accounting_date (la fecha de registro). OJO: que T4 deje pasar amount_paid NO significa que se pueda escribir a mano — desde la migración 032 el guard T4b (finanzas_guard_amount_paid) solo se lo permite a T7a.';

-- 4.b T5 — notas de crédito (versión vigente: 060).
CREATE OR REPLACE FUNCTION public.finanzas_credit_note_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- Si CUALQUIER campo no-whitelisted cambió → rechazar.
  -- Whitelist: subtotal_total, tax_total, grand_total, updated_at, las columnas
  -- fiscales (fe_estado, dgi_*, qr_content, ef_invoice_uuid…) y, desde la 060,
  -- la transición de anulación. Desde la 068 `accounting_date` está congelada.
  IF OLD.id                  IS DISTINCT FROM NEW.id
     OR OLD.tenant_id          IS DISTINCT FROM NEW.tenant_id
     OR OLD.credit_note_number IS DISTINCT FROM NEW.credit_note_number
     OR OLD.invoice_id         IS DISTINCT FROM NEW.invoice_id
     OR OLD.client_id          IS DISTINCT FROM NEW.client_id
     OR OLD.issue_date         IS DISTINCT FROM NEW.issue_date
     OR OLD.accounting_date    IS DISTINCT FROM NEW.accounting_date
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
  'Inmutabilidad de la NC. Desde la 060 permite la ÚNICA transición emitida → anulada, y congela cancelled_at / cancellation_reason una vez puestos. Desde la 068 congela accounting_date.';

-- 4.c Gasto de trámite ya asentado (versión vigente: 049).
CREATE OR REPLACE FUNCTION public.reject_expense_mutation_si_asentado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_asiento bigint;
BEGIN
  v_asiento := public.gasto_tramite_tiene_asiento(OLD.id);
  IF v_asiento IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'El gasto % ya está registrado en el libro contable (asiento %) y no se puede borrar. Para corregirlo hace falta un asiento de reversión.',
      OLD.id, v_asiento
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Lo congelado con el gasto ya asentado: lo que el asiento lee, más
  -- payment_account_code (resto de la 036 que NO se escribe: el banco es del
  -- pago) y, desde la 068, la fecha de registro. Editables: comprobante,
  -- posted_entry_id, supplier_id (049), amount_paid y status (derivados, 049).
  IF ROW(
       NEW.case_id, NEW.amount, NEW.concept, NEW.date, NEW.accounting_date, NEW.expense_type,
       NEW.due_date, NEW.payment_account_code, NEW.tenant_id
     ) IS DISTINCT FROM ROW(
       OLD.case_id, OLD.amount, OLD.concept, OLD.date, OLD.accounting_date, OLD.expense_type,
       OLD.due_date, OLD.payment_account_code, OLD.tenant_id
     )
  THEN
    RAISE EXCEPTION
      'El gasto % ya está registrado en el libro contable (asiento %) y no se puede modificar. Solo se admite adjuntar o reemplazar el comprobante y asignar el proveedor. Para corregirlo hace falta un asiento de reversión.',
      OLD.id, v_asiento
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Verificación
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_nulos int;
  v_distintas int;
  v_trg int;
  v_def text;
BEGIN
  SELECT (SELECT count(*) FROM public.invoices WHERE accounting_date IS NULL)
       + (SELECT count(*) FROM public.business_expenses WHERE accounting_date IS NULL)
       + (SELECT count(*) FROM public.expenses WHERE accounting_date IS NULL)
       + (SELECT count(*) FROM public.credit_notes WHERE accounting_date IS NULL)
    INTO v_nulos;
  IF v_nulos > 0 THEN
    RAISE EXCEPTION '068: quedaron % documentos sin fecha de registro', v_nulos;
  END IF;

  -- Hasta hoy la fecha era una sola, así que lo esperado es que coincidan. Si
  -- alguna no coincide NO se aborta: la fecha de registro es la del libro, que
  -- manda. Se informa para que se mire.
  SELECT (SELECT count(*) FROM public.invoices WHERE accounting_date <> issue_date)
       + (SELECT count(*) FROM public.business_expenses WHERE accounting_date <> expense_date)
       + (SELECT count(*) FROM public.expenses WHERE accounting_date <> date)
       + (SELECT count(*) FROM public.credit_notes WHERE accounting_date <> issue_date)
    INTO v_distintas;
  IF v_distintas > 0 THEN
    RAISE NOTICE '068 ⚠️ % documento(s) con fecha de registro (la de su asiento) distinta de la del documento. Listarlos con la consulta del pie.', v_distintas;
  ELSE
    RAISE NOTICE '068 ✅ en todos los documentos la fecha de registro coincide con la del documento';
  END IF;

  SELECT count(*) INTO v_trg FROM pg_trigger
   WHERE NOT tgisinternal AND tgname IN (
     'trg_invoices_fecha_de_registro', 'trg_business_expenses_fecha_de_registro',
     'trg_expenses_fecha_de_registro', 'trg_credit_notes_fecha_de_registro');
  IF v_trg <> 4 THEN
    RAISE EXCEPTION '068: se esperaban 4 triggers de fecha de registro por defecto, hay %', v_trg;
  END IF;

  -- Los updated_at quedaron prendidos (se apagaron sólo para el backfill).
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname IN ('trg_invoices_updated_at', 'trg_credit_notes_updated_at', 'trg_business_expenses_updated_at')
       AND tgenabled = 'D'
  ) THEN
    RAISE EXCEPTION '068: un trigger de updated_at quedó apagado';
  END IF;

  SELECT pg_get_functiondef('public.finanzas_invoice_immutability()'::regprocedure) INTO v_def;
  IF position('OLD.accounting_date IS DISTINCT FROM NEW.accounting_date' IN v_def) = 0 THEN
    RAISE EXCEPTION '068: T4 no congela accounting_date';
  END IF;
  SELECT pg_get_functiondef('public.finanzas_credit_note_immutability()'::regprocedure) INTO v_def;
  IF position('OLD.accounting_date' IN v_def) = 0 THEN
    RAISE EXCEPTION '068: T5 no congela accounting_date';
  END IF;
  SELECT pg_get_functiondef('public.reject_expense_mutation_si_asentado()'::regprocedure) INTO v_def;
  IF position('NEW.accounting_date' IN v_def) = 0 THEN
    RAISE EXCEPTION '068: el trigger del gasto de trámite no congela accounting_date';
  END IF;

  RAISE NOTICE '068 ✅ accounting_date en invoices, business_expenses, expenses y credit_notes; backfill desde el libro; valor por defecto; congelada al emitir o postear';
END $$;

COMMIT;

-- =============================================================================
-- CONSULTA DE DIAGNÓSTICO — documentos cuya fecha de registro (la del asiento)
-- no es la del documento. Cero filas es lo esperado hasta hoy.
-- -----------------------------------------------------------------------------
-- SELECT 'factura' AS tipo, invoice_number AS numero, issue_date AS documento, accounting_date AS registro
--   FROM invoices WHERE accounting_date <> issue_date
-- UNION ALL
-- SELECT 'compra', id::text, expense_date, accounting_date FROM business_expenses WHERE accounting_date <> expense_date
-- UNION ALL
-- SELECT 'gasto de trámite', id::text, date, accounting_date FROM expenses WHERE accounting_date <> date
-- UNION ALL
-- SELECT 'nota de crédito', credit_note_number, issue_date, accounting_date FROM credit_notes WHERE accounting_date <> issue_date
-- ORDER BY 1, 2;
-- =============================================================================
