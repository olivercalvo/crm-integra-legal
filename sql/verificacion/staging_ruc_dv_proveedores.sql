-- SOLO STAGING — RUC y DV de demostración en los proveedores.
-- NO es parte de la migración 033: los proveedores creados automáticamente
-- quedan sin RUC a propósito, porque no lo sabemos. Esto carga valores
-- plausibles para poder verificar que el Excel los saca en columnas separadas.
BEGIN;
UPDATE suppliers SET ruc = '1550231-1-702455', dv = '05'
 WHERE legal_name = 'INMOBILIARIA COSTA DEL ESTE, S.A.';
UPDATE suppliers SET ruc = '8-712-1904', dv = '48'
 WHERE legal_name = 'ESTACIÓN DELTA VÍA ESPAÑA';
UPDATE suppliers SET ruc = '1620884-1-819377', dv = '7'
 WHERE legal_name = 'DISTRIBUIDORA OFIPLUS, S.A.';
COMMIT;

-- ¿En qué cuentas cayeron los gastos? La de combustible es el ejemplo textual
-- que dio Josuarth.
SELECT be.description, be.chart_account_code, a.name AS cuenta, s.legal_name, s.ruc, s.dv
  FROM business_expenses be
  LEFT JOIN chart_of_accounts a ON a.code = be.chart_account_code AND a.tenant_id = be.tenant_id
  LEFT JOIN suppliers s ON s.id = be.supplier_id
 ORDER BY be.expense_date;
