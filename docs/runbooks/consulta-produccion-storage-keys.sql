-- =============================================================================
-- CONSULTA DE SOLO LECTURA PARA EL SQL EDITOR DE PRODUCCIÓN
-- =============================================================================
-- Responde: ¿alguna columna guarda una URL COMPLETA en vez de una key de
-- storage? Si alguna lo hiciera, poner el bucket `documents` en privado
-- rompería esos enlaces.
--
-- CÓMO CORRERLA:
--   Dashboard de Supabase (proyecto de PRODUCCIÓN) → SQL Editor → pegar → Run.
--
-- Es SOLO LECTURA: no modifica ni una fila. Es el único camino permitido para
-- mirar producción desde afuera (ver sop.md SOP-012).
--
-- QUÉ ESPERAR:
--   `urls_completas` debe dar 0 en TODAS las filas.
--
--   Las dos únicas columnas que legítimamente pueden traer una URL son
--   `invoices.dgi_cafe_url` (la URL del CAFE que devuelve la DGI) y
--   `quote_acceptances/quote_rejections.origin_url` (auditoría de desde dónde
--   aceptó el cliente). Ninguna de las dos apunta a nuestro bucket, así que si
--   traen URLs es correcto: están excluidas de la consulta.
-- =============================================================================

SELECT 'documents'          AS tabla, 'storage_key'      AS columna,
       count(*) FILTER (WHERE storage_key IS NOT NULL)         AS con_dato,
       count(*) FILTER (WHERE storage_key ILIKE 'http%')       AS urls_completas,
       max(left(storage_key, 60))                              AS ejemplo
FROM documents
UNION ALL
SELECT 'documents', 'file_path',
       count(*) FILTER (WHERE file_path IS NOT NULL),
       count(*) FILTER (WHERE file_path ILIKE 'http%'),
       max(left(file_path, 60))
FROM documents
UNION ALL
SELECT 'business_expenses', 'receipt_url',
       count(*) FILTER (WHERE receipt_url IS NOT NULL),
       count(*) FILTER (WHERE receipt_url ILIKE 'http%'),
       max(left(receipt_url, 60))
FROM business_expenses
UNION ALL
SELECT 'expenses', 'receipt_url',
       count(*) FILTER (WHERE receipt_url IS NOT NULL),
       count(*) FILTER (WHERE receipt_url ILIKE 'http%'),
       max(left(receipt_url, 60))
FROM expenses
UNION ALL
SELECT 'client_payments', 'receipt_url',
       count(*) FILTER (WHERE receipt_url IS NOT NULL),
       count(*) FILTER (WHERE receipt_url ILIKE 'http%'),
       max(left(receipt_url, 60))
FROM client_payments
UNION ALL
SELECT 'prospect_documents', 'storage_key',
       count(*) FILTER (WHERE storage_key IS NOT NULL),
       count(*) FILTER (WHERE storage_key ILIKE 'http%'),
       max(left(storage_key, 60))
FROM prospect_documents
UNION ALL
SELECT 'todo_documents', 'storage_key',
       count(*) FILTER (WHERE storage_key IS NOT NULL),
       count(*) FILTER (WHERE storage_key ILIKE 'http%'),
       max(left(storage_key, 60))
FROM todo_documents
UNION ALL
SELECT 'invoices', 'cafe_storage_key',
       count(*) FILTER (WHERE cafe_storage_key IS NOT NULL),
       count(*) FILTER (WHERE cafe_storage_key ILIKE 'http%'),
       max(left(cafe_storage_key, 60))
FROM invoices
UNION ALL
SELECT 'invoices', 'xml_storage_key',
       count(*) FILTER (WHERE xml_storage_key IS NOT NULL),
       count(*) FILTER (WHERE xml_storage_key ILIKE 'http%'),
       max(left(xml_storage_key, 60))
FROM invoices
ORDER BY urls_completas DESC, tabla, columna;

-- -----------------------------------------------------------------------------
-- BONUS: estado del bucket y sus políticas en producción
-- -----------------------------------------------------------------------------
SELECT id, name, public FROM storage.buckets;

SELECT policyname, cmd, roles::text
FROM   pg_policies
WHERE  schemaname = 'storage' AND tablename = 'objects'
ORDER  BY policyname;
-- Esperado: las 4 políticas tenant_scoped_*_documents, todas para
-- {authenticated}. Si faltan, privado NO aislaría por tenant.
