-- ============================================================================
-- Producción (uqmmkklbhzxqybljiecs) · SOLO LECTURA · la corre Oliver en el SQL Editor
-- ============================================================================
-- El detalle de los 5 borradores que salieron en la sección b de
-- produccion-documentos-antes-del-inicio.sql (07/10/2026), para decidir con
-- quien los cargó qué se hace con cada uno ANTES de la ventana (después, la 096
-- no deja emitirlos con una fecha anterior al inicio contable):
--   DRAFT-c4521fe4b503, DRAFT-0b8e6f42c4a4, DRAFT-4ee2dc819140,
--   DRAFT-2202765ef7bf (29/05, 107.00) y DRAFT-cb03c1386ba0 (25/06, 6741.66).
--
-- Sólo SELECT. Columnas que existen hasta la 024 (verificado contra `prod_024`,
-- la base local del ensayo). Una sola sentencia.
--
-- Una fila por dato, en orden: el borrador (cliente con número y nombre, quién
-- lo creó, cuándo, fecha, total), sus líneas (descripción y monto) y todo lo
-- que cuelga de él: notas de crédito, aplicaciones de cobro, intentos ante la
-- DGI (fe_emisiones), archivos adjuntos (documents) y la cotización de la que
-- salió. Un borrador sin nada colgado dice «nada colgado».
-- ============================================================================
WITH
lista(numero) AS (VALUES ('DRAFT-c4521fe4b503'), ('DRAFT-0b8e6f42c4a4'), ('DRAFT-4ee2dc819140'),
                         ('DRAFT-2202765ef7bf'), ('DRAFT-cb03c1386ba0')),
b AS (
  SELECT i.*, c.client_number, c.name AS cliente, u.full_name AS creador, u.email AS creador_email
    FROM public.invoices i
    JOIN lista l ON l.numero = i.invoice_number
    LEFT JOIN public.clients c ON c.id = i.client_id
    LEFT JOIN public.users u ON u.id = i.created_by
),
colgado AS (
  SELECT n.invoice_id AS id, 'nota de crédito ' || n.credit_note_number || ' (' || n.status || ')' AS que, n.grand_total AS monto
    FROM public.credit_notes n WHERE n.invoice_id IN (SELECT id FROM b)
  UNION ALL
  SELECT pa.invoice_id, 'aplicación de cobro ' || coalesce(p.payment_number, p.reference, p.id::text) || ' (' || p.status || ')', pa.amount_applied
    FROM public.payment_applications pa JOIN public.payments p ON p.id = pa.payment_id
   WHERE pa.invoice_id IN (SELECT id FROM b)
  UNION ALL
  SELECT e.invoice_id, 'intento ante la DGI del ' || to_char(e.created_at AT TIME ZONE 'America/Panama', 'DD/MM/YYYY HH24:MI'), NULL
    FROM public.fe_emisiones e WHERE e.invoice_id IN (SELECT id FROM b)
  UNION ALL
  SELECT d.entity_id, 'archivo adjunto ' || d.file_name || coalesce(' (' || d.source || ')', ''), NULL
    FROM public.documents d WHERE d.entity_type = 'invoice' AND d.entity_id IN (SELECT id FROM b)
  UNION ALL
  SELECT b.id, 'sale de la cotización ' || q.quote_number || ' (' || q.status || ')', q.grand_total
    FROM b JOIN public.quotes q ON q.id = b.quote_id
  UNION ALL
  SELECT b.id, 'convertido desde la cotización ' || q.quote_number, q.grand_total
    FROM b JOIN public.quotes q ON b.id = ANY (q.converted_invoice_ids) AND q.id IS DISTINCT FROM b.quote_id
)
SELECT b.invoice_number AS borrador, 1 AS orden, 'borrador' AS que,
       concat_ws(' · ',
         coalesce(b.client_number || ' ' || b.cliente, 'sin cliente'),
         'creado por ' || coalesce(b.creador || ' <' || b.creador_email || '>', 'desconocido'),
         'el ' || to_char(b.created_at AT TIME ZONE 'America/Panama', 'DD/MM/YYYY HH24:MI'),
         'fecha del documento ' || to_char(b.issue_date, 'DD/MM/YYYY'),
         b.invoice_kind, 'status ' || b.status,
         'actualizado el ' || to_char(b.updated_at AT TIME ZONE 'America/Panama', 'DD/MM/YYYY HH24:MI')) AS detalle,
       b.grand_total AS monto
  FROM b
UNION ALL
SELECT b.invoice_number, 2, 'línea ' || l.line_order,
       concat_ws(' · ', l.description, l.quantity || ' x ' || l.unit_price, coalesce('impuesto ' || l.tax_code, NULL)),
       l.line_total
  FROM b JOIN public.invoice_lines l ON l.invoice_id = b.id
UNION ALL
SELECT b.invoice_number, 3, 'colgado', c.que, c.monto
  FROM b JOIN colgado c ON c.id = b.id
UNION ALL
SELECT b.invoice_number, 3, 'colgado', 'nada colgado', NULL
  FROM b WHERE NOT EXISTS (SELECT 1 FROM colgado c WHERE c.id = b.id)
UNION ALL
SELECT l.numero, 0, 'NO EXISTE', 'el número no está en invoices', NULL
  FROM lista l WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.invoice_number = l.numero)
ORDER BY 1, 2, 3;
