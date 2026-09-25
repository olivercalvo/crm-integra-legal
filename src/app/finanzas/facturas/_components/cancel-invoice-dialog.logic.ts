/**
 * Lógica pura (sin React) del modal de anulación de facturas. Extraída para
 * poder testearla con el runner `node:test` sin montar el componente client.
 *
 * Contexto: desde 9B, para una factura con CUFE la ruta `/cancel` la anula
 * PRIMERO ante la DGI y después en el libro (`anularFacturaAnteDgi`). Es un
 * acto fiscal que no se deshace, así que el modal muestra un aviso y un
 * checkbox obligatorio SOLO para esas facturas. (Hasta el 25/09/2026 el texto
 * decía lo contrario: que el CRM no anulaba ante la DGI.)
 */

import type { FeEstado } from "@/lib/finanzas/types/invoice";
import { faltanParaElMinimo } from "@/lib/finanzas/validators/cancel-invoice";

/**
 * ¿La factura tiene un CUFE autorizado por la DGI? Cubre las dos vías por las
 * que una factura llega a tener CUFE:
 *   - Emisión real al PAC: `fe_estado === "authorized"`.
 *   - Registro manual "Camino 1": `dgi_cufe` cargado a mano (el `fe_estado`
 *     puede seguir en `no_emitida`), pero la DGI igual la tiene registrada.
 *
 * En ambos casos la anulación viaja a la DGI, así que aplica el aviso.
 */
export function invoiceHasAuthorizedCufe(
  feEstado: FeEstado | null | undefined,
  dgiCufe: string | null | undefined
): boolean {
  if (feEstado === "authorized") return true;
  return typeof dgiCufe === "string" && dgiCufe.trim().length > 0;
}

/**
 * ¿El botón "confirmar anulación" está deshabilitado? Dos motivos, los dos
 * evaluados acá para que el JSX no tenga que acordarse de ninguno:
 *
 *   1. **El motivo no llega al mínimo de la DGI** (15 caracteres). Antes esto
 *      se validaba recién en `submit()`, con el error apareciendo DESPUÉS de
 *      apretar. Con un mínimo de 3 era un detalle; con 15 es el caso corriente
 *      —"error en el monto" son 18, pero "monto mal" son 10— así que apretar y
 *      que rebote pasaría a ser lo normal. Que el botón no se habilite y el
 *      contador diga cuánto falta es la diferencia entre una regla que se
 *      entiende mientras se escribe y una que se descubre a los golpes.
 *
 *   2. **El checkbox DGI**, para facturas que ya tienen CUFE: hay que confirmar
 *      que se entiende que la anulación va a la DGI y no se deshace.
 *
 * El estado de carga lo maneja el propio `ConfirmationModal`, no esta función.
 */
export function isCancelConfirmDisabled(params: {
  hasCufe: boolean;
  dgiConfirmed: boolean;
  /** El texto tal como está escrito; el trim lo hace `faltanParaElMinimo`. */
  reason: string;
}): boolean {
  if (faltanParaElMinimo(params.reason) > 0) return true;
  return params.hasCufe && !params.dgiConfirmed;
}
