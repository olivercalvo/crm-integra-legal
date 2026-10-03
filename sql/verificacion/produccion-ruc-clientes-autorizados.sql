-- ============================================================================
-- Producción (uqmmkklbhzxqybljiecs) · SOLO LECTURA · la corre Oliver en el SQL Editor
-- ============================================================================
-- Para comprobar las reglas de las validaciones previas (validaciones-previas.ts)
-- contra clientes REALES: los que tienen al menos una factura autorizada por la
-- DGI. Esos RUC y DV ya pasaron por la DGI, así que una regla que los marque
-- como mal formados está equivocada, no el cliente.
--
-- Sin datos de contacto (ni correo, ni teléfono, ni dirección).
-- Columnas anteriores a la 025: clients (initial + 20260508 + 019),
-- invoices.fe_estado (019) e invoices.dgi_cufe (B4).
--
-- Las últimas columnas son un ADELANTO en SQL de la regla (los mismos patrones
-- que `CEDULA`, `JURIDICA` y `NT` del código, y la misma deducción del tipo de
-- receptor que `tipoReceptorEfectivo`). Manda el código: el resultado se pasa
-- por la función de TypeScript antes de decidir nada.
-- 2.ª versión (03/10/2026): acepta el formato NT (propiedad horizontal,
-- 8-NT-2-735096), PE con tres grupos, y deduce el tipo de receptor si falta.
-- ============================================================================
WITH c AS (
  SELECT
    cl.*,
    upper(regexp_replace(coalesce(nullif(btrim(cl.tax_id), ''), cl.ruc, ''), '\s', '', 'g')) AS ruc_norm,
    -- El tipo que viaja: el explícito o el deducido (igual que tipoReceptorEfectivo).
    CASE
      WHEN nullif(btrim(cl.tipo_receptor_fe), '') IS NOT NULL THEN btrim(cl.tipo_receptor_fe)
      WHEN nullif(btrim(cl.id_extranjero), '') IS NOT NULL OR cl.tax_id_type = 'extranjero' THEN '04'
      WHEN cl.tax_id_type = 'ruc' THEN '01'
      WHEN cl.tax_id_type IN ('cedula', 'pasaporte') THEN '02'
      WHEN cl.client_type = 'persona_juridica' THEN '01'
      WHEN cl.client_type = 'persona_natural' AND nullif(btrim(cl.digito_verificador), '') IS NOT NULL THEN '01'
      WHEN cl.client_type = 'persona_natural' THEN '02'
    END AS tipo_efectivo
  FROM public.clients cl
)
SELECT
  c.client_number,
  c.name                                                              AS nombre,
  c.client_type                                                       AS tipo_de_cliente,
  c.tipo_receptor_fe                                                  AS tipo_receptor_cargado,
  c.tipo_efectivo                                                     AS tipo_receptor_que_viaja,
  coalesce(nullif(btrim(c.tax_id), ''), c.ruc)                        AS ruc,
  c.digito_verificador                                                AS dv,
  count(*)                                                            AS facturas_autorizadas,
  CASE
    WHEN c.tipo_efectivo IS NULL THEN 'NO PASA: no se puede deducir el tipo de receptor'
    WHEN c.tipo_efectivo NOT IN ('01', '03') THEN 'no aplica (receptor ' || c.tipo_efectivo || ')'
    WHEN c.client_type = 'persona_natural'
         AND c.ruc_norm ~ '^(((1[0-3]|[1-9])(AV|PI)?|PE|E|N)-[0-9]{1,4}-[0-9]{1,6}|PE-[0-9]{1,2}-[0-9]{1,4}-[0-9]{1,6}|(1[0-3]|[1-9])-?NT-[0-9]{1,4}-[0-9]{1,7})$' THEN 'pasa'
    WHEN c.client_type = 'persona_juridica'
         AND c.ruc_norm ~ '^([0-9]{1,10}-[0-9]{1,4}-[0-9]{1,7}|(1[0-3]|[1-9])-?NT-[0-9]{1,4}-[0-9]{1,7})$' THEN 'pasa'
    WHEN c.client_type IS NULL THEN 'NO PASA: falta tipo de cliente'
    ELSE 'NO PASA: estructura del RUC'
  END                                                                 AS estructura_del_ruc,
  CASE
    WHEN c.tipo_efectivo IS NULL OR c.tipo_efectivo NOT IN ('01', '03') THEN 'no aplica'
    WHEN btrim(coalesce(c.digito_verificador, '')) ~ '^[0-9]{1,2}$' THEN 'pasa'
    ELSE 'NO PASA: DV'
  END                                                                 AS dv_regla
FROM c
JOIN public.invoices i ON i.client_id = c.id
WHERE i.fe_estado = 'authorized' OR nullif(btrim(i.dgi_cufe), '') IS NOT NULL
GROUP BY c.id, c.client_number, c.name, c.client_type, c.tipo_receptor_fe, c.tipo_efectivo, c.tax_id, c.ruc, c.ruc_norm, c.digito_verificador
ORDER BY estructura_del_ruc DESC, c.client_number;
