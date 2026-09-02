-- ============================================================================
-- VERIFICACIÓN · Antigüedad de Saldos y Estado de Cuenta
-- ============================================================================
-- SOLO LECTURA. Ni un INSERT, ni un UPDATE, ni un DDL.
--
-- Se corre con:   node scripts/run-sql.mjs sql/verificacion/antiguedad_estado_cuenta.sql
-- que aborta si la connection string apunta a producción.
--
-- Replica a mano lo que hacen `antiguedad-source.ts` y `estado-cuenta-source.ts`
-- para poder contrastar la pantalla contra la base sin pasar por la app. Si un
-- número de la pantalla no aparece acá, uno de los dos está mal.
--
-- OJO CON LOS DÍAS: `CURRENT_DATE` corre en UTC y la app cuenta en hora de
-- Panamá (UTC−5), así que después de las 19:00 locales este SQL da UN DÍA MÁS
-- que la pantalla. No cambia el tramo salvo justo en el borde.
-- ============================================================================

-- 1. AUXILIAR POR COBRAR, documento por documento
SELECT 'CxC · detalle' AS bloque,
       i.invoice_number,
       c.name AS cliente,
       i.status,
       i.due_date,
       (CURRENT_DATE - i.due_date) AS dias_vencido,
       CASE
         WHEN (CURRENT_DATE - i.due_date) <= 0  THEN 'corriente'
         WHEN (CURRENT_DATE - i.due_date) <= 30 THEN 'd1_30'
         WHEN (CURRENT_DATE - i.due_date) <= 60 THEN 'd31_60'
         WHEN (CURRENT_DATE - i.due_date) <= 90 THEN 'd61_90'
         ELSE 'd91_mas'
       END AS tramo,
       i.grand_total, i.amount_paid, i.balance_due
  FROM invoices i JOIN clients c ON c.id = i.client_id
 WHERE i.status IN ('emitida','parcialmente_pagada') AND i.balance_due > 0.005
 ORDER BY i.due_date;

-- 2. TODAS las facturas, para probar que el filtro por status no deja nada afuera
--    que sí sea deuda (ni mete nada que no lo sea)
SELECT 'CxC · todas las facturas' AS bloque,
       i.status, COUNT(*) AS cantidad, SUM(i.balance_due) AS suma_balance_due
  FROM invoices i GROUP BY i.status ORDER BY i.status;

-- 3. CUENTA CONTROL 100004
SELECT 'CxC · control' AS bloque, a.code, a.name,
       a.saldo_inicial AS apertura,
       COALESCE(SUM(l.debit - l.credit),0) AS movimiento_ledger,
       a.saldo_inicial + COALESCE(SUM(l.debit - l.credit),0) AS saldo_control
  FROM chart_of_accounts a
  LEFT JOIN journal_entry_lines l ON l.account_id = a.id
 WHERE a.code = '100004' GROUP BY a.code, a.name, a.saldo_inicial;

-- 4. AUXILIAR POR PAGAR
SELECT 'CxP · detalle' AS bloque,
       g.supplier_name, g.description, g.expense_date,
       (CURRENT_DATE - g.expense_date) AS dias_desde_gasto,
       CASE
         WHEN (CURRENT_DATE - g.expense_date) <= 0  THEN 'corriente'
         WHEN (CURRENT_DATE - g.expense_date) <= 30 THEN 'd1_30'
         WHEN (CURRENT_DATE - g.expense_date) <= 60 THEN 'd31_60'
         WHEN (CURRENT_DATE - g.expense_date) <= 90 THEN 'd61_90'
         ELSE 'd91_mas'
       END AS tramo,
       g.total
  FROM business_expenses g
 WHERE g.status = 'pendiente_pago' AND g.total > 0.005
 ORDER BY g.expense_date;

-- 5. CUENTA CONTROL 200001
SELECT 'CxP · control' AS bloque, a.code, a.name,
       a.saldo_inicial AS apertura,
       COALESCE(SUM(l.debit - l.credit),0) AS movimiento_ledger,
       a.saldo_inicial + COALESCE(SUM(l.debit - l.credit),0) AS saldo_control
  FROM chart_of_accounts a
  LEFT JOIN journal_entry_lines l ON l.account_id = a.id
 WHERE a.code = '200001' GROUP BY a.code, a.name, a.saldo_inicial;

-- 6. LO QUE EL LEDGER SÍ REGISTRÓ contra 100004, asiento por asiento.
--    Sirve para explicar la diferencia entre auxiliar y control.
SELECT 'CxC · ledger' AS bloque,
       e.transaction_date, e.entry_number, e.source_type, e.description,
       l.debit, l.credit
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  JOIN chart_of_accounts a ON a.id = l.account_id
 WHERE a.code = '100004'
 ORDER BY e.transaction_date, e.entry_number;

-- ============================================================================
-- CONCILIACIÓN Estado de Cuenta ↔ Antigüedad
-- El saldo final del estado de cuenta de cada tercero tiene que ser su saldo
-- pendiente en la antigüedad. `delta` distinto de 0 es un reporte roto.
-- ============================================================================

WITH facturado AS (
  SELECT i.client_id, SUM(i.grand_total) AS debitos
    FROM invoices i
   WHERE i.status IN ('emitida','parcialmente_pagada','pagada')
   GROUP BY i.client_id
), cobrado AS (
  SELECT i.client_id, COALESCE(SUM(pa.amount_applied),0) AS creditos
    FROM payment_applications pa JOIN invoices i ON i.id = pa.invoice_id
   WHERE i.status IN ('emitida','parcialmente_pagada','pagada')
   GROUP BY i.client_id
), pendiente AS (
  SELECT i.client_id, SUM(i.balance_due) AS auxiliar
    FROM invoices i
   WHERE i.status IN ('emitida','parcialmente_pagada') AND i.balance_due > 0.005
   GROUP BY i.client_id
)
SELECT 'Conciliación · cliente' AS bloque, c.name AS cliente,
       f.debitos, COALESCE(cb.creditos,0) AS creditos,
       f.debitos - COALESCE(cb.creditos,0) AS saldo_estado_cuenta,
       COALESCE(p.auxiliar,0) AS saldo_antiguedad,
       ROUND((f.debitos - COALESCE(cb.creditos,0)) - COALESCE(p.auxiliar,0), 2) AS delta
  FROM facturado f
  JOIN clients c ON c.id = f.client_id
  LEFT JOIN cobrado cb ON cb.client_id = f.client_id
  LEFT JOIN pendiente p ON p.client_id = f.client_id
 ORDER BY c.name;

WITH g AS (
  SELECT supplier_name,
         SUM(total) AS debitos,
         SUM(CASE WHEN payment_date IS NOT NULL THEN total ELSE 0 END) AS creditos,
         SUM(CASE WHEN status='pendiente_pago' AND total > 0.005 THEN total ELSE 0 END) AS auxiliar
    FROM business_expenses GROUP BY supplier_name
)
SELECT 'Conciliación · proveedor' AS bloque, supplier_name, debitos, creditos,
       debitos - creditos AS saldo_estado_cuenta,
       auxiliar AS saldo_antiguedad,
       ROUND((debitos - creditos) - auxiliar, 2) AS delta
  FROM g ORDER BY supplier_name;

-- ============================================================================
-- DE DÓNDE SALE LA DIFERENCIA ENTRE AUXILIAR Y CUENTA CONTROL
-- En cobrar NO es solo el saldo de apertura: falta un asiento de factura y
-- sobra un cobro sin asiento. Estos dos contadores lo cuantifican.
-- ============================================================================

SELECT 'facturas emitidas SIN asiento' AS chequeo, COUNT(*) AS filas,
       COALESCE(SUM(i.balance_due),0) AS monto
  FROM invoices i
 WHERE i.status IN ('emitida','parcialmente_pagada','pagada')
   AND NOT EXISTS (SELECT 1 FROM journal_entries e
                    WHERE e.source_type='factura' AND e.source_id = i.id);

SELECT 'pagos SIN asiento' AS chequeo, COUNT(*) AS filas,
       COALESCE(SUM(p.amount),0) AS monto
  FROM payments p
 WHERE NOT EXISTS (SELECT 1 FROM journal_entries e
                    WHERE e.source_type='pago' AND e.source_id = p.id);

-- Coherencia de los gastos: ningún pendiente con fecha de pago ni al revés.
SELECT 'gastos incoherentes' AS chequeo, COUNT(*) AS filas
  FROM business_expenses
 WHERE (status = 'pendiente_pago' AND payment_date IS NOT NULL)
    OR (status <> 'pendiente_pago' AND payment_date IS NULL);

-- El guard T4b sigue en pie: amount_paid = lo aplicado, sin excepción.
SELECT 'facturas con amount_paid desfasado' AS chequeo, COUNT(*) AS filas FROM (
  SELECT i.id FROM invoices i LEFT JOIN payment_applications pa ON pa.invoice_id = i.id
   GROUP BY i.id, i.amount_paid
  HAVING ROUND(i.amount_paid - COALESCE(SUM(pa.amount_applied),0), 2) <> 0
) q;
