-- ============================================================================
-- Producción (uqmmkklbhzxqybljiecs) · SOLO SELECT · la corre Oliver en el SQL Editor
-- ============================================================================
-- Para comprobar las reglas de las validaciones previas (validaciones-previas.ts,
-- 03/10/2026) contra clientes REALES: los que tienen al menos una factura
-- autorizada por la DGI. Esos RUC y DV ya pasaron por la DGI, así que una
-- regla que los marque como mal formados está equivocada, no el cliente.
--
-- Sin datos de contacto (ni correo, ni teléfono, ni dirección).
-- Columnas anteriores a la 025: clients (initial + 20260508 + 019),
-- invoices.fe_estado (019) e invoices.dgi_cufe (B4).
--
-- Las dos últimas columnas son un ADELANTO en SQL de la regla de estructura
-- (los mismos patrones que `CEDULA` y `JURIDICA` del código). Manda el código:
-- el resultado se pasa por la función de TypeScript antes de decidir nada.
-- ============================================================================
SELECT
  c.client_number,
  c.name                                                              AS nombre,
  c.client_type                                                       AS tipo_de_cliente,
  c.tipo_receptor_fe                                                  AS tipo_receptor,
  coalesce(nullif(btrim(c.tax_id), ''), c.ruc)                        AS ruc,
  c.digito_verificador                                                AS dv,
  count(*)                                                            AS facturas_autorizadas,
  CASE
    WHEN c.tipo_receptor_fe NOT IN ('01', '03') THEN 'no aplica (receptor ' || coalesce(c.tipo_receptor_fe, 'sin tipo') || ')'
    WHEN c.client_type = 'persona_natural'
         AND upper(regexp_replace(coalesce(nullif(btrim(c.tax_id), ''), c.ruc, ''), '\s', '', 'g'))
             ~ '^((1[0-3]|[1-9])(AV|PI|NT)?|PE|E|N)-[0-9]{1,4}-[0-9]{1,6}$' THEN 'pasa'
    WHEN c.client_type = 'persona_juridica'
         AND upper(regexp_replace(coalesce(nullif(btrim(c.tax_id), ''), c.ruc, ''), '\s', '', 'g'))
             ~ '^[0-9]{1,10}-[0-9]{1,4}-[0-9]{1,7}$' THEN 'pasa'
    WHEN c.client_type IS NULL THEN 'NO PASA: falta tipo de cliente'
    ELSE 'NO PASA: estructura del RUC'
  END                                                                 AS estructura_del_ruc,
  CASE
    WHEN c.tipo_receptor_fe NOT IN ('01', '03') THEN 'no aplica'
    WHEN btrim(coalesce(c.digito_verificador, '')) ~ '^[0-9]{1,2}$' THEN 'pasa'
    ELSE 'NO PASA: DV'
  END                                                                 AS dv_regla
FROM public.clients c
JOIN public.invoices i ON i.client_id = c.id
WHERE i.fe_estado = 'authorized' OR nullif(btrim(i.dgi_cufe), '') IS NOT NULL
GROUP BY c.id, c.client_number, c.name, c.client_type, c.tipo_receptor_fe, c.tax_id, c.ruc, c.digito_verificador
ORDER BY estructura_del_ruc DESC, c.client_number;
