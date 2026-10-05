-- ============================================================================
-- Producción (uqmmkklbhzxqybljiecs) · SOLO LECTURA · la corre Oliver en el SQL Editor
-- ============================================================================
-- ANTES y DESPUÉS del paso «Marcar los datos de prueba» de la ventana
-- (docs/finanzas/runbooks/ventana-bloque-1.md, §2, después de la 094). La misma
-- consulta sirve hoy (esquema de la 024) y después de la 094: la marca se lee con
-- to_jsonb(fila), así que antes de la 094 la columna `marca_hoy` sale vacía.
--
-- Una fila por cosa de la lista aprobada el 05/10/2026 (resultado de
-- produccion-datos-de-prueba.sql) y por todo lo demás que cuelga de esos clientes:
--   plan = 'marcar de prueba'   → está en la lista; el paso lo marca.
--   plan = 'se queda real'      → excepción explícita (FAC-HON-000463, CLI-026, el
--                                  gasto ADM-001 de 1.00). Tiene que salir SIN marca.
--   plan = 'REVISAR'            → un documento de un cliente de prueba que NO está en
--                                  la lista (un cobro, una NC, otra factura, un gasto
--                                  del caso) u otro cliente 0TEST-*. El paso ABORTA si
--                                  hay alguno: se decide antes y se agrega a la lista.
--   plan = 'NO ENCONTRADO'      → un número de la lista que no existe. El paso aborta.
--
-- ANTES: ninguna fila 'REVISAR' ni 'NO ENCONTRADO', y con_asiento = false en todas
--        las 'marcar de prueba' (un documento con asiento no se marca).
-- DESPUÉS: marca_hoy = true en todas las 'marcar de prueba' y false en todas las
--          'se queda real'.
-- La lista está repetida en sql/ventana/marcar-datos-de-prueba.sql: si cambia una,
-- cambia la otra.
-- ============================================================================
WITH
lista(tabla, referencia, plan) AS (
  VALUES
    ('clients',  'CLI-066',        'marcar de prueba'),
    ('clients',  'CLI-069',        'marcar de prueba'),
    ('clients',  'CLI-070',        'marcar de prueba'),
    ('clients',  '0TEST-FE-001',   'marcar de prueba'),
    ('clients',  '0TEST-FE-002',   'marcar de prueba'),
    ('clients',  'CLI-026',        'se queda real'),
    ('invoices', 'FAC-HON-000454', 'marcar de prueba'),
    ('invoices', 'FAC-REI-000038', 'marcar de prueba'),
    ('invoices', 'FAC-HON-000455', 'marcar de prueba'),
    ('invoices', 'FAC-HON-000456', 'marcar de prueba'),
    ('invoices', 'FAC-HON-000457', 'marcar de prueba'),
    ('invoices', 'FAC-HON-000459', 'marcar de prueba'),
    ('invoices', 'FAC-HON-000460', 'marcar de prueba'),
    ('invoices', 'FAC-HON-000461', 'marcar de prueba'),
    ('invoices', 'FAC-HON-000463', 'se queda real')
),
clientes_prueba AS (
  SELECT c.id FROM public.clients c
    JOIN lista l ON l.tabla = 'clients' AND l.referencia = c.client_number AND l.plan = 'marcar de prueba'
),
asentados AS (
  SELECT DISTINCT j.source_id FROM public.journal_entries j WHERE j.source_id IS NOT NULL
),
filas AS (
  -- Clientes de la lista, y cualquier otro 0TEST-*.
  SELECT 'clients' AS tabla, c.client_number AS referencia, c.name AS cliente,
         coalesce(l.plan, 'REVISAR') AS plan,
         to_jsonb(c)->>'es_de_prueba' AS marca_hoy, c.client_status AS estado,
         NULL::numeric AS monto, c.created_at::date AS fecha, false AS con_asiento, NULL::numeric AS cobrado, c.id
    FROM public.clients c
    LEFT JOIN lista l ON l.tabla = 'clients' AND l.referencia = c.client_number
   WHERE l.referencia IS NOT NULL OR c.client_number ILIKE '0TEST%'

  -- Facturas de la lista, y toda otra factura de un cliente de prueba.
  UNION ALL
  SELECT 'invoices', i.invoice_number, c.client_number,
         coalesce(l.plan, 'REVISAR'),
         to_jsonb(i)->>'de_prueba', i.status || ' · fe ' || i.fe_estado || coalesce(' · amb ' || i.i_amb, ''),
         i.grand_total, i.issue_date, i.id IN (SELECT source_id FROM asentados),
         (SELECT sum(pa.amount_applied) FROM public.payment_applications pa WHERE pa.invoice_id = i.id), i.id
    FROM public.invoices i
    JOIN public.clients c ON c.id = i.client_id
    LEFT JOIN lista l ON l.tabla = 'invoices' AND l.referencia = i.invoice_number
   WHERE l.referencia IS NOT NULL OR i.client_id IN (SELECT id FROM clientes_prueba)

  -- Notas de crédito y cobros de los clientes de prueba (o de sus facturas).
  UNION ALL
  SELECT 'credit_notes', n.credit_note_number, c.client_number, 'REVISAR',
         to_jsonb(n)->>'de_prueba', n.status, n.grand_total, n.issue_date, n.id IN (SELECT source_id FROM asentados), NULL, n.id
    FROM public.credit_notes n JOIN public.clients c ON c.id = n.client_id
   WHERE n.client_id IN (SELECT id FROM clientes_prueba)
  UNION ALL
  SELECT 'payments', coalesce(p.payment_number, p.reference, '(sin número)'), c.client_number, 'REVISAR',
         to_jsonb(p)->>'de_prueba', p.status, p.amount, p.payment_date, p.id IN (SELECT source_id FROM asentados), NULL, p.id
    FROM public.payments p JOIN public.clients c ON c.id = p.client_id
   WHERE p.client_id IN (SELECT id FROM clientes_prueba)

  -- Del caso (Legal): cobros del caso y gastos de trámite. El gasto ADM-001 de
  -- 1.00 es real (05/10) aunque su monto sea de prueba.
  UNION ALL
  SELECT 'client_payments', k.case_code, c.client_number, 'REVISAR',
         to_jsonb(cp)->>'de_prueba', cp.payment_type, cp.amount, cp.payment_date, false, NULL, cp.id
    FROM public.client_payments cp JOIN public.cases k ON k.id = cp.case_id JOIN public.clients c ON c.id = k.client_id
   WHERE k.client_id IN (SELECT id FROM clientes_prueba)
  UNION ALL
  SELECT 'expenses', k.case_code, c.client_number,
         CASE WHEN k.case_code = 'ADM-001' AND x.amount = 1.00 THEN 'se queda real' ELSE 'REVISAR' END,
         to_jsonb(x)->>'de_prueba', x.expense_type, x.amount, x.date, x.id IN (SELECT source_id FROM asentados), NULL, x.id
    FROM public.expenses x JOIN public.cases k ON k.id = x.case_id JOIN public.clients c ON c.id = k.client_id
   WHERE k.client_id IN (SELECT id FROM clientes_prueba)
      OR (k.case_code = 'ADM-001' AND x.amount = 1.00)

  -- Lo que la lista nombra y no existe.
  UNION ALL
  SELECT l.tabla, l.referencia, NULL, 'NO ENCONTRADO', NULL, NULL, NULL, NULL, false, NULL, NULL
    FROM lista l
   WHERE (l.tabla = 'clients'  AND NOT EXISTS (SELECT 1 FROM public.clients  c WHERE c.client_number  = l.referencia))
      OR (l.tabla = 'invoices' AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.invoice_number = l.referencia))
)
SELECT tabla, referencia, cliente, plan, marca_hoy, estado, monto,
       to_char(fecha, 'DD/MM/YYYY') AS fecha, con_asiento, cobrado, id
  FROM filas
 ORDER BY CASE plan WHEN 'NO ENCONTRADO' THEN 0 WHEN 'REVISAR' THEN 1 WHEN 'marcar de prueba' THEN 2 ELSE 3 END,
          tabla, referencia;
