-- =============================================================================
-- HOT-FIX QUOTES-FLOW — Borrador transparente al crear cotización
-- Fecha: 2026-05-17
-- Sprint: hot-fix sobre Sprint QUOTES-POLISH (SHA 40575aa en develop)
--
-- Contexto:
--   Hoy crear cotización deja status='borrador', el PDF dice "BORRADOR" y la
--   abogada tiene que dar un 2do click "Enviar" para emitirla. Operativamente
--   las abogadas entregan la cotización en el mismo momento que la guardan,
--   así que el estado intermedio 'borrador' agrega fricción innecesaria.
--
--   Esta migration introduce el estado 'emitida' (nuevo) que es:
--     - número definitivo asignado al crear
--     - editable (líneas y cabecera)
--     - NO enviado por email al cliente todavía
--     - el PDF muestra "EMITIDA" en el badge
--
--   El flujo nuevo:
--     - createQuote → INSERT con status='emitida' (en lugar de 'borrador')
--     - La abogada puede editar mientras esté 'emitida'
--     - Si quiere mandarle el link al cliente: botón Enviar → 'enviada'
--     - Si quiere cancelarla: botón Cancelar → 'cancelada_pre_envio'
--     - No se puede ELIMINAR una 'emitida' (T6 mantiene la restricción)
--
--   'borrador' queda en el CHECK para los 4 registros legacy preexistentes
--   (H2: no se migran). Nuevas cotizaciones no nacen 'borrador' nunca.
--
-- Cambios:
--   1. ALTER quotes_status_check: agregar 'emitida' al conjunto de valores
--   2. UPDATE finanzas_validate_status_transition():
--       - Formalizar quote|borrador → cancelada_pre_envio (deuda técnica:
--         parche manual aplicado en prod, sin estar en el repo)
--       - Formalizar quote|aceptada → convertida (deuda técnica: parche
--         manual aplicado en prod para que convertToInvoices funcione)
--       - Agregar quote|borrador → emitida (defensivo, permite "emitir"
--         un borrador legacy desde la UI si alguien lo necesita)
--       - Agregar quote|emitida → enviada (botón Enviar desde 'emitida')
--       - Agregar quote|emitida → cancelada_pre_envio (botón Cancelar
--         desde 'emitida', escape hatch obligatorio porque NO se puede
--         eliminar una 'emitida')
--   3. UPDATE finanzas_quote_lines_immutability(): permitir
--       INSERT/UPDATE/DELETE de quote_lines cuando el padre está en
--       status IN ('borrador','emitida'). Antes solo permitía 'borrador'.
--   4. NO se toca finanzas_no_delete_protected (T6): emitidas no se
--       eliminan, solo se cancelan (D2 congelada).
--
-- Aplicación:
--   Manual en Supabase SQL Editor (convención del proyecto sql/pending/).
--   Idempotente: usa CREATE OR REPLACE FUNCTION y ALTER ... DROP CONSTRAINT
--   IF EXISTS + ADD CONSTRAINT.
--
-- Reversibilidad:
--   Sí. Bloque ROLLBACK al final restaura la whitelist anterior, restaura
--   el CHECK previo y restaura T5b al chequeo solo 'borrador'. NOTA: si ya
--   hay cotizaciones 'emitida' al revertir, el ALTER CHECK FALLARÁ. En ese
--   caso primero hacer UPDATE quotes SET status='borrador' WHERE
--   status='emitida' (cuidado: vuelve a salir el badge BORRADOR en PDF).
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. ALTER CHECK quotes_status_check: agregar 'emitida'
-- =============================================================================
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE quotes
  ADD CONSTRAINT quotes_status_check
  CHECK (status IN (
    'borrador',
    'emitida',
    'enviada',
    'aceptada',
    'rechazada',
    'expirada',
    'convertida',
    'cancelada_pre_envio'
  ));


-- =============================================================================
-- 2. UPDATE finanzas_validate_status_transition()
-- -----------------------------------------------------------------------------
-- Misma firma y forma que la original (TG_ARGV[0] = entidad). Solo se
-- extiende el CASE de 'quote|*'. Las ramas 'invoice|*' y 'payment|*'
-- quedan idénticas a la versión original del Batch 3e.
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
    -- ---- QUOTES ----
    -- borrador conserva su rol histórico para los 4 registros legacy:
    --   - puede emitirse (defensivo, permite que la UI "emita" un legacy)
    --   - puede enviarse directo (path original pre-hot-fix)
    --   - puede cancelarse pre-envío (formaliza parche manual de prod)
    WHEN 'quote|borrador'              THEN ARRAY['emitida','enviada','cancelada_pre_envio']
    -- emitida es el nuevo estado por defecto post-create:
    --   - puede enviarse al cliente (botón Enviar)
    --   - puede cancelarse pre-envío (escape hatch — no se puede eliminar)
    WHEN 'quote|emitida'               THEN ARRAY['enviada','cancelada_pre_envio']
    WHEN 'quote|enviada'               THEN ARRAY['aceptada','rechazada','expirada']
    -- aceptada → convertida formaliza parche manual de prod (convertToInvoices).
    WHEN 'quote|aceptada'              THEN ARRAY['convertida']
    WHEN 'quote|rechazada'             THEN ARRAY[]::TEXT[]
    WHEN 'quote|expirada'              THEN ARRAY[]::TEXT[]
    WHEN 'quote|convertida'            THEN ARRAY[]::TEXT[]
    WHEN 'quote|cancelada_pre_envio'   THEN ARRAY[]::TEXT[]

    -- ---- INVOICES (sin cambios respecto al Batch 3e) ----
    WHEN 'invoice|borrador'            THEN ARRAY['emitida','cancelada_pre_emision']
    WHEN 'invoice|emitida'             THEN ARRAY['parcialmente_pagada','pagada','anulada']
    WHEN 'invoice|parcialmente_pagada' THEN ARRAY['pagada','anulada','emitida']
    WHEN 'invoice|pagada'              THEN ARRAY['parcialmente_pagada','emitida']
    WHEN 'invoice|anulada'             THEN ARRAY[]::TEXT[]
    WHEN 'invoice|cancelada_pre_emision' THEN ARRAY[]::TEXT[]

    -- ---- PAYMENTS (sin cambios respecto al Batch 3e) ----
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


-- =============================================================================
-- 3. UPDATE finanzas_quote_lines_immutability()
-- -----------------------------------------------------------------------------
-- T5b ahora permite mutar quote_lines mientras el padre esté en
-- ('borrador','emitida'). Antes solo 'borrador'. Esto permite editar líneas
-- de cotizaciones 'emitida' (D1 congelada).
-- =============================================================================
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
    IF v_status NOT IN ('borrador','emitida') THEN
      RAISE EXCEPTION 'no se puede modificar líneas de cotización %, está en estado %',
        v_qnum, v_status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Validar parent viejo en DELETE o UPDATE con parent_id cambiado
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.quote_id IS DISTINCT FROM NEW.quote_id) THEN
    SELECT status, quote_number INTO v_status, v_qnum
    FROM quotes WHERE id = OLD.quote_id;
    IF v_status NOT IN ('borrador','emitida') THEN
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

-- Nota: NO recreamos el trigger porque CREATE OR REPLACE FUNCTION ya
-- actualiza la lógica en su lugar — el trigger existente sigue apuntando
-- a la función con su nuevo cuerpo.

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================

-- 1. Confirmar que 'emitida' está en el CHECK:
-- SELECT pg_get_constraintdef(oid)
-- FROM   pg_constraint
-- WHERE  conrelid='public.quotes'::regclass
--   AND  conname='quotes_status_check';
-- Esperado: ... 'emitida' ... en la lista.

-- 2. Confirmar que el cuerpo de la función incluye 'emitida':
-- SELECT prosrc FROM pg_proc WHERE proname='finanzas_validate_status_transition';
-- Esperado: el CASE incluye quote|emitida y quote|aceptada→convertida.

-- 3. Smoke test create + emitir:
-- INSERT INTO quotes (
--   tenant_id, quote_number, client_id, issue_date, valid_until,
--   title, status, currency
-- ) VALUES (
--   'a0000000-0000-0000-0000-000000000001',
--   'COT-TEST-EMITIDA',
--   '<client_id_valido>',
--   CURRENT_DATE, CURRENT_DATE + 30,
--   'Smoke test emitida', 'emitida', 'USD'
-- );
-- Esperado: INSERT OK.

-- 4. Smoke test inmutabilidad de líneas en 'emitida':
-- INSERT INTO quote_lines (
--   tenant_id, quote_id, line_order, description,
--   quantity, unit_price, tax_code, tax_rate, invoice_kind
-- ) VALUES (
--   'a0000000-0000-0000-0000-000000000001',
--   (SELECT id FROM quotes WHERE quote_number='COT-TEST-EMITIDA'),
--   1, 'Smoke', 1, 100, 'ITBMS_7', 0.07, 'HON'
-- );
-- Esperado: INSERT OK (antes habría fallado con "estado emitida").

-- 5. Smoke test transición emitida → enviada:
-- UPDATE quotes
-- SET    status='enviada', sent_at=NOW(), sent_to_email='test@test.com',
--        public_token='deadbeef'
-- WHERE  quote_number='COT-TEST-EMITIDA';
-- Esperado: UPDATE OK.

-- 6. Cleanup smoke:
-- DELETE FROM quote_lines WHERE quote_id IN (
--   SELECT id FROM quotes WHERE quote_number='COT-TEST-EMITIDA'
-- );
-- Esperado: ERROR (ya está enviada, T5b bloquea).
-- Workaround para cleanup: UPDATE status='borrador' (T1 rechaza enviada→borrador).
-- En realidad para limpiar el smoke hay que borrar el quote con status='borrador'
-- antes de insertarle líneas, o aceptar el residuo.

-- =============================================================================
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- BEGIN;
--
-- -- 1. Restaurar CHECK previo (sin 'emitida'). Si hay cotizaciones con
-- --    status='emitida', primero hacer UPDATE quotes SET status='borrador'
-- --    WHERE status='emitida' (esto re-muestra "BORRADOR" en el PDF — ver
-- --    advertencia en encabezado).
-- ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
-- ALTER TABLE quotes
--   ADD CONSTRAINT quotes_status_check
--   CHECK (status IN (
--     'borrador','enviada','aceptada','rechazada','expirada',
--     'convertida','cancelada_pre_envio'
--   ));
--
-- -- 2. Restaurar finanzas_validate_status_transition() a la versión Batch 3e
-- --    + parches manuales de prod (borrador→cancelada_pre_envio,
-- --    aceptada→convertida). NO al estado pre-hot-fix porque la app de prod
-- --    depende de esos dos parches.
-- CREATE OR REPLACE FUNCTION finanzas_validate_status_transition()
-- RETURNS TRIGGER LANGUAGE plpgsql AS $$
-- DECLARE v_entity TEXT := TG_ARGV[0]; v_allowed TEXT[];
-- BEGIN
--   IF OLD.status = NEW.status THEN RETURN NEW; END IF;
--   v_allowed := CASE v_entity || '|' || OLD.status
--     WHEN 'quote|borrador'  THEN ARRAY['enviada','cancelada_pre_envio']
--     WHEN 'quote|enviada'   THEN ARRAY['aceptada','rechazada','expirada']
--     WHEN 'quote|aceptada'  THEN ARRAY['convertida']
--     WHEN 'quote|rechazada' THEN ARRAY[]::TEXT[]
--     WHEN 'quote|expirada'  THEN ARRAY[]::TEXT[]
--     WHEN 'invoice|borrador'            THEN ARRAY['emitida','cancelada_pre_emision']
--     WHEN 'invoice|emitida'             THEN ARRAY['parcialmente_pagada','pagada','anulada']
--     WHEN 'invoice|parcialmente_pagada' THEN ARRAY['pagada','anulada','emitida']
--     WHEN 'invoice|pagada'              THEN ARRAY['parcialmente_pagada','emitida']
--     WHEN 'invoice|anulada'             THEN ARRAY[]::TEXT[]
--     WHEN 'invoice|cancelada_pre_emision' THEN ARRAY[]::TEXT[]
--     WHEN 'payment|registrado'          THEN ARRAY['conciliado','anulado']
--     WHEN 'payment|conciliado'          THEN ARRAY[]::TEXT[]
--     WHEN 'payment|anulado'             THEN ARRAY[]::TEXT[]
--     ELSE NULL
--   END;
--   IF v_allowed IS NULL THEN
--     RAISE EXCEPTION 'Estado origen desconocido en %: "%"', v_entity, OLD.status
--       USING ERRCODE = 'check_violation';
--   END IF;
--   IF NOT (NEW.status = ANY(v_allowed)) THEN
--     RAISE EXCEPTION 'Transición de status inválida en %: "%" -> "%". Permitidas desde "%": %',
--       v_entity, OLD.status, NEW.status, OLD.status, v_allowed
--       USING ERRCODE = 'check_violation';
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
--
-- -- 3. Restaurar finanzas_quote_lines_immutability() al chequeo solo 'borrador'.
-- CREATE OR REPLACE FUNCTION finanzas_quote_lines_immutability()
-- RETURNS TRIGGER LANGUAGE plpgsql AS $$
-- DECLARE v_status TEXT; v_qnum TEXT;
-- BEGIN
--   IF TG_OP IN ('INSERT','UPDATE') THEN
--     SELECT status, quote_number INTO v_status, v_qnum FROM quotes WHERE id = NEW.quote_id;
--     IF v_status IS DISTINCT FROM 'borrador' THEN
--       RAISE EXCEPTION 'no se puede modificar líneas de cotización %, está en estado %',
--         v_qnum, v_status USING ERRCODE='check_violation';
--     END IF;
--   END IF;
--   IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.quote_id IS DISTINCT FROM NEW.quote_id) THEN
--     SELECT status, quote_number INTO v_status, v_qnum FROM quotes WHERE id = OLD.quote_id;
--     IF v_status IS DISTINCT FROM 'borrador' THEN
--       RAISE EXCEPTION 'no se puede modificar líneas de cotización %, está en estado %',
--         v_qnum, v_status USING ERRCODE='check_violation';
--     END IF;
--   END IF;
--   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
-- END;
-- $$;
--
-- COMMIT;
-- =============================================================================
