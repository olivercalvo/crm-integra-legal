-- ============================================================================
-- Producción (uqmmkklbhzxqybljiecs) · SOLO SELECT · la corre Oliver en el SQL Editor
-- ============================================================================
-- Detalle de las 4 facturas «emitida» que nunca llegaron a la DGI (hallazgo del
-- 03/10/2026). NO modifica nada.
--
-- El mensaje del PAC no tiene columna propia: vive en fe_emisiones.cod_res (lista
-- [{dCodRes, dMsgRes}]) del último intento. Sin intentos ⇒ nadie la mandó nunca
-- (fe_estado 'no_emitida'). response_payload se incluye recortado para los errores
-- de transporte, que no traen cod_res.
-- Columnas: invoices (B3b/B4), fe_emisiones (019), users, clients: todas
-- anteriores a la 025. No usa fe_emisiones.credit_note_id (062, no está en producción).
-- ============================================================================
SELECT
  i.invoice_number                                       AS numero,
  i.issue_date                                           AS fecha_documento,
  i.grand_total                                          AS monto,
  c.name                                                 AS cliente,
  i.status,
  i.fe_estado,
  i.punto_facturacion,
  i.numero_documento                                     AS correlativo_fe,
  nullif(btrim(i.dgi_cufe), '')                          AS cufe,
  coalesce(e.intentos, 0)                                AS intentos_ante_el_pac,
  e.ultimo_intento_el,
  e.autorizada                                           AS ultimo_autorizada,
  (SELECT string_agg(r->>'dCodRes' || ' ' || coalesce(r->>'dMsgRes', ''), ' · ')
     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.cod_res) = 'array' THEN e.cod_res ELSE '[]'::jsonb END) r)
                                                         AS mensaje_del_pac,
  left(e.response_payload::text, 400)                    AS respuesta_recortada,
  u.full_name                                            AS creada_por,
  u.email                                                AS creada_por_email,
  i.created_at                                           AS creada_el
FROM public.invoices i
LEFT JOIN public.clients c ON c.id = i.client_id
LEFT JOIN public.users   u ON u.id = i.created_by
LEFT JOIN LATERAL (
  SELECT count(*) OVER () AS intentos, fe.created_at AS ultimo_intento_el,
         fe.autorizada, fe.cod_res, fe.response_payload
    FROM public.fe_emisiones fe
   WHERE fe.invoice_id = i.id
   ORDER BY fe.intento DESC
   LIMIT 1
) e ON true
WHERE i.invoice_number IN ('FAC-HON-000489', 'FAC-HON-000496', 'FAC-HON-000503', 'FAC-HON-000508')
ORDER BY i.invoice_number;
