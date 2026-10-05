-- ============================================================================
-- 094 · Documentos de prueba: la marca vive en el DOCUMENTO, no en el cliente
-- ============================================================================
-- Pedido de Oliver (05/10/2026), sobre docs/finanzas/propuesta-corte-quickbooks.md
-- §9 (ajustada ese día). Resultado de sql/verificacion/produccion-datos-de-prueba.sql:
-- en producción hay clientes y facturas de prueba (CLI-066, CLI-069, CLI-070,
-- 0TEST-FE-001, 0TEST-FE-002 y ocho facturas), pero FAC-HON-000463 es REAL ante
-- la DGI aunque su cliente sea 0TEST-FE-002. Si la marca del cliente bajara sola
-- a sus documentos, la 463 saldría de las ventas y del ITBMS del CRM mientras la
-- DGI la tiene. Por eso:
--
--   · `de_prueba` en cada documento es LO ÚNICO que dice si cuenta. Los reportes
--     (cuando se cableen, §9.4) filtran por esa columna y nada más.
--   · `clients.es_de_prueba` NO se propaga a lo que ya existe: sólo pone el valor
--     inicial de los documentos NUEVOS de ese cliente (nacen de prueba). Los
--     existentes se marcan uno por uno, por número, en el paso del runbook
--     (sql/ventana/marcar-datos-de-prueba.sql). La 463 simplemente no está en la
--     lista: es la excepción explícita, y queda registrada en el motivo del cliente.
--
-- Qué deja:
--   1. clients: es_de_prueba, es_de_prueba_motivo, es_de_prueba_por, es_de_prueba_en.
--   2. invoices, credit_notes, payments, client_payments, expenses: de_prueba y
--      de_prueba_motivo (motivo obligatorio al marcar, 10 caracteres o más).
--   3. Un guard por tabla:
--      · INSERT de un documento de un cliente de prueba → nace de_prueba.
--      · false → true: rechazado si el documento ya tiene asiento en el libro
--        (sacarlo de los reportes dejaría el libro sin documento detrás); una
--        factura, además, si tiene aplicado un cobro que no es de prueba.
--      · true → false: sólo con la llave `finanzas.de_prueba_override` (mismo
--        criterio que SOP-017), y deja un WARNING.
--   4. Lo mismo para desmarcar un cliente.
--
-- Qué NO deja (sigue en la propuesta, §9.3 regla 2 y §9.4): el filtro en ventas,
-- ITBMS, antigüedad, pendientes DGI y listados, y el rechazo en post_journal_entry.
-- Hasta que eso exista la marca no cambia ningún número: sólo los deja marcados.
--
-- Idempotente (IF NOT EXISTS, CREATE OR REPLACE, DROP+CREATE de triggers y CHECK).
-- Va al final del Bloque C, después de la 092. No depende del código de la app.
-- 🛡️ Escrita, SIN APLICAR en staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

-- ── 1. El cliente ──────────────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS es_de_prueba        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS es_de_prueba_motivo text,
  ADD COLUMN IF NOT EXISTS es_de_prueba_por    uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS es_de_prueba_en     timestamptz;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_de_prueba_con_motivo;
ALTER TABLE public.clients ADD CONSTRAINT clients_de_prueba_con_motivo
  CHECK (NOT es_de_prueba
         OR (char_length(btrim(coalesce(es_de_prueba_motivo, ''))) >= 10 AND es_de_prueba_en IS NOT NULL));

COMMENT ON COLUMN public.clients.es_de_prueba IS
  '094. Cliente de prueba: sus documentos NUEVOS nacen de_prueba. NO marca los existentes: la marca que cuenta es la del documento (FAC-HON-000463 es real con cliente de prueba).';

CREATE OR REPLACE FUNCTION public.finanzas_cliente_de_prueba_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.es_de_prueba AND NOT NEW.es_de_prueba THEN
    IF coalesce(current_setting('finanzas.de_prueba_override', true), '') <> 'on' THEN
      RAISE EXCEPTION 'El cliente % está marcado de prueba y no se desmarca sin la llave finanzas.de_prueba_override.', OLD.client_number
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE WARNING 'finanzas.de_prueba_override: se desmarca el cliente de prueba % (%).', OLD.client_number, OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cliente_de_prueba_guard ON public.clients;
CREATE TRIGGER trg_cliente_de_prueba_guard
  BEFORE UPDATE OF es_de_prueba ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_cliente_de_prueba_guard();

-- ── 2. Los documentos ──────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices', 'credit_notes', 'payments', 'client_payments', 'expenses'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS de_prueba boolean NOT NULL DEFAULT false', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS de_prueba_motivo text', t);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_de_prueba_con_motivo');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (NOT de_prueba OR char_length(btrim(coalesce(de_prueba_motivo, %L))) >= 10)',
      t, t || '_de_prueba_con_motivo', '');
    EXECUTE format(
      'COMMENT ON COLUMN public.%I.de_prueba IS %L', t,
      '094. Documento de prueba: no cuenta en libros ni reportes. Es la ÚNICA marca que leen los reportes; se pone documento por documento (nace así si el cliente es de prueba).');
  END LOOP;
END $$;

-- El cliente de un documento: directo, o el del caso (cobro del caso, gasto de trámite).
CREATE OR REPLACE FUNCTION public.finanzas_cliente_del_documento(p_tabla text, p_row jsonb)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
           WHEN p_tabla IN ('client_payments', 'expenses')
             THEN (SELECT k.client_id FROM public.cases k WHERE k.id = (p_row->>'case_id')::uuid)
           ELSE (p_row->>'client_id')::uuid
         END;
$$;

CREATE OR REPLACE FUNCTION public.finanzas_documento_de_prueba_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cliente uuid;
  v_motivo  text;
  v_ref     text;
BEGIN
  v_ref := coalesce(to_jsonb(NEW)->>'invoice_number', to_jsonb(NEW)->>'credit_note_number',
                    to_jsonb(NEW)->>'payment_number', NEW.id::text);

  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.de_prueba THEN
      v_cliente := public.finanzas_cliente_del_documento(TG_TABLE_NAME, to_jsonb(NEW));
      SELECT c.es_de_prueba_motivo INTO v_motivo
        FROM public.clients c WHERE c.id = v_cliente AND c.es_de_prueba;
      IF FOUND THEN
        NEW.de_prueba := true;
        NEW.de_prueba_motivo := left('Cliente de prueba: ' || coalesce(v_motivo, '(sin motivo)'), 1000);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Desmarcar: sólo con la llave.
  IF OLD.de_prueba AND NOT NEW.de_prueba THEN
    IF coalesce(current_setting('finanzas.de_prueba_override', true), '') <> 'on' THEN
      RAISE EXCEPTION 'El documento % (%) está marcado de prueba y no se desmarca sin la llave finanzas.de_prueba_override.', v_ref, TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE WARNING 'finanzas.de_prueba_override: se desmarca el documento de prueba % (%).', v_ref, TG_TABLE_NAME;
    RETURN NEW;
  END IF;

  -- Marcar: nunca un documento con asiento.
  IF NEW.de_prueba AND NOT OLD.de_prueba THEN
    IF EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.tenant_id = NEW.tenant_id AND j.source_id = NEW.id) THEN
      RAISE EXCEPTION 'El documento % (%) tiene asiento en el libro: no se marca de prueba. Corríjalo en el libro (reversión, NC o anulación).', v_ref, TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_TABLE_NAME = 'invoices' AND EXISTS (
         SELECT 1 FROM public.payment_applications pa
           JOIN public.payments p ON p.id = pa.payment_id
          WHERE pa.invoice_id = NEW.id AND NOT p.de_prueba) THEN
      RAISE EXCEPTION 'La factura % tiene aplicado un cobro que no es de prueba: márquelo primero o decida que la factura es real.', v_ref
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices', 'credit_notes', 'payments', 'client_payments', 'expenses'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_documento_de_prueba_guard ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_documento_de_prueba_guard BEFORE INSERT OR UPDATE OF de_prueba ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.finanzas_documento_de_prueba_guard()', t);
  END LOOP;
END $$;

-- ── 3. Post-check ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgname = 'trg_documento_de_prueba_guard' AND NOT tgisinternal;
  IF v_n <> 5 THEN
    RAISE EXCEPTION '094: se esperaban 5 guards de documento de prueba, hay %', v_n;
  END IF;
  RAISE NOTICE '094 ✅ marca de prueba por documento en 5 tablas, cliente con motivo, guards de marcar/desmarcar';
END $$;

COMMIT;

-- Verificación (BEGIN … ROLLBACK): sql/tests/verificacion-094-documentos-de-prueba.sql
-- Paso de datos que la usa: sql/ventana/marcar-datos-de-prueba.sql (runbook ventana-bloque-1.md §2).
