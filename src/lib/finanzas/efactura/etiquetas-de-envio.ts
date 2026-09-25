/**
 * El nombre del botón que manda un documento a la DGI. UNO SOLO, en facturas y
 * en notas de crédito (pedido de Oliver, 25/09/2026).
 *
 * Antes convivían tres: «Enviar al PAC» en la factura, «Reenviar a la DGI»
 * después de un rechazo y «Enviar a la DGI» / «Reintentar envío a la DGI» en la
 * nota de crédito. Para el contador es la misma acción, y el PAC es un
 * intermediario que no tiene por qué conocer.
 *
 * 🔒 `etiquetas-de-envio.test.ts` falla si una pantalla vuelve a escribir el
 * texto a mano o a decir «Enviar al PAC».
 */
export const ENVIAR_A_LA_DGI = "Enviar a la DGI";
export const REENVIAR_A_LA_DGI = "Reenviar a la DGI";

export function etiquetaDeEnvio(esReintento: boolean): string {
  return esReintento ? REENVIAR_A_LA_DGI : ENVIAR_A_LA_DGI;
}
