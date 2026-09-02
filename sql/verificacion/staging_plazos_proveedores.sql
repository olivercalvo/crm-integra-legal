-- ============================================================================
-- SOLO STAGING — cargar plazos de pago de demostración
-- ============================================================================
-- NO es parte de la migración 033 y NO va a producción. La migración deja a
-- todos los proveedores en CONTADO a propósito: no sabemos el plazo real de los
-- que se crearon automáticamente, y suponerlo movería los tramos de la
-- antigüedad sin que nadie lo haya decidido.
--
-- Esto carga plazos plausibles en staging para poder VER el mecanismo
-- funcionando: plazo del proveedor → vencimiento del gasto → tramo del reporte.
--
-- Sobre recalcular los gastos que ya existen: en el producto, cambiar el plazo
-- de un proveedor NO reescribe los vencimientos ya cargados —sería reescribir
-- historia—; el default aplica a los gastos nuevos y cada gasto se edita solo.
-- Acá se recalculan a mano justamente para mostrar el efecto.
-- ============================================================================

BEGIN;

UPDATE suppliers SET payment_terms_days = 30
 WHERE legal_name = 'INMOBILIARIA COSTA DEL ESTE, S.A.';   -- alquiler mensual

UPDATE suppliers SET payment_terms_days = 0
 WHERE legal_name = 'ESTACIÓN DELTA VÍA ESPAÑA';           -- combustible, contado

UPDATE suppliers SET payment_terms_days = 45
 WHERE legal_name = 'DISTRIBUIDORA OFIPLUS, S.A.';         -- insumos a plazo

-- Recalcular el vencimiento de los gastos existentes (solo en staging).
UPDATE business_expenses be
   SET due_date = be.expense_date + s.payment_terms_days
  FROM suppliers s
 WHERE be.supplier_id = s.id;

COMMIT;
