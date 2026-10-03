-- ============================================================================
-- Producción (uqmmkklbhzxqybljiecs) · SOLO LECTURA · la corre Oliver en el SQL Editor
-- ============================================================================
-- Por mes (fecha del documento, issue_date), desde marzo de 2026: cuántas facturas
-- del CRM hay, cuántas existen ante la DGI (con CUFE o autorizadas) y cuántas no,
-- con el monto de cada grupo.
--
-- Columnas usadas y de dónde salen (todas anteriores a la 025, que producción no tiene):
--   invoices.issue_date, status, grand_total, invoice_kind   (B3b, 20260505000004)
--   invoices.dgi_cufe                                         (B4, 20260506000001)
--   invoices.fe_estado                                        (019, eFactura fase 1A)
-- «Con DGI» = tiene CUFE guardado (también los cargados a mano del portal) O fe_estado
-- 'authorized'. Se cuentan las dos cosas por separado para ver si alguna vez difieren.
-- Facturas del CRM = todo lo que no es borrador ni se canceló antes de emitirse; las
-- anuladas se cuentan (existieron) y además se informan aparte.
-- ============================================================================
BEGIN READ ONLY;

SELECT
  to_char(date_trunc('month', i.issue_date), 'YYYY-MM')                                   AS mes,
  count(*)                                                                                  AS facturas,
  round(sum(i.grand_total), 2)                                                              AS monto,
  count(*) FILTER (WHERE nullif(btrim(i.dgi_cufe), '') IS NOT NULL OR i.fe_estado = 'authorized') AS con_dgi,
  round(coalesce(sum(i.grand_total) FILTER (WHERE nullif(btrim(i.dgi_cufe), '') IS NOT NULL OR i.fe_estado = 'authorized'), 0), 2) AS monto_con_dgi,
  count(*) FILTER (WHERE nullif(btrim(i.dgi_cufe), '') IS NULL AND i.fe_estado IS DISTINCT FROM 'authorized') AS sin_dgi,
  round(coalesce(sum(i.grand_total) FILTER (WHERE nullif(btrim(i.dgi_cufe), '') IS NULL AND i.fe_estado IS DISTINCT FROM 'authorized'), 0), 2) AS monto_sin_dgi,
  count(*) FILTER (WHERE nullif(btrim(i.dgi_cufe), '') IS NOT NULL)                        AS con_cufe,
  count(*) FILTER (WHERE i.fe_estado = 'authorized')                                        AS autorizadas_por_el_crm,
  count(*) FILTER (WHERE i.status = 'anulada')                                              AS anuladas
FROM public.invoices i
WHERE i.status NOT IN ('borrador', 'cancelada_pre_emision')
  AND i.issue_date >= DATE '2026-03-01'
GROUP BY 1
ORDER BY 1;

ROLLBACK;
