-- ============================================================================
-- 047 — RECIBO DE CAJA: numeración REC-000001 para los cobros
-- ============================================================================
-- Hasta hoy `payments.payment_number` existía (migración 20260505000006, TEXT
-- NULL) y NADIE lo escribía. El cobro se registraba desde el detalle de la
-- factura y no tenía documento propio. El Bloque 2 (21/09/2026) lo convierte en
-- un recibo de caja con número correlativo, pantalla y PDF.
--
-- Lo que esta migración deja, en orden:
--
--   1. La secuencia `'payment'` en `numbering_sequences` (CHECK + fila por
--      tenant). El número lo toma la app con `get_next_sequence_number(tenant,
--      'payment')` y lo formatea `REC-` + seis dígitos, igual que las facturas.
--   2. Un índice ÚNICO parcial sobre `(tenant_id, payment_number)`. Parcial
--      porque la columna admite NULL para lo que todavía no está numerado.
--   3. `documents` acepta `entity_type = 'payment'` y `source =
--      'auto_receipt_pdf'`, para que el PDF del recibo se cachee con el mismo
--      patrón que el de la factura (`ensure-invoice-pdf.ts`).
--   4. `backfill_payment_numbers(tenant)`: numera los cobros que no tienen
--      número, en orden `payment_date, created_at, id`, y deja `last_number` en
--      el último asignado. Se corre acá para todos los tenants.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 POR QUÉ SE NUMERAN LOS COBROS VIEJOS (decisión de Oliver, 21/09/2026)
-- ─────────────────────────────────────────────────────────────────────────────
-- Un listado donde unos cobros tienen recibo y otros no es lo primero que el
-- contador va a reportar como error. Todo cobro registrado tiene su recibo,
-- incluidos los anulados y los reversados: existieron, y su número no se reusa.
--
-- El orden es cronológico por FECHA DEL COBRO (`payment_date`) y, a igual fecha,
-- por `created_at` y por `id` como desempate determinista. No es el orden de
-- inserción: un cobro cargado tarde con fecha vieja queda antes en la
-- numeración, que es lo que un correlativo de recibos significa.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 IDEMPOTENCIA, Y DOS CAMINOS PARA LA MISMA REGLA
-- ─────────────────────────────────────────────────────────────────────────────
-- Todo es `IF NOT EXISTS` / `CREATE OR REPLACE` / `ON CONFLICT DO NOTHING`. El
-- backfill numera SOLO los que están en NULL, arrancando de
-- GREATEST(last_number, mayor REC- existente): correr esta migración dos veces
-- da exactamente el mismo resultado, y nunca pisa un número ya asignado.
--
-- La función queda viva porque el seed de staging la necesita: en una base
-- recién reseteada esta migración corre ANTES de que existan cobros
-- (`apply-staging-sql.mjs --reset`), así que `seed-staging.ts` la vuelve a
-- llamar después de sembrar los pagos. Mismo reparto que la 035:
--   · base que YA existe (staging hoy, producción algún día) → esta migración.
--   · base recién armada (`--reset` + seed)                  → el seed la llama.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ LO QUE NO HACE
-- ─────────────────────────────────────────────────────────────────────────────
-- · No toca `post_journal_entry`, `reverse_payment`, `payment_reversals` ni
--   ningún trigger. Ningún trigger de `payments` vigila `payment_number`
--   (T3 es `UPDATE OF status`, el de `amount_unapplied` es `UPDATE OF amount`).
-- · No toca `client_payments` (cobros del caso, módulo Legal). Son otra cosa,
--   a propósito.
-- · No hace atómico el alta del cobro. El número se consume ANTES del INSERT y
--   si el asiento falla queda un hueco, con el mismo criterio de `emitInvoice`.
--   Está escrito en `sop.md` SOP-031 como decisión consciente.
--
-- 📋 Pre-flight contra PRODUCCIÓN, el día que vaya (dos SELECT puros):
--   SELECT COUNT(*) FILTER (WHERE payment_number IS NULL)      AS sin_numero,
--          COUNT(*) FILTER (WHERE payment_number IS NOT NULL)  AS con_numero,
--          COUNT(*) FILTER (WHERE payment_number IS NOT NULL
--                             AND payment_number !~ '^REC-\d{6}$') AS con_otro_formato
--   FROM payments;
--   -- `con_otro_formato` tiene que dar 0. Si no, hay valores heredados que esta
--   -- migración NO renumera (solo numera los NULL) y hay que mirarlos antes.
--   SELECT * FROM numbering_sequences WHERE sequence_type = 'payment';
--   -- Tiene que dar 0 filas (o la fila en 0 si se corrió a medias).
--
-- Verificación: sql/tests/verificacion-047-recibo-de-caja.sql (en ROLLBACK).
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. La secuencia 'payment'
-- ----------------------------------------------------------------------------
-- Los seis valores actuales (021 sumó 'client', 033 sumó 'supplier') más el
-- nuevo. Se re-declara COMPLETO: un CHECK con menos valores rompe el alta de
-- clientes o de proveedores.
ALTER TABLE public.numbering_sequences
  DROP CONSTRAINT IF EXISTS numbering_sequences_sequence_type_check;
ALTER TABLE public.numbering_sequences
  ADD CONSTRAINT numbering_sequences_sequence_type_check
  CHECK (sequence_type = ANY (ARRAY[
    'quote','invoice_hon','invoice_reim','credit_note','client','supplier','payment'
  ]));

INSERT INTO public.numbering_sequences (tenant_id, sequence_type, last_number)
SELECT t.id, 'payment', 0 FROM public.tenants t
ON CONFLICT (tenant_id, sequence_type) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Un número por tenant, cuando lo hay
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS payments_tenant_payment_number_key
  ON public.payments (tenant_id, payment_number)
  WHERE payment_number IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. `documents`: el PDF del recibo
-- ----------------------------------------------------------------------------
-- Los dos CHECK se re-declaran completos, como en la 006 y la 015.
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_entity_type_check;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_entity_type_check
  CHECK (entity_type IN ('client', 'case', 'task', 'comment', 'quote', 'invoice', 'payment'));

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_source_check;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_source_check
  CHECK (source IN (
    'manual',
    'auto_quote_pdf',
    'auto_invoice_pdf',
    'auto_signed_quote_pdf',
    'auto_receipt_pdf'
  ));

-- ----------------------------------------------------------------------------
-- 4. El backfill, como función reutilizable
-- ----------------------------------------------------------------------------
-- Devuelve cuántos cobros numeró. SECURITY DEFINER y EXECUTE solo para
-- service_role, como `reverse_payment`: la llama una migración o el seed, nunca
-- la sesión de un usuario.
CREATE OR REPLACE FUNCTION public.backfill_payment_numbers(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last   integer;
  v_max    integer;
  v_n      integer := 0;
  r        record;
BEGIN
  -- La fila de la secuencia, con candado: nadie toma un número mientras se
  -- numera el histórico.
  INSERT INTO numbering_sequences (tenant_id, sequence_type, last_number)
  VALUES (p_tenant_id, 'payment', 0)
  ON CONFLICT (tenant_id, sequence_type) DO NOTHING;

  SELECT last_number INTO v_last
  FROM   numbering_sequences
  WHERE  tenant_id = p_tenant_id AND sequence_type = 'payment'
  FOR UPDATE;

  -- Nunca por debajo del mayor REC- ya asignado (segunda corrida, o un
  -- last_number que quedó atrás).
  SELECT COALESCE(MAX(substring(payment_number from '^REC-(\d{6})$')::integer), 0)
  INTO   v_max
  FROM   payments
  WHERE  tenant_id = p_tenant_id
    AND  payment_number ~ '^REC-\d{6}$';

  v_last := GREATEST(v_last, v_max);

  FOR r IN
    SELECT id
    FROM   payments
    WHERE  tenant_id = p_tenant_id
      AND  payment_number IS NULL
    ORDER  BY payment_date, created_at, id
  LOOP
    v_last := v_last + 1;
    UPDATE payments
    SET    payment_number = 'REC-' || lpad(v_last::text, 6, '0')
    WHERE  id = r.id;
    v_n := v_n + 1;
  END LOOP;

  UPDATE numbering_sequences
  SET    last_number = v_last,
         updated_at  = now()
  WHERE  tenant_id = p_tenant_id AND sequence_type = 'payment';

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_payment_numbers(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_payment_numbers(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_payment_numbers(uuid) TO service_role;

COMMENT ON FUNCTION public.backfill_payment_numbers(uuid) IS
  'Numera los cobros sin payment_number (REC-000001…) por payment_date, created_at, id '
  'y deja numbering_sequences.last_number en el último asignado. Idempotente. 047.';

-- ----------------------------------------------------------------------------
-- 5. Numerar lo que ya existe, en todos los tenants
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t     record;
  v_n   integer;
BEGIN
  FOR t IN SELECT id, slug FROM public.tenants ORDER BY created_at LOOP
    v_n := public.backfill_payment_numbers(t.id);
    RAISE NOTICE '047: tenant % — % cobros numerados', t.slug, v_n;
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN RÁPIDA (post-aplicación)
-- ============================================================================
-- SELECT sequence_type, last_number FROM numbering_sequences
--  WHERE sequence_type = 'payment';
-- SELECT COUNT(*) FILTER (WHERE payment_number IS NULL) AS sin_numero,
--        MIN(payment_number), MAX(payment_number)
--   FROM payments;
-- -- sin_numero = 0; MAX = 'REC-' || lpad(last_number, 6, '0').
--
-- ROLLBACK (manual, si hiciera falta):
-- UPDATE payments SET payment_number = NULL WHERE payment_number ~ '^REC-\d{6}$';
-- DELETE FROM numbering_sequences WHERE sequence_type = 'payment';
-- DROP FUNCTION IF EXISTS public.backfill_payment_numbers(uuid);
-- DROP INDEX IF EXISTS payments_tenant_payment_number_key;
-- (los CHECK vuelven a su lista anterior re-declarándolos sin 'payment' /
--  'auto_receipt_pdf', ver 033 y 015)
-- ============================================================================
