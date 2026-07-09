/**
 * Lógica pura (sin React) del modal de anulación de facturas. Extraída para
 * poder testearla con el runner `node:test` sin montar el componente client.
 *
 * Contexto: `cancelInvoice()` sólo anula LOCAL — no manda evento de anulación
 * a la DGI. Para facturas que ya tienen CUFE autorizado, la anulación real se
 * hace en el portal de eFactura PTY. Por eso el modal muestra un disclaimer +
 * un checkbox de confirmación obligatorio SOLO para esas facturas.
 */

import type { FeEstado } from "@/lib/finanzas/types/invoice";

/**
 * ¿La factura tiene un CUFE autorizado por la DGI? Cubre las dos vías por las
 * que una factura llega a tener CUFE:
 *   - Emisión real al PAC: `fe_estado === "authorized"`.
 *   - Registro manual "Camino 1": `dgi_cufe` cargado a mano (el `fe_estado`
 *     puede seguir en `no_emitida`), pero la DGI igual la tiene registrada.
 *
 * En ambos casos, anular en el CRM no notifica a la DGI, así que aplica el
 * disclaimer.
 */
export function invoiceHasAuthorizedCufe(
  feEstado: FeEstado | null | undefined,
  dgiCufe: string | null | undefined
): boolean {
  if (feEstado === "authorized") return true;
  return typeof dgiCufe === "string" && dgiCufe.trim().length > 0;
}

/**
 * ¿El botón "confirmar anulación" está deshabilitado? La única regla nueva es
 * el checkbox DGI: para facturas con CUFE hay que marcar la confirmación de
 * que ya se anuló (o se anulará) en el portal de la DGI. El estado de carga lo
 * maneja el propio `ConfirmationModal`, no esta función.
 *
 * Para facturas SIN CUFE, nunca se deshabilita por este motivo (la validación
 * de la razón sigue haciéndose en `submit()` con error inline, como antes).
 */
export function isCancelConfirmDisabled(params: {
  hasCufe: boolean;
  dgiConfirmed: boolean;
}): boolean {
  return params.hasCufe && !params.dgiConfirmed;
}
