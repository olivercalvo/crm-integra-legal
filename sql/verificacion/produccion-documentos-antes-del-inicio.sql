-- ============================================================================
-- Producción (uqmmkklbhzxqybljiecs) · SOLO LECTURA · la corre Oliver en el SQL Editor
-- ============================================================================
-- ANTES de la ventana del Bloque 1, para la 096 (inicio contable 01/07/2026).
-- Sólo SELECT. Usa sólo columnas que existen hasta la 024 (verificado contra
-- `prod_024`, la base local del ensayo armada desde `main` 24b227a). Una sola
-- sentencia: el SQL Editor muestra sólo el último resultado.
--
-- Excluye los datos de prueba de la lista aprobada el 05/10/2026 (la misma de
-- sql/ventana/marcar-datos-de-prueba.sql): las 8 facturas de la lista y todo lo
-- demás de los 5 clientes de prueba. FAC-HON-000463 es REAL y cuenta.
--
-- Una fila por dato, con `seccion`:
--
--   0  · asientos en el libro hoy. ESPERADO: 0. Es lo que hace que la 096 pase
--        SIN la llave (su pre-flight mira el libro, no los documentos). Si sale
--        > 0: PARAR, la 096 abortaría en la ventana; mandar el resultado.
--   a  · por tabla, documentos REALES con fecha anterior al 01/07/2026 (quedan
--        «contabilizados fuera»), cuántos tienen asiento hoy (ESPERADO 0) y
--        cuántos pasaría al libro la ventana: 0 siempre. Ninguna migración ni
--        paso de la ventana postea documentos que ya existen (revisado: los
--        bloques que nombran post_journal_entry sólo leen su definición).
--   a2 · por tabla, documentos REALES DESDE el 01/07/2026 SIN asiento. Ojo: la
--        ventana TAMPOCO los pasa al libro. Después de la ventana quedan
--        «posteriores al inicio, sin asiento». No es un error de esta consulta:
--        es una decisión pendiente (ver el runbook, §4 punto 9).
--   b  · borradores con fecha anterior al 01/07/2026. ESPERADO: ninguno. Si hay:
--        después de la ventana no se pueden emitir con esa fecha (096). Antes de
--        la ventana, decidir con quien lo cargó: emitirlo ya, cambiarle la fecha
--        o eliminarlo.
--   c  · facturas anteriores al 01/07/2026 con fe_estado 'canceled' (anuladas
--        ante la DGI) y status distinto de 'anulada' en el CRM. ESPERADO: ninguna.
--        Si hay: completar la anulación ANTES de la ventana (después la 096 no
--        deja anular una factura anterior al inicio).
--   d  · cobros DESDE el 01/07/2026 aplicados a facturas ANTERIORES (cobro
--        cruzado), una fila por aplicación y una de total. No hay esperado: es el
--        tamaño de lo que la apertura tiene que dejar en 100004 por cliente para
--        que esos cobros, al registrarse en el libro, no dejen al cliente en
--        negativo.
-- ============================================================================
WITH
corte AS (SELECT DATE '2026-07-01' AS inicio),
clientes_prueba AS (
  SELECT id FROM public.clients
   WHERE client_number IN ('CLI-066', 'CLI-069', 'CLI-070', '0TEST-FE-001', '0TEST-FE-002')
),
facturas AS (
  SELECT i.*
    FROM public.invoices i
   WHERE NOT (coalesce(i.invoice_number, '') = ANY (ARRAY['FAC-HON-000454', 'FAC-REI-000038', 'FAC-HON-000455',
           'FAC-HON-000456', 'FAC-HON-000457', 'FAC-HON-000459', 'FAC-HON-000460', 'FAC-HON-000461']))
),
cobros AS (
  SELECT p.* FROM public.payments p WHERE p.client_id IS NULL OR p.client_id NOT IN (SELECT id FROM clientes_prueba)
),
gastos AS (
  SELECT x.* FROM public.expenses x
   WHERE NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = x.case_id AND c.client_id IN (SELECT id FROM clientes_prueba))
),
notas AS (
  SELECT n.* FROM public.credit_notes n
   WHERE n.client_id NOT IN (SELECT id FROM clientes_prueba)
     AND (n.invoice_id IS NULL OR n.invoice_id IN (SELECT id FROM facturas))
),
cobros_caso AS (
  SELECT cp.* FROM public.client_payments cp
   WHERE NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = cp.case_id AND c.client_id IN (SELECT id FROM clientes_prueba))
),
-- Los documentos con su fecha y si tienen asiento (source_type del libro).
docs AS (
  SELECT 'invoices (facturas y ND emitidas)' AS tabla, f.id, f.issue_date AS fecha, 'factura' AS st
    FROM facturas f WHERE f.status NOT IN ('borrador', 'cancelada_pre_emision')
  UNION ALL SELECT 'credit_notes (NC de venta)', n.id, n.issue_date, 'nota_credito' FROM notas n
  UNION ALL SELECT 'payments (cobros)', p.id, p.payment_date, 'pago' FROM cobros p
  UNION ALL SELECT 'business_expenses (compras)', b.id, b.expense_date, 'gasto' FROM public.business_expenses b
  UNION ALL SELECT 'expenses (gastos de trámite)', x.id, x.date, 'gasto_tramite' FROM gastos x
  UNION ALL SELECT 'client_payments (cobros del caso, Legal: nunca postean)', cp.id, cp.payment_date, '-' FROM cobros_caso cp
),
docs_con_asiento AS (
  SELECT d.*, EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.source_type = d.st AND j.source_id = d.id) AS con_asiento
    FROM docs d
)
-- 0 · el libro hoy
SELECT '0' AS seccion, 'journal_entries' AS tabla, NULL::text AS numero, NULL::date AS fecha, NULL::numeric AS monto,
       (SELECT count(*) FROM public.journal_entries)::int AS cantidad,
       'asientos en el libro hoy · ESPERADO 0 (la 096 pasa sin llave)' AS nota
UNION ALL
-- a · anteriores al inicio, por tabla
SELECT 'a', d.tabla, NULL, NULL, NULL, count(*)::int,
       format('anteriores al 01/07/2026 · con asiento hoy: %s (ESPERADO 0) · los pasa al libro la ventana: 0',
              count(*) FILTER (WHERE d.con_asiento))
  FROM docs_con_asiento d, corte WHERE d.fecha < corte.inicio GROUP BY d.tabla
UNION ALL
-- a2 · desde el inicio, sin asiento, por tabla
SELECT 'a2', d.tabla, NULL, NULL, NULL, count(*)::int,
       'desde el 01/07/2026 y SIN asiento · la ventana tampoco los pasa al libro'
  FROM docs_con_asiento d, corte WHERE d.fecha >= corte.inicio AND NOT d.con_asiento AND d.st <> '-' GROUP BY d.tabla
UNION ALL
-- b · borradores anteriores al inicio
SELECT 'b', 'invoices (borrador)', f.invoice_number, f.issue_date, f.grand_total, NULL,
       'borrador anterior al inicio · ESPERADO ninguno · después de la ventana no se emite con esta fecha'
  FROM facturas f, corte WHERE f.status = 'borrador' AND f.issue_date < corte.inicio
UNION ALL
-- c · anuladas ante la DGI y vivas en el CRM
SELECT 'c', 'invoices (fe_estado canceled)', f.invoice_number, f.issue_date, f.grand_total, NULL,
       format('anulada ante la DGI, status en el CRM: %s · ESPERADO ninguna · completar la anulación ANTES de la ventana', f.status)
  FROM facturas f, corte WHERE f.issue_date < corte.inicio AND f.fe_estado = 'canceled' AND f.status <> 'anulada'
UNION ALL
-- d · cobros cruzados, una fila por aplicación
SELECT 'd', 'cobro ' || coalesce(p.payment_number, p.reference, p.id::text) || ' → ' || f.invoice_number,
       c.client_number, p.payment_date, pa.amount_applied, NULL,
       format('cobro del %s aplicado a la factura del %s (%s)', to_char(p.payment_date, 'DD/MM/YYYY'),
              to_char(f.issue_date, 'DD/MM/YYYY'), c.name)
  FROM public.payment_applications pa
  JOIN cobros p ON p.id = pa.payment_id
  JOIN facturas f ON f.id = pa.invoice_id
  JOIN public.clients c ON c.id = f.client_id, corte
 WHERE p.payment_date >= corte.inicio AND f.issue_date < corte.inicio AND p.status <> 'anulado'
UNION ALL
SELECT 'd', 'TOTAL cobros cruzados', NULL, NULL, coalesce(sum(pa.amount_applied), 0), count(*)::int,
       'lo que la apertura tiene que tener en 100004 (por cliente) para cubrir estos cobros'
  FROM public.payment_applications pa
  JOIN cobros p ON p.id = pa.payment_id
  JOIN facturas f ON f.id = pa.invoice_id, corte
 WHERE p.payment_date >= corte.inicio AND f.issue_date < corte.inicio AND p.status <> 'anulado'
ORDER BY 1, 2, 4;
