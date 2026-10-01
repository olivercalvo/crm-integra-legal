-- ============================================================================
-- 070 — NÚMERO DE FACTURA DEL PROVEEDOR EN EL GASTO DE TRÁMITE (Bloque 1, E2)
-- ============================================================================
-- 30/09/2026. Plan: `docs/finanzas/plan-bloque1.md`, punto 3.
--
-- Josuarth (revisión del 28/09, punto 3): "guardar y mostrar el número de
-- factura del proveedor". Las COMPRAS lo tienen desde la `044`
-- (`business_expenses.supplier_invoice_number`); el GASTO DE TRÁMITE, que
-- también es una factura de un proveedor y también acredita 200001, no tenía
-- dónde guardarlo. Es la misma columna, con las mismas reglas que la 044:
--   · Opcional: hay desembolsos sin factura numerada (timbres, recibos).
--   · Sólo el LARGO (1..50), nunca el formato: en Panamá conviven numeraciones
--     de facturación electrónica, talonarios y recibos con serie propia.
--   · Sin UNIQUE: dos proveedores pueden repetir número, y sin proveedor no hay
--     con qué cruzarlo. Si Josuarth pide que sea único por proveedor (P-3b del
--     plan), va en otra migración.
--
-- ⚠️ NO SE CONGELA AL POSTEAR, a propósito. Hoy el número no entra al asiento:
--    es un dato del documento, como el comprobante adjunto, y el trigger de la
--    `049` deja editar lo que el asiento no lee. Cuando E3 lo lleve al libro
--    (`referencia_externa`), esa misma entrega lo agrega a la lista congelada.
--    Congelarlo hoy dejaría sin forma de cargarlo a los gastos ya registrados.
--
-- 🔴 NO SE TOCA EL LIBRO. Una columna nullable nueva: cero filas del ledger.
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS; el CHECK y el índice se crean sólo si faltan.
-- 🛑 SOLO STAGING hasta la ventana del despliegue. Va después de la `069`.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.expenses') IS NULL THEN
    RAISE EXCEPTION '070: no existe public.expenses.';
  END IF;
END $$;

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS supplier_invoice_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.expenses'::regclass
       AND conname  = 'expenses_supplier_invoice_number_length_check'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_supplier_invoice_number_length_check
      CHECK (
        supplier_invoice_number IS NULL
        OR (char_length(supplier_invoice_number) BETWEEN 1 AND 50)
      );
  END IF;
END $$;

-- Lo que alguien tipea cuando concilia contra el estado de cuenta del proveedor.
CREATE INDEX IF NOT EXISTS idx_expenses_supplier_invoice_number
  ON public.expenses (tenant_id, supplier_invoice_number)
  WHERE supplier_invoice_number IS NOT NULL;

COMMENT ON COLUMN public.expenses.supplier_invoice_number IS
  'Número de la factura del proveedor que respalda el gasto de trámite. Opcional, 1..50, sin UNIQUE: mismas reglas que business_expenses.supplier_invoice_number (044). No congelado al postear: no entra al asiento (ver la 070). E2, Bloque 1.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expenses'
       AND column_name = 'supplier_invoice_number' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION '070: la columna no quedó como se esperaba';
  END IF;
  RAISE NOTICE '070 ✅ expenses.supplier_invoice_number (opcional, 1..50, con índice de búsqueda)';
END $$;

COMMIT;
