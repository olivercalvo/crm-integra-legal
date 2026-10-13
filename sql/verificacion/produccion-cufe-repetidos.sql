-- ============================================================================
-- Producción (uqmmkklbhzxqybljiecs) · SOLO LECTURA · la corre Oliver en el SQL Editor
-- ============================================================================
-- Antes de cualquier ventana que lleve la 092 (factura emitida fuera).
--
-- La 092 crea el índice único `invoices_cufe_unico` sobre
-- (tenant_id, upper(btrim(dgi_cufe))). Si producción tiene hoy el MISMO CUFE en
-- dos facturas, el pre-flight de la 092 aborta la migración (y con ella la
-- ventana). Esta consulta lo dice antes.
--
-- Resultado VACÍO = la 092 entra. Cada fila es un CUFE que aparece en más de una
-- factura, con las facturas que lo tienen:
--   rompe_el_indice = sí  → misma clave que el índice: la 092 aborta. Hay que
--                           decidir cuál factura conserva el CUFE ANTES de la ventana.
--   rompe_el_indice = no  → sólo coinciden quitando espacios INTERNOS. No rompe el
--                           índice, pero el RPC normaliza así: es el mismo documento
--                           dos veces. Informativo; revisarlo igual.
--
-- Sólo columnas que producción ya tiene (invoices.dgi_cufe es de B4). No usa
-- dgi_cufe_origen (061) ni el CUFE de las notas de crédito (051): van en la ventana.
-- ============================================================================
WITH f AS (
  SELECT
    i.tenant_id,
    i.invoice_number,
    i.status,
    i.fe_estado,
    i.issue_date,
    i.grand_total,
    upper(btrim(i.dgi_cufe))                           AS clave_indice,
    upper(regexp_replace(i.dgi_cufe, '\s', '', 'g'))   AS clave_sin_espacios
  FROM public.invoices i
  WHERE i.dgi_cufe IS NOT NULL
    AND btrim(i.dgi_cufe) <> ''
),
por_indice AS (
  SELECT tenant_id, clave_indice AS cufe, 'sí' AS rompe_el_indice,
         count(*) AS facturas,
         string_agg(format('%s (%s, %s, %s, %s)', invoice_number, status, fe_estado,
                           to_char(issue_date, 'DD/MM/YYYY'), grand_total),
                    '; ' ORDER BY invoice_number) AS detalle
    FROM f
   GROUP BY tenant_id, clave_indice
  HAVING count(*) > 1
),
sin_espacios AS (
  SELECT tenant_id, clave_sin_espacios AS cufe, 'no' AS rompe_el_indice,
         count(*) AS facturas,
         string_agg(format('%s (%s, %s, %s, %s)', invoice_number, status, fe_estado,
                           to_char(issue_date, 'DD/MM/YYYY'), grand_total),
                    '; ' ORDER BY invoice_number) AS detalle
    FROM f
   GROUP BY tenant_id, clave_sin_espacios
  HAVING count(*) > 1
     AND count(DISTINCT clave_indice) > 1
)
SELECT * FROM por_indice
UNION ALL
SELECT * FROM sin_espacios
ORDER BY rompe_el_indice DESC, cufe;
