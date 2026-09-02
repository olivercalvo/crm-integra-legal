-- Inventario de lo que hay hoy en business_expenses, ANTES de crear la entidad
-- proveedor. SOLO LECTURA.

-- 1. El tamaño del problema
SELECT 'total' AS chequeo,
       COUNT(*) AS gastos,
       COUNT(DISTINCT supplier_name) AS nombres_distintos,
       COUNT(*) FILTER (WHERE supplier_name IS NULL OR btrim(supplier_name) = '') AS sin_nombre,
       COUNT(DISTINCT supplier_ruc) AS rucs_distintos,
       COUNT(*) FILTER (WHERE supplier_ruc IS NULL OR btrim(supplier_ruc) = '') AS sin_ruc
  FROM business_expenses;

-- 2. Cada nombre, tal cual está escrito, con sus RUC y su volumen
SELECT 'por nombre' AS chequeo,
       supplier_name,
       COUNT(*) AS gastos,
       SUM(total) AS monto,
       COUNT(DISTINCT COALESCE(supplier_ruc,'∅')) AS rucs,
       string_agg(DISTINCT COALESCE(supplier_ruc,'∅'), ' | ') AS lista_rucs,
       MIN(expense_date) AS desde, MAX(expense_date) AS hasta
  FROM business_expenses
 GROUP BY supplier_name
 ORDER BY COUNT(*) DESC, supplier_name;

-- 3. ¿Dos nombres distintos que sean el MISMO proveedor?
--    Señal A: comparten RUC.
SELECT 'mismo RUC, nombre distinto' AS chequeo,
       supplier_ruc,
       COUNT(DISTINCT supplier_name) AS nombres,
       string_agg(DISTINCT supplier_name, ' || ') AS lista
  FROM business_expenses
 WHERE supplier_ruc IS NOT NULL AND btrim(supplier_ruc) <> ''
 GROUP BY supplier_ruc
HAVING COUNT(DISTINCT supplier_name) > 1;

-- 4. Señal B: el nombre normalizado coincide (sin tildes, sin puntuación,
--    sin sufijos societarios, sin espacios de más).
WITH n AS (
  SELECT supplier_name,
         btrim(regexp_replace(
           regexp_replace(
             lower(translate(supplier_name,
               'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun')),
             '\s*,?\s*(s\.?\s?a\.?|s\.?\s?r\.?\s?l\.?|inc\.?|corp\.?)\s*$', '', 'g'),
           '[^a-z0-9]+', ' ', 'g')) AS clave,
         COUNT(*) AS gastos
    FROM business_expenses
   WHERE supplier_name IS NOT NULL
   GROUP BY supplier_name
)
SELECT 'mismo nombre normalizado' AS chequeo,
       clave, COUNT(*) AS variantes, string_agg(supplier_name, ' || ') AS lista
  FROM n GROUP BY clave HAVING COUNT(*) > 1;

-- 5. Formatos de RUC que hay, para saber qué tiene que aceptar la validación
SELECT 'formatos de RUC' AS chequeo, supplier_ruc, COUNT(*) AS gastos
  FROM business_expenses
 WHERE supplier_ruc IS NOT NULL AND btrim(supplier_ruc) <> ''
 GROUP BY supplier_ruc ORDER BY supplier_ruc;

-- 6. Columnas de business_expenses, para saber contra qué escribo la migración
SELECT 'columnas' AS chequeo, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='business_expenses'
 ORDER BY ordinal_position;
