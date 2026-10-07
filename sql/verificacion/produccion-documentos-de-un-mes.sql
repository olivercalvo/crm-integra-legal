-- ============================================================================
-- Producción (uqmmkklbhzxqybljiecs) · SOLO LECTURA · la corre Oliver en el SQL Editor
-- ============================================================================
-- Los documentos de UN MES que el posteo por mes (097) contabilizaría, uno por
-- fila, para revisarlos con Josuarth ANTES de la ventana. Por defecto julio de
-- 2026: para otro mes, cambiar las dos fechas de `mes`.
--
-- NO son los asientos: las cuentas, débitos y créditos los arma la app con los
-- mismos constructores que usa al emitir (no se pueden repetir en SQL sin
-- inventar una segunda fórmula). El Excel en seco con los asientos sale de la
-- pantalla /finanzas/asientos/documentos-existentes DESPUÉS del deploy (es un
-- GET: no escribe nada, y no necesita la 097).
--
-- Sólo SELECT. Usa sólo columnas que existen hasta la 024 (verificado contra
-- `prod_024`, la base local del ensayo). Una sola sentencia.
--
-- Columnas: tipo, numero, fecha, tercero, monto, entra («sí» / «no»), motivo.
--   · Fuera: documentos de prueba (la lista de sql/ventana/marcar-datos-de-prueba.sql;
--     FAC-HON-000463 es REAL y entra), FAC-HON-000496 y FAC-HON-000508 (emitidas
--     sin CUFE ni autorización de la DGI) y lo que cuelga de ellas, las NC de una
--     anulación (su efecto es la anulación de la factura) y los cobros del caso
--     de Legal (client_payments, nunca postean).
--   · «sí, falta …»: entra, pero el mes no se puede contabilizar hasta
--     completarlo en el CRM después de la ventana (gasto de trámite sin
--     proveedor ni cuenta; compra sin ficha de proveedor; cobro sin banco).
-- ============================================================================
WITH
mes AS (SELECT DATE '2026-07-01' AS desde, DATE '2026-07-31' AS hasta),
clientes_prueba AS (
  SELECT id FROM public.clients
   WHERE client_number IN ('CLI-066', 'CLI-069', 'CLI-070', '0TEST-FE-001')  -- 0TEST-FE-002 se queda real (07/10)
),
fac AS (
  SELECT i.*, c.name AS cliente, c.client_number,
         CASE
           WHEN i.invoice_number IN ('FAC-HON-000454', 'FAC-REI-000038', 'FAC-HON-000455', 'FAC-HON-000456',
                                     'FAC-HON-000457', 'FAC-HON-000459', 'FAC-HON-000460', 'FAC-HON-000461')
             THEN 'documento de prueba'
           WHEN i.client_id IN (SELECT id FROM clientes_prueba) THEN 'documento de prueba (cliente de prueba)'
           WHEN i.invoice_number IN ('FAC-HON-000496', 'FAC-HON-000508') THEN 'emitida sin CUFE ni autorización de la DGI: se lista aparte'
         END AS fuera
    FROM public.invoices i JOIN public.clients c ON c.id = i.client_id
   WHERE i.status IN ('emitida', 'parcialmente_pagada', 'pagada', 'anulada')
)
-- Facturas y ND
SELECT 1 AS orden, 'Factura' AS tipo, f.invoice_number AS numero, f.issue_date AS fecha,
       f.cliente || ' (' || f.client_number || ')' AS tercero, f.grand_total AS monto,
       CASE WHEN f.fuera IS NULL THEN 'sí' ELSE 'no' END AS entra,
       coalesce(f.fuera, concat_ws('; ',
         CASE WHEN f.dgi_cufe IS NULL THEN 'sin CUFE en el CRM (entra igual)' END,
         CASE WHEN f.status = 'anulada' THEN 'anulada: también entra su anulación, en el mes de la anulación' END)) AS motivo
  FROM fac f, mes WHERE f.issue_date BETWEEN mes.desde AND mes.hasta
UNION ALL
-- NC de venta
SELECT 2, 'Nota de crédito', n.credit_note_number, n.issue_date, c.name || ' (' || c.client_number || ')', n.grand_total,
       CASE WHEN f.fuera IS NOT NULL OR f.status = 'anulada' OR n.status <> 'emitida' THEN 'no' ELSE 'sí' END,
       CASE
         WHEN f.fuera IS NOT NULL THEN 'su factura no entra: ' || f.fuera
         WHEN f.status = 'anulada' THEN 'NC de una anulación: no tiene asiento propio'
         WHEN n.status <> 'emitida' THEN 'estado ' || n.status
       END
  FROM public.credit_notes n
  JOIN public.clients c ON c.id = n.client_id
  LEFT JOIN fac f ON f.id = n.invoice_id, mes
 WHERE n.issue_date BETWEEN mes.desde AND mes.hasta
UNION ALL
-- Cobros (Finanzas)
SELECT 3, 'Cobro', coalesce(p.payment_number, p.reference), p.payment_date, c.name || ' (' || c.client_number || ')', p.amount,
       CASE WHEN p.status <> 'registrado' OR p.client_id IN (SELECT id FROM clientes_prueba)
              OR EXISTS (SELECT 1 FROM public.payment_applications pa JOIN fac f ON f.id = pa.invoice_id
                          WHERE pa.payment_id = p.id AND f.fuera IS NOT NULL) THEN 'no' ELSE 'sí' END,
       CASE
         WHEN p.status <> 'registrado' THEN 'estado ' || p.status
         WHEN p.client_id IN (SELECT id FROM clientes_prueba) THEN 'documento de prueba (cliente de prueba)'
         WHEN EXISTS (SELECT 1 FROM public.payment_applications pa JOIN fac f ON f.id = pa.invoice_id
                       WHERE pa.payment_id = p.id AND f.fuera IS NOT NULL) THEN 'se aplicó a una factura que no entra'
         ELSE 'falta el banco: se completa en el CRM después de la ventana (la 024 no lo tiene)'
       END
  FROM public.payments p JOIN public.clients c ON c.id = p.client_id, mes
 WHERE p.payment_date BETWEEN mes.desde AND mes.hasta
UNION ALL
-- Compras
SELECT 4, 'Compra', NULL, b.expense_date, b.supplier_name || coalesce(' (RUC ' || b.supplier_ruc || ')', ''), b.total,
       'sí', 'la ventana crea la ficha del proveedor desde el nombre (033): verificar que quedó'
  FROM public.business_expenses b, mes
 WHERE b.expense_date BETWEEN mes.desde AND mes.hasta
UNION ALL
-- Gastos de trámite
SELECT 5, 'Gasto de trámite', NULL, x.date, 'caso ' || coalesce(cs.case_number::text, x.case_id::text) || ': ' || x.concept, x.amount,
       CASE WHEN cs.client_id IN (SELECT id FROM clientes_prueba) THEN 'no' ELSE 'sí' END,
       CASE WHEN cs.client_id IN (SELECT id FROM clientes_prueba) THEN 'documento de prueba (cliente de prueba)'
            ELSE 'falta el proveedor y la cuenta de cada línea: se completan en el CRM después de la ventana' END
  FROM public.expenses x LEFT JOIN public.cases cs ON cs.id = x.case_id, mes
 WHERE x.date BETWEEN mes.desde AND mes.hasta
UNION ALL
-- Cobros del caso (Legal): nunca postean
SELECT 6, 'Cobro del caso (Legal)', NULL, cp.payment_date, NULL, cp.amount, 'no', 'cobro del módulo Legal: nunca entra al libro'
  FROM public.client_payments cp, mes
 WHERE cp.payment_date BETWEEN mes.desde AND mes.hasta
ORDER BY 1, 4, 3;
