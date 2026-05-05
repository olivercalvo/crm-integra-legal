-- =============================================================================
-- FEATURE: Finanzas — triggers de integridad y recálculo
-- Fecha: 2026-05-05
-- Sprint: Fase 1B — Módulo Finanzas (Batch 3e de 6, último de Batch 3)
--
-- Contexto:
--   Reglas de integridad y derivación que enforzan a nivel DB las decisiones
--   D1-D9 que NO se pueden expresar con CHECK constraints (porque dependen
--   de filas externas, valor previo, o contexto de la operación).
--
--   ORDEN DE EJECUCIÓN: este archivo DEBE ejecutarse después de 3a, 3b, 3c
--   y 3d. Crea funciones y triggers que referencian las 8 tablas creadas en
--   los archivos previos.
--
-- Triggers creados (8 lógicos, varios físicos por tabla):
--
--   T1. trg_quote_status_transition           BEFORE UPDATE OF status ON quotes
--   T2. trg_invoice_status_transition         BEFORE UPDATE OF status ON invoices
--   T3. trg_payment_status_transition         BEFORE UPDATE OF status ON payments
--       → todos comparten función finanzas_validate_status_transition().
--
--   T4.  trg_invoice_immutability             BEFORE UPDATE ON invoices
--   T5.  trg_credit_note_immutability         BEFORE UPDATE ON credit_notes
--   T5b. trg_quote_lines_immutability         BEFORE INS/UPD/DEL ON quote_lines
--   T5c. trg_invoice_lines_immutability       BEFORE INS/UPD/DEL ON invoice_lines
--   T5d. trg_credit_note_lines_immutability   BEFORE UPD/DEL ON credit_note_lines
--
--   T6. trg_no_delete_protected               BEFORE DELETE ON quotes/invoices/
--                                                          credit_notes/payments
--       → todos comparten función finanzas_no_delete_protected().
--
--   T7a. trg_recalc_invoice_amount_paid       AFTER INS/UPD/DEL ON payment_applications
--   T7b. trg_recalc_payment_amount_unapplied  AFTER INS/UPD/DEL ON payment_applications
--   T7c. trg_set_initial_payment_unapplied    BEFORE INSERT ON payments
--   T7d. trg_recalc_payment_unapplied_on_amt  BEFORE UPDATE OF amount ON payments
--
--   T8a. trg_recalc_quote_totals              AFTER INS/UPD/DEL ON quote_lines
--   T8b. trg_recalc_invoice_totals            AFTER INS/UPD/DEL ON invoice_lines
--   T8c. trg_recalc_credit_note_totals        AFTER INS/UPD/DEL ON credit_note_lines
--
-- INTERACCIONES IMPORTANTES (ver comentarios inline en cada función):
--
--   * Inmutabilidad de líneas: la enforza DIRECTAMENTE T5b/T5c/T5d con
--     mensajes de error claros ("no se puede modificar líneas de
--     factura X, está en estado Y"). T4 + T8b también la enforzarían
--     transitivamente (T8b UPDATE totals → T4 RAISE), pero los triggers
--     T5b-d hacen fail-fast antes con mejor diagnóstico.
--
--   * T5 (credit_note immutability) es WHITELIST: permite UPDATE solo si
--     los únicos campos modificados son subtotal_total, tax_total,
--     grand_total, updated_at. Cualquier otro cambio → RAISE. Razón: T8c
--     necesita poblar totales durante la creación inicial de una NC en una
--     transacción multi-paso (INSERT credit_notes totales=0 → INSERT
--     credit_note_lines → T8c UPDATE totales).
--
--   * T7a (recalc invoice.amount_paid) UPDATEa amount_paid + transición
--     automática de status, respetando la whitelist extendida de T2:
--       amount_paid = 0          → 'emitida'             (revierte si venía de parc/pagada)
--       0 < amount_paid < grand  → 'parcialmente_pagada'
--       amount_paid >= grand     → 'pagada'
--     Excepciones:
--       - status = 'anulada'                              → no cambia (terminal)
--       - status IN ('borrador','cancelada_pre_emision')  → no cambia (T7a no opina)
--     Las reversiones (parc→emit, pagada→parc, pagada→emit) están
--     explícitas en la whitelist de T2 — soportan casos como cheque que
--     rebota o anulación pre-conciliación.
-- =============================================================================

BEGIN;

-- =============================================================================
-- T1-T3. STATUS TRANSITION VALIDATOR (función compartida)
-- -----------------------------------------------------------------------------
-- Whitelist hardcodeada en plpgsql para mantenerlo en una sola pieza
-- (sin tabla extra system-level). Si en el futuro las transiciones cambian
-- (ej: agregar 'expirada' programática a invoice), se edita esta función.
--
-- TG_ARGV[0] indica la entidad: 'quote' | 'invoice' | 'payment'.
--
-- No-op guard: si OLD.status = NEW.status, return NEW sin validar (evita
-- falsos rechazos cuando un UPDATE incluye status en SET pero con el mismo
-- valor — patrón común en UPDATEs amplios desde la app).
-- =============================================================================
CREATE OR REPLACE FUNCTION finanzas_validate_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_entity  TEXT := TG_ARGV[0];
  v_allowed TEXT[];
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE v_entity || '|' || OLD.status
    WHEN 'quote|borrador'              THEN ARRAY['enviada']
    WHEN 'quote|enviada'               THEN ARRAY['aceptada','rechazada','expirada']
    WHEN 'quote|aceptada'              THEN ARRAY[]::TEXT[]
    WHEN 'quote|rechazada'             THEN ARRAY[]::TEXT[]
    WHEN 'quote|expirada'              THEN ARRAY[]::TEXT[]

    WHEN 'invoice|borrador'            THEN ARRAY['emitida','cancelada_pre_emision']
    WHEN 'invoice|emitida'             THEN ARRAY['parcialmente_pagada','pagada','anulada']
    WHEN 'invoice|parcialmente_pagada' THEN ARRAY['pagada','anulada','emitida']
    WHEN 'invoice|pagada'              THEN ARRAY['parcialmente_pagada','emitida']
    WHEN 'invoice|anulada'             THEN ARRAY[]::TEXT[]
    WHEN 'invoice|cancelada_pre_emision' THEN ARRAY[]::TEXT[]

    WHEN 'payment|registrado'          THEN ARRAY['conciliado','anulado']
    WHEN 'payment|conciliado'          THEN ARRAY[]::TEXT[]
    WHEN 'payment|anulado'             THEN ARRAY[]::TEXT[]

    ELSE NULL
  END;

  IF v_allowed IS NULL THEN
    RAISE EXCEPTION 'Estado origen desconocido en %: "%"',
      v_entity, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (NEW.status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Transición de status inválida en %: "%" -> "%". Permitidas desde "%": %',
      v_entity, OLD.status, NEW.status, OLD.status, v_allowed
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- T1: quotes
DROP TRIGGER IF EXISTS trg_quote_status_transition ON quotes;
CREATE TRIGGER trg_quote_status_transition
  BEFORE UPDATE OF status ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_validate_status_transition('quote');

-- T2: invoices
DROP TRIGGER IF EXISTS trg_invoice_status_transition ON invoices;
CREATE TRIGGER trg_invoice_status_transition
  BEFORE UPDATE OF status ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_validate_status_transition('invoice');

-- T3: payments
DROP TRIGGER IF EXISTS trg_payment_status_transition ON payments;
CREATE TRIGGER trg_payment_status_transition
  BEFORE UPDATE OF status ON payments
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_validate_status_transition('payment');


-- =============================================================================
-- T4. INVOICE IMMUTABILITY
-- -----------------------------------------------------------------------------
-- Si OLD.status NOT IN ('borrador','cancelada_pre_emision'), rechaza
-- cualquier cambio EXCEPTO a:
--   - status        (validado independientemente por T2)
--   - amount_paid   (mantenido por T7a)
--   - updated_at    (mantenido por trg_invoices_updated_at)
--   - balance_due   (GENERATED, recalc automático)
--
-- IS DISTINCT FROM trata NULL = NULL como "iguales" (correcto para esta
-- semántica).
-- =============================================================================
CREATE OR REPLACE FUNCTION finanzas_invoice_immutability()
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

DROP TRIGGER IF EXISTS trg_invoice_immutability ON invoices;
CREATE TRIGGER trg_invoice_immutability
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_invoice_immutability();


-- =============================================================================
-- T5. CREDIT NOTE IMMUTABILITY (whitelist)
-- -----------------------------------------------------------------------------
-- WHITELIST EXPLÍCITA: permite UPDATE solo si los únicos campos modificados
-- son subtotal_total, tax_total, grand_total, updated_at. Cualquier otra
-- modificación a cualquier otro campo (incluyendo id) RAISE EXCEPTION.
--
-- La whitelist permite que T8c pueda poblar los totales durante la creación
-- inicial de la NC en una transacción multi-paso (INSERT credit_notes con
-- totales=0, INSERT credit_note_lines, T8c UPDATE totales). El bloqueo es
-- a TODO lo demás: si en el futuro se agrega un campo a credit_notes, esta
-- función lo rechaza por defecto (más conservador que blacklist).
-- =============================================================================
CREATE OR REPLACE FUNCTION finanzas_credit_note_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Si CUALQUIER campo no-whitelisted cambió → rechazar.
  -- Whitelist: subtotal_total, tax_total, grand_total, updated_at.
  IF OLD.id                  IS DISTINCT FROM NEW.id
     OR OLD.tenant_id          IS DISTINCT FROM NEW.tenant_id
     OR OLD.credit_note_number IS DISTINCT FROM NEW.credit_note_number
     OR OLD.invoice_id         IS DISTINCT FROM NEW.invoice_id
     OR OLD.client_id          IS DISTINCT FROM NEW.client_id
     OR OLD.issue_date         IS DISTINCT FROM NEW.issue_date
     OR OLD.reason             IS DISTINCT FROM NEW.reason
     OR OLD.status             IS DISTINCT FROM NEW.status
     OR OLD.currency           IS DISTINCT FROM NEW.currency
     OR OLD.created_at         IS DISTINCT FROM NEW.created_at
     OR OLD.created_by         IS DISTINCT FROM NEW.created_by
  THEN
    RAISE EXCEPTION 'Nota de crédito % es inmutable: solo se permiten cambios a subtotal_total, tax_total, grand_total y updated_at',
      OLD.credit_note_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_note_immutability ON credit_notes;
CREATE TRIGGER trg_credit_note_immutability
  BEFORE UPDATE ON credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_credit_note_immutability();


-- =============================================================================
-- T5b/T5c/T5d. LINE IMMUTABILITY (3 funciones, 3 triggers)
-- -----------------------------------------------------------------------------
-- Triggers explícitos que protegen las tablas de líneas según el status
-- del documento padre. Reemplazan la "inmutabilidad transitiva" que dependía
-- de T4+T8b: ahora el bloqueo es directo y los mensajes de error son claros
-- ("no se puede modificar líneas de factura X, está en estado Y").
--
-- T5b — quote_lines:
--   BEFORE INSERT/UPDATE/DELETE. Lookup quotes.status; rechaza si
--   status != 'borrador'.
--
-- T5c — invoice_lines:
--   BEFORE INSERT/UPDATE/DELETE. Lookup invoices.status; rechaza si
--   status NOT IN ('borrador', 'cancelada_pre_emision').
--
-- T5d — credit_note_lines:
--   BEFORE UPDATE/DELETE (no INSERT — el INSERT inicial debe permitirse
--   para crear la NC). Rechaza siempre.
--
-- En INSERT/UPDATE el lookup usa NEW.<parent>_id; en DELETE usa OLD.
-- Si UPDATE cambia el parent_id (escenario raro), se valida AMBOS padres
-- — el viejo no debe estar inmutable (no podés "sacar" una línea), el
-- nuevo no debe estar inmutable (no podés "meter" una línea).
-- =============================================================================

-- ---- T5b: quote_lines ----
CREATE OR REPLACE FUNCTION finanzas_quote_lines_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
  v_qnum   TEXT;
BEGIN
  -- Validar parent referenciado por NEW (INSERT/UPDATE)
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status, quote_number INTO v_status, v_qnum
    FROM quotes WHERE id = NEW.quote_id;
    IF v_status IS DISTINCT FROM 'borrador' THEN
      RAISE EXCEPTION 'no se puede modificar líneas de cotización %, está en estado %',
        v_qnum, v_status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Validar parent viejo en DELETE o UPDATE con parent_id cambiado
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.quote_id IS DISTINCT FROM NEW.quote_id) THEN
    SELECT status, quote_number INTO v_status, v_qnum
    FROM quotes WHERE id = OLD.quote_id;
    IF v_status IS DISTINCT FROM 'borrador' THEN
      RAISE EXCEPTION 'no se puede modificar líneas de cotización %, está en estado %',
        v_qnum, v_status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_quote_lines_immutability ON quote_lines;
CREATE TRIGGER trg_quote_lines_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON quote_lines
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_quote_lines_immutability();


-- ---- T5c: invoice_lines ----
CREATE OR REPLACE FUNCTION finanzas_invoice_lines_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
  v_inum   TEXT;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status, invoice_number INTO v_status, v_inum
    FROM invoices WHERE id = NEW.invoice_id;
    IF v_status NOT IN ('borrador', 'cancelada_pre_emision') THEN
      RAISE EXCEPTION 'no se puede modificar líneas de factura %, está en estado %',
        v_inum, v_status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id) THEN
    SELECT status, invoice_number INTO v_status, v_inum
    FROM invoices WHERE id = OLD.invoice_id;
    IF v_status NOT IN ('borrador', 'cancelada_pre_emision') THEN
      RAISE EXCEPTION 'no se puede modificar líneas de factura %, está en estado %',
        v_inum, v_status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_lines_immutability ON invoice_lines;
CREATE TRIGGER trg_invoice_lines_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_invoice_lines_immutability();


-- ---- T5d: credit_note_lines ----
-- Nota: NO incluye INSERT — el INSERT inicial es necesario para crear la NC.
-- Una vez creadas, las líneas son inmutables (sin UPDATE ni DELETE).
CREATE OR REPLACE FUNCTION finanzas_credit_note_lines_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_cnum     TEXT;
  v_cn_id    UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_cn_id := OLD.credit_note_id;
  ELSE  -- UPDATE
    v_cn_id := NEW.credit_note_id;
  END IF;

  SELECT credit_note_number INTO v_cnum
  FROM credit_notes WHERE id = v_cn_id;

  RAISE EXCEPTION 'no se puede modificar líneas de nota de crédito %, está en estado emitida',
    v_cnum
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_note_lines_immutability ON credit_note_lines;
CREATE TRIGGER trg_credit_note_lines_immutability
  BEFORE UPDATE OR DELETE ON credit_note_lines
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_credit_note_lines_immutability();


-- =============================================================================
-- T6. NO DELETE PROTECTED (función compartida en 4 tablas)
-- -----------------------------------------------------------------------------
-- Reglas D8:
--   quotes:       solo borradores se pueden eliminar
--   invoices:     solo borradores se pueden eliminar
--   credit_notes: NUNCA se eliminan
--   payments:     solo si status = 'registrado'
-- =============================================================================
CREATE OR REPLACE FUNCTION finanzas_no_delete_protected()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'quotes' THEN
      IF OLD.status != 'borrador' THEN
        RAISE EXCEPTION 'Cotización % está en status "%": solo se pueden eliminar borradores',
          OLD.quote_number, OLD.status
          USING ERRCODE = 'check_violation';
      END IF;
    WHEN 'invoices' THEN
      IF OLD.status != 'borrador' THEN
        RAISE EXCEPTION 'Factura % está en status "%": solo se pueden eliminar borradores',
          OLD.invoice_number, OLD.status
          USING ERRCODE = 'check_violation';
      END IF;
    WHEN 'credit_notes' THEN
      RAISE EXCEPTION 'Nota de crédito % no puede eliminarse (es irreversible)',
        OLD.credit_note_number
        USING ERRCODE = 'check_violation';
    WHEN 'payments' THEN
      IF OLD.status != 'registrado' THEN
        RAISE EXCEPTION 'Pago en status "%" no puede eliminarse (solo "registrado")',
          OLD.status
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'finanzas_no_delete_protected: tabla "%" no soportada', TG_TABLE_NAME;
  END CASE;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_no_delete_protected ON quotes;
CREATE TRIGGER trg_no_delete_protected
  BEFORE DELETE ON quotes
  FOR EACH ROW EXECUTE FUNCTION finanzas_no_delete_protected();

DROP TRIGGER IF EXISTS trg_no_delete_protected ON invoices;
CREATE TRIGGER trg_no_delete_protected
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION finanzas_no_delete_protected();

DROP TRIGGER IF EXISTS trg_no_delete_protected ON credit_notes;
CREATE TRIGGER trg_no_delete_protected
  BEFORE DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION finanzas_no_delete_protected();

DROP TRIGGER IF EXISTS trg_no_delete_protected ON payments;
CREATE TRIGGER trg_no_delete_protected
  BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION finanzas_no_delete_protected();


-- =============================================================================
-- T7a. RECALC INVOICE.amount_paid + status (con reversión)
-- -----------------------------------------------------------------------------
-- Disparado por cualquier cambio en payment_applications. Recalcula
-- amount_paid de la factura afectada (tras INSERT/UPDATE) o de la previa
-- (tras DELETE). Si invoice_id cambió en un UPDATE, ambas se recalculan.
--
-- Lógica de transición automática (respetando whitelist T2):
--   - status = 'anulada'                             → terminal, NO cambia
--   - status NOT IN ('emitida','parc_pagada','pagada') → NO cambia
--     (borrador, cancelada_pre_emision: T7a no opina)
--   - amount_paid = 0           → status = 'emitida'             (revierte)
--   - 0 < amount_paid < grand   → status = 'parcialmente_pagada'
--   - amount_paid >= grand      → status = 'pagada'
--
-- Casos de reversión (cheque rebota, pago anulado, application borrada):
--   parc_pagada → emitida   (amount_paid baja a 0)
--   pagada → parc_pagada    (amount_paid baja pero >0)
--   pagada → emitida        (amount_paid baja a 0)
-- Estas transiciones están explícitas en la whitelist de T2.
-- =============================================================================
CREATE OR REPLACE FUNCTION finanzas_recalc_one_invoice_amount_paid(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_status      TEXT;
  v_grand       NUMERIC(12,2);
  v_paid        NUMERIC(12,2);
  v_new_status  TEXT;
BEGIN
  SELECT status, grand_total INTO v_status, v_grand
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
    ELSIF v_paid >= v_grand THEN
      v_new_status := 'pagada';
    ELSE
      v_new_status := 'parcialmente_pagada';
    END IF;
  END IF;

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
END;
$$;

CREATE OR REPLACE FUNCTION finanzas_trg_recalc_invoice_amount_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM finanzas_recalc_one_invoice_amount_paid(OLD.invoice_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM finanzas_recalc_one_invoice_amount_paid(OLD.invoice_id);
    PERFORM finanzas_recalc_one_invoice_amount_paid(NEW.invoice_id);
    RETURN NEW;
  ELSE
    PERFORM finanzas_recalc_one_invoice_amount_paid(NEW.invoice_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_invoice_amount_paid ON payment_applications;
CREATE TRIGGER trg_recalc_invoice_amount_paid
  AFTER INSERT OR UPDATE OR DELETE ON payment_applications
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_trg_recalc_invoice_amount_paid();


-- =============================================================================
-- T7b. RECALC PAYMENT.amount_unapplied
-- -----------------------------------------------------------------------------
-- Disparado por cualquier cambio en payment_applications. Recalcula
-- payments.amount_unapplied = payments.amount - SUM(amount_applied).
--
-- IMPLEMENTACIÓN VÍA TRIGGER (no GENERATED column): PostgreSQL no permite
-- subqueries en STORED GENERATED COLUMNS — la expresión debe ser IMMUTABLE
-- y referenciar solo columnas de la misma fila. El trigger es la
-- alternativa estándar.
--
-- Si la sumatoria excede payments.amount, el CHECK constraint
-- payments_amount_unapplied_range_check (>=0) hace fail al UPDATE → la
-- transacción que intentó sobre-aplicar se rollbackea. Esa es la red de
-- seguridad que enforza "no se puede aplicar más de lo que el pago tiene".
-- =============================================================================
CREATE OR REPLACE FUNCTION finanzas_recalc_one_payment_unapplied(p_payment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_amount  NUMERIC(12,2);
  v_applied NUMERIC(12,2);
BEGIN
  SELECT amount INTO v_amount
  FROM payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount_applied), 0) INTO v_applied
  FROM payment_applications
  WHERE payment_id = p_payment_id;

  UPDATE payments
  SET amount_unapplied = v_amount - v_applied
  WHERE id = p_payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION finanzas_trg_recalc_payment_unapplied()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM finanzas_recalc_one_payment_unapplied(OLD.payment_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.payment_id IS DISTINCT FROM NEW.payment_id THEN
    PERFORM finanzas_recalc_one_payment_unapplied(OLD.payment_id);
    PERFORM finanzas_recalc_one_payment_unapplied(NEW.payment_id);
    RETURN NEW;
  ELSE
    PERFORM finanzas_recalc_one_payment_unapplied(NEW.payment_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_payment_amount_unapplied ON payment_applications;
CREATE TRIGGER trg_recalc_payment_amount_unapplied
  AFTER INSERT OR UPDATE OR DELETE ON payment_applications
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_trg_recalc_payment_unapplied();


-- =============================================================================
-- T7c. SET INITIAL PAYMENT.amount_unapplied (BEFORE INSERT)
-- -----------------------------------------------------------------------------
-- Al crear un pago sin aplicaciones aún, amount_unapplied debe igualar a
-- amount. La columna tiene DEFAULT 0; este trigger lo sobreescribe a
-- NEW.amount independiente de lo que pase la app (consistencia).
-- =============================================================================
CREATE OR REPLACE FUNCTION finanzas_set_initial_payment_unapplied()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.amount_unapplied := NEW.amount;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_initial_payment_unapplied ON payments;
CREATE TRIGGER trg_set_initial_payment_unapplied
  BEFORE INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_set_initial_payment_unapplied();


-- =============================================================================
-- T7d. RECALC payment.amount_unapplied cuando cambia amount
-- -----------------------------------------------------------------------------
-- Si la app modifica payments.amount (escenario raro: corrección de monto
-- antes de conciliar), recalcular amount_unapplied. Si la nueva sumatoria
-- de aplicaciones excedería el nuevo amount, el CHECK constraint hace fail.
-- =============================================================================
CREATE OR REPLACE FUNCTION finanzas_recalc_payment_unapplied_on_amount_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_applied NUMERIC(12,2);
BEGIN
  IF NEW.amount IS NOT DISTINCT FROM OLD.amount THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount_applied), 0) INTO v_applied
  FROM payment_applications
  WHERE payment_id = NEW.id;

  NEW.amount_unapplied := NEW.amount - v_applied;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_payment_unapplied_on_amount_change ON payments;
CREATE TRIGGER trg_recalc_payment_unapplied_on_amount_change
  BEFORE UPDATE OF amount ON payments
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_recalc_payment_unapplied_on_amount_change();


-- =============================================================================
-- T8a/T8b/T8c. RECALC PARENT TOTALS desde *_lines
-- -----------------------------------------------------------------------------
-- Tres pares (función helper + trigger function) por simetría — todos hacen
-- lo mismo: SUM de subtotal/tax_amount/line_total → UPDATE en padre.
--
-- IMPORTANTE: el UPDATE en invoices / credit_notes pasa por T4 / T5
-- respectivamente. Si la factura está post-emisión, T4 RAISE → la
-- modificación de líneas se rollbackea (esto es la inmutabilidad
-- transitiva). Para credit_notes, T5 permite updates a totals (excepción
-- intencional, ver comentario en T5).
-- =============================================================================

-- ---- T8a: quote totals ----
CREATE OR REPLACE FUNCTION finanzas_recalc_one_quote_totals(p_quote_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE quotes
  SET subtotal_total = COALESCE((SELECT SUM(subtotal)   FROM quote_lines WHERE quote_id = p_quote_id), 0),
      tax_total      = COALESCE((SELECT SUM(tax_amount) FROM quote_lines WHERE quote_id = p_quote_id), 0),
      grand_total    = COALESCE((SELECT SUM(line_total) FROM quote_lines WHERE quote_id = p_quote_id), 0)
  WHERE id = p_quote_id;
END;
$$;

CREATE OR REPLACE FUNCTION finanzas_trg_recalc_quote_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM finanzas_recalc_one_quote_totals(OLD.quote_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.quote_id IS DISTINCT FROM NEW.quote_id THEN
    PERFORM finanzas_recalc_one_quote_totals(OLD.quote_id);
    PERFORM finanzas_recalc_one_quote_totals(NEW.quote_id);
    RETURN NEW;
  ELSE
    PERFORM finanzas_recalc_one_quote_totals(NEW.quote_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_quote_totals ON quote_lines;
CREATE TRIGGER trg_recalc_quote_totals
  AFTER INSERT OR UPDATE OR DELETE ON quote_lines
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_trg_recalc_quote_totals();


-- ---- T8b: invoice totals ----
CREATE OR REPLACE FUNCTION finanzas_recalc_one_invoice_totals(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE invoices
  SET subtotal_total = COALESCE((SELECT SUM(subtotal)   FROM invoice_lines WHERE invoice_id = p_invoice_id), 0),
      tax_total      = COALESCE((SELECT SUM(tax_amount) FROM invoice_lines WHERE invoice_id = p_invoice_id), 0),
      grand_total    = COALESCE((SELECT SUM(line_total) FROM invoice_lines WHERE invoice_id = p_invoice_id), 0)
  WHERE id = p_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION finanzas_trg_recalc_invoice_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM finanzas_recalc_one_invoice_totals(OLD.invoice_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM finanzas_recalc_one_invoice_totals(OLD.invoice_id);
    PERFORM finanzas_recalc_one_invoice_totals(NEW.invoice_id);
    RETURN NEW;
  ELSE
    PERFORM finanzas_recalc_one_invoice_totals(NEW.invoice_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_invoice_totals ON invoice_lines;
CREATE TRIGGER trg_recalc_invoice_totals
  AFTER INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_trg_recalc_invoice_totals();


-- ---- T8c: credit_note totals ----
CREATE OR REPLACE FUNCTION finanzas_recalc_one_credit_note_totals(p_credit_note_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE credit_notes
  SET subtotal_total = COALESCE((SELECT SUM(subtotal)   FROM credit_note_lines WHERE credit_note_id = p_credit_note_id), 0),
      tax_total      = COALESCE((SELECT SUM(tax_amount) FROM credit_note_lines WHERE credit_note_id = p_credit_note_id), 0),
      grand_total    = COALESCE((SELECT SUM(line_total) FROM credit_note_lines WHERE credit_note_id = p_credit_note_id), 0)
  WHERE id = p_credit_note_id;
END;
$$;

CREATE OR REPLACE FUNCTION finanzas_trg_recalc_credit_note_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM finanzas_recalc_one_credit_note_totals(OLD.credit_note_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.credit_note_id IS DISTINCT FROM NEW.credit_note_id THEN
    PERFORM finanzas_recalc_one_credit_note_totals(OLD.credit_note_id);
    PERFORM finanzas_recalc_one_credit_note_totals(NEW.credit_note_id);
    RETURN NEW;
  ELSE
    PERFORM finanzas_recalc_one_credit_note_totals(NEW.credit_note_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_credit_note_totals ON credit_note_lines;
CREATE TRIGGER trg_recalc_credit_note_totals
  AFTER INSERT OR UPDATE OR DELETE ON credit_note_lines
  FOR EACH ROW
  EXECUTE FUNCTION finanzas_trg_recalc_credit_note_totals();


COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

-- 1. Confirmar que las 19 funciones existen:
SELECT proname
FROM   pg_proc
WHERE  proname IN (
  'finanzas_validate_status_transition',
  'finanzas_invoice_immutability',
  'finanzas_credit_note_immutability',
  'finanzas_quote_lines_immutability',
  'finanzas_invoice_lines_immutability',
  'finanzas_credit_note_lines_immutability',
  'finanzas_no_delete_protected',
  'finanzas_recalc_one_invoice_amount_paid',
  'finanzas_trg_recalc_invoice_amount_paid',
  'finanzas_recalc_one_payment_unapplied',
  'finanzas_trg_recalc_payment_unapplied',
  'finanzas_set_initial_payment_unapplied',
  'finanzas_recalc_payment_unapplied_on_amount_change',
  'finanzas_recalc_one_quote_totals',
  'finanzas_trg_recalc_quote_totals',
  'finanzas_recalc_one_invoice_totals',
  'finanzas_trg_recalc_invoice_totals',
  'finanzas_recalc_one_credit_note_totals',
  'finanzas_trg_recalc_credit_note_totals'
)
ORDER BY proname;
-- Esperado: 19 filas (todas las funciones helper + trigger functions).

-- 2. Confirmar que los triggers están aplicados:
SELECT event_object_table AS tbl, trigger_name, event_manipulation AS evt, action_timing AS timing
FROM   information_schema.triggers
WHERE  trigger_schema = 'public'
  AND  trigger_name LIKE 'trg_%'
  AND  event_object_table IN
       ('quotes','quote_lines','invoices','invoice_lines',
        'credit_notes','credit_note_lines','payments','payment_applications')
ORDER BY tbl, trigger_name, evt;
-- Esperado: ~20 filas (incluyendo updated_at triggers de 3a-3d + los nuevos).

-- 3. Smoke test de status transition (descomentar para correr; requiere
--    un quote existente con status='borrador'):
-- UPDATE quotes SET status = 'aceptada' WHERE status = 'borrador' AND id = '<id>';
-- Esperado: ERROR transición inválida (borrador→aceptada no permitida; debe ser borrador→enviada).

-- 4. Smoke test de no_delete:
-- DELETE FROM credit_notes LIMIT 1;
-- Esperado (si hay alguna): ERROR "Nota de crédito X no puede eliminarse".

-- =============================================================================
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- BEGIN;
--
-- -- Triggers
-- DROP TRIGGER IF EXISTS trg_recalc_credit_note_totals ON credit_note_lines;
-- DROP TRIGGER IF EXISTS trg_recalc_invoice_totals ON invoice_lines;
-- DROP TRIGGER IF EXISTS trg_recalc_quote_totals ON quote_lines;
-- DROP TRIGGER IF EXISTS trg_recalc_payment_unapplied_on_amount_change ON payments;
-- DROP TRIGGER IF EXISTS trg_set_initial_payment_unapplied ON payments;
-- DROP TRIGGER IF EXISTS trg_recalc_payment_amount_unapplied ON payment_applications;
-- DROP TRIGGER IF EXISTS trg_recalc_invoice_amount_paid ON payment_applications;
-- DROP TRIGGER IF EXISTS trg_no_delete_protected ON payments;
-- DROP TRIGGER IF EXISTS trg_no_delete_protected ON credit_notes;
-- DROP TRIGGER IF EXISTS trg_no_delete_protected ON invoices;
-- DROP TRIGGER IF EXISTS trg_no_delete_protected ON quotes;
-- DROP TRIGGER IF EXISTS trg_credit_note_lines_immutability ON credit_note_lines;
-- DROP TRIGGER IF EXISTS trg_invoice_lines_immutability ON invoice_lines;
-- DROP TRIGGER IF EXISTS trg_quote_lines_immutability ON quote_lines;
-- DROP TRIGGER IF EXISTS trg_credit_note_immutability ON credit_notes;
-- DROP TRIGGER IF EXISTS trg_invoice_immutability ON invoices;
-- DROP TRIGGER IF EXISTS trg_payment_status_transition ON payments;
-- DROP TRIGGER IF EXISTS trg_invoice_status_transition ON invoices;
-- DROP TRIGGER IF EXISTS trg_quote_status_transition ON quotes;
--
-- -- Funciones
-- DROP FUNCTION IF EXISTS finanzas_trg_recalc_credit_note_totals();
-- DROP FUNCTION IF EXISTS finanzas_recalc_one_credit_note_totals(UUID);
-- DROP FUNCTION IF EXISTS finanzas_trg_recalc_invoice_totals();
-- DROP FUNCTION IF EXISTS finanzas_recalc_one_invoice_totals(UUID);
-- DROP FUNCTION IF EXISTS finanzas_trg_recalc_quote_totals();
-- DROP FUNCTION IF EXISTS finanzas_recalc_one_quote_totals(UUID);
-- DROP FUNCTION IF EXISTS finanzas_recalc_payment_unapplied_on_amount_change();
-- DROP FUNCTION IF EXISTS finanzas_set_initial_payment_unapplied();
-- DROP FUNCTION IF EXISTS finanzas_trg_recalc_payment_unapplied();
-- DROP FUNCTION IF EXISTS finanzas_recalc_one_payment_unapplied(UUID);
-- DROP FUNCTION IF EXISTS finanzas_trg_recalc_invoice_amount_paid();
-- DROP FUNCTION IF EXISTS finanzas_recalc_one_invoice_amount_paid(UUID);
-- DROP FUNCTION IF EXISTS finanzas_no_delete_protected();
-- DROP FUNCTION IF EXISTS finanzas_credit_note_lines_immutability();
-- DROP FUNCTION IF EXISTS finanzas_invoice_lines_immutability();
-- DROP FUNCTION IF EXISTS finanzas_quote_lines_immutability();
-- DROP FUNCTION IF EXISTS finanzas_credit_note_immutability();
-- DROP FUNCTION IF EXISTS finanzas_invoice_immutability();
-- DROP FUNCTION IF EXISTS finanzas_validate_status_transition();
--
-- COMMIT;
-- =============================================================================
