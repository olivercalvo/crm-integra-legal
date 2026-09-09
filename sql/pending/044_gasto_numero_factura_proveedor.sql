-- ============================================================================
-- 044 — NÚMERO DE FACTURA DEL PROVEEDOR EN LA COMPRA
-- ============================================================================
--
-- Reunión del 09/09/2026 con RM. Una compra del bufete tiene que poder decir
-- QUÉ factura del proveedor la respalda. Hasta hoy el encabezado guardaba el
-- proveedor, la fecha y el vencimiento, pero no el número del comprobante —y sin
-- eso, para conciliar contra el estado de cuenta del proveedor o para armar el
-- anexo de compras de la DGI, hay que abrir el PDF adjunto de a uno.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ ES OPCIONAL
-- ─────────────────────────────────────────────────────────────────────────────
-- No todo desembolso del bufete viene con una factura numerada: hay recibos,
-- vales de caja chica y comprobantes de servicios que traen otro identificador.
-- Hacerla obligatoria dejaría esos gastos sin poder cargarse, que es peor que
-- tenerlos sin número.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ **NO** LLEVA UNIQUE (todavía)
-- ─────────────────────────────────────────────────────────────────────────────
-- Cargar dos veces la misma factura de un proveedor es un error contable real:
-- duplica el gasto y duplica el crédito de ITBMS. Un índice único parcial sobre
-- `(tenant_id, supplier_id, supplier_invoice_number)` lo impediría.
--
-- No se agrega acá a propósito, por dos motivos concretos:
--   1. No cubriría el caso `supplier_id IS NULL`, que sigue siendo válido — o
--      sea que daría una sensación de garantía que no es completa.
--   2. Un 23505 sin traducir en `createBusinessExpense` le llegaría a la persona
--      como un error de base de datos crudo, que es exactamente lo que pasó el
--      09/09 con el CHECK de la `040` («Failing row contains…»).
--
-- Es una mejora con su propio commit: índice + mensaje en español + decisión de
-- qué hacer con las compras sin proveedor. Queda anotada, no escondida.
--
-- ⚠️ NO se toca `business_expenses_cuenta_vive_en_la_linea`: la cuenta sigue
--    viviendo en la línea. Esta columna es del ENCABEZADO porque el número de
--    factura describe al documento entero, no a un renglón.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.business_expenses') IS NULL THEN
    RAISE EXCEPTION 'No existe `business_expenses`. Esta migración no aplica a esta base.';
  END IF;

  -- ---- 1) La columna -------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'business_expenses'
      AND column_name  = 'supplier_invoice_number'
  ) THEN
    ALTER TABLE business_expenses ADD COLUMN supplier_invoice_number TEXT;
    RAISE NOTICE 'Columna `supplier_invoice_number` agregada.';
  ELSE
    RAISE NOTICE 'Columna `supplier_invoice_number` ya existía; no se toca.';
  END IF;

  -- ---- 2) El largo ---------------------------------------------------------
  -- Sólo el largo, NUNCA el formato. Es el mismo criterio que el RUC de
  -- proveedores (`033`): en Panamá conviven numeraciones de facturación
  -- electrónica, talonarios preimpresos y recibos con serie propia. Un
  -- validador estricto rechazaría comprobantes legítimos y dejaría a alguien
  -- sin poder cargar su gasto.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'business_expenses'::regclass
      AND conname  = 'business_expenses_supplier_invoice_number_length_check'
  ) THEN
    ALTER TABLE business_expenses
      ADD CONSTRAINT business_expenses_supplier_invoice_number_length_check
      CHECK (
        supplier_invoice_number IS NULL
        OR (char_length(supplier_invoice_number) BETWEEN 1 AND 50)
      );
    RAISE NOTICE 'CHECK de largo agregado (1..50).';
  ELSE
    RAISE NOTICE 'CHECK de largo ya existía; no se toca.';
  END IF;

  -- ---- 3) Búsqueda ---------------------------------------------------------
  -- El listado de Gastos del Bufete busca por texto; el número de factura es
  -- justamente lo que alguien tipea cuando concilia contra el proveedor.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_business_expenses_supplier_invoice_number'
  ) THEN
    CREATE INDEX idx_business_expenses_supplier_invoice_number
      ON business_expenses (tenant_id, supplier_invoice_number)
      WHERE supplier_invoice_number IS NOT NULL;
    RAISE NOTICE 'Índice de búsqueda creado.';
  END IF;

  COMMENT ON COLUMN business_expenses.supplier_invoice_number IS
    'Número del comprobante del proveedor que respalda la compra. Opcional: hay '
    'desembolsos sin factura numerada. Sin UNIQUE — ver el encabezado de la 044.';
END $$;
