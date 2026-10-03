-- SOLO LECTURA. Producción (uqmmkklbhzxqybljiecs), SQL Editor.
-- Usa sólo columnas que existen desde antes de la 025 (producción está en la 024).
BEGIN READ ONLY;

WITH docs AS (
  -- Facturas emitidas (sin borradores ni canceladas antes de emitir), por fecha del documento.
  SELECT 'Facturas emitidas' AS documento, issue_date::date AS fecha, grand_total::numeric AS monto
    FROM public.invoices
   WHERE status NOT IN ('borrador', 'cancelada_pre_emision')
  UNION ALL
  -- Cobros de Finanzas (recibos REC-).
  SELECT 'Cobros (Finanzas)', payment_date::date, amount::numeric FROM public.payments
  UNION ALL
  -- Cobros del caso (Legal), que no se cruzan con los de Finanzas.
  SELECT 'Cobros del caso (Legal)', payment_date::date, amount::numeric FROM public.client_payments
  UNION ALL
  -- Gastos de trámite.
  SELECT 'Gastos de trámite', date::date, amount::numeric FROM public.expenses
)
SELECT documento,
       'TOTAL' AS mes,
       count(*) AS cantidad,
       round(sum(monto), 2) AS monto,
       min(fecha) AS primera,
       max(fecha) AS ultima
  FROM docs GROUP BY documento
UNION ALL
SELECT documento,
       to_char(fecha, 'YYYY-MM'),
       count(*),
       round(sum(monto), 2),
       min(fecha),
       max(fecha)
  FROM docs GROUP BY documento, to_char(fecha, 'YYYY-MM')
ORDER BY 1, 2;

ROLLBACK;
