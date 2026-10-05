-- ============================================================================
-- 093 · Una compra nace «pendiente de pago» también en la base
-- ============================================================================
-- Pedido de Oliver (05/10/2026), hallazgo del ensayo de la ventana:
-- `business_expenses.status` tiene DEFAULT 'pagado' desde la 010, y el guard de
-- la 048 (`finanzas_guard_expense_amount_paid`) rechaza en el INSERT todo lo
-- que no sea 'pendiente_pago'. O sea: después de la 048, un INSERT que no
-- nombre `status` falla con «La compra no puede nacer con status = pagado».
--
-- La app ya manda 'pendiente_pago' siempre (createBusinessExpense), y desde el
-- 05/10 la pantalla arranca en «Pendiente de pago» y la API toma un body sin
-- `status` como pendiente (ESTADO_INICIAL_DE_COMPRA). Esto alinea la base: el
-- valor por defecto pasa a ser el único que el guard acepta.
--
-- No toca filas: un DEFAULT sólo cuenta para INSERT nuevos. Idempotente.
-- Va en la ventana JUSTO DESPUÉS de la 048 (Bloque B); antes de la 048 la
-- columna admite 'pagado' sin pago detrás y el cambio no tendría sentido solo.
--
-- 🛡️ Escrita, SIN APLICAR en staging hasta el «aplica» de Oliver.
-- ============================================================================
BEGIN;

ALTER TABLE public.business_expenses ALTER COLUMN status SET DEFAULT 'pendiente_pago';

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.business_expenses'::regclass AND a.attname = 'status';
  IF v_def IS DISTINCT FROM '''pendiente_pago''::text' THEN
    RAISE EXCEPTION '093: el DEFAULT de business_expenses.status quedó en %', v_def;
  END IF;
END $$;

COMMIT;

-- Verificación (BEGIN … ROLLBACK): sql/tests/verificacion-093-compra-nace-pendiente.sql
-- Reversa (no hace falta; sólo si se revierte la 048):
--   ALTER TABLE public.business_expenses ALTER COLUMN status SET DEFAULT 'pagado';
