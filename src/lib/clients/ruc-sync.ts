/**
 * Sincronización `ruc` → `tax_id` en el alta/edición de clientes.
 *
 * Causa raíz (2026-08, CLI-057 MI CONDADO): el RUC del cliente vive en DOS
 * columnas y cada mitad del sistema usa una distinta:
 *   - La ficha (client-form.tsx) edita SOLO `ruc`, nunca manda `tax_id`.
 *   - La emisión eFactura lee `client.tax_id ?? client.ruc` y por lo tanto
 *     PREFIERE `tax_id` (map-receptor.ts:102, buildRucReceptor).
 * Resultado: al corregir el RUC desde la ficha, `tax_id` se quedaba con el
 * valor viejo/incompleto y la factura se emitía con el RUC equivocado —
 * mientras la pantalla mostraba el correcto. Silencioso y difícil de ver.
 *
 * Regla: el RUC que la abogada gestiona en la ficha es la FUENTE DE VERDAD y
 * alimenta AMBAS columnas. Así `tax_id ?? ruc` devuelve siempre lo que se ve
 * en pantalla, sin tocar la preferencia del mapper.
 *
 * Lo que este helper NO hace, a propósito:
 *   - NO borra `tax_id` cuando el `ruc` llega vacío. Vaciar el campo en la
 *     ficha no debe destruir un `tax_id` que la pantalla nunca mostró
 *     (regla del proyecto: no borrar data). Ver changelog para el residual.
 *   - NO espeja en sentido inverso (`tax_id` → `ruc`): ningún flujo de la app
 *     manda hoy `tax_id` a estos endpoints.
 *
 * Puro (sin I/O) para poder testearlo sin BD, igual que ruc-lookup.ts.
 */

/**
 * Trim del identificador fiscal tal como llega del body. Vacío, whitespace,
 * null/undefined y no-strings vacíos → null (equivale a "no hay RUC").
 */
export function normalizeRucInput(raw: unknown): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Valor a escribir en `tax_id` a partir del `ruc` del body.
 * null → no hay que espejar nada (el caller deja `tax_id` como está).
 */
export function mirroredTaxId(rucRaw: unknown): string | null {
  return normalizeRucInput(rucRaw);
}

/**
 * Campos fiscales a escribir cuando el body trae `ruc`.
 *
 * - RUC con valor → `{ ruc, tax_id }` con el MISMO valor trimmeado.
 * - RUC vacío     → `{ ruc: null }`; `tax_id` se omite (no se pisa ni borra).
 *
 * Aplicar SIEMPRE después de un eventual `tax_id` explícito del body: si
 * llegan ambos y difieren, gana `ruc`.
 */
export function rucFieldWrites(rucRaw: unknown): { ruc: string | null; tax_id?: string } {
  const ruc = normalizeRucInput(rucRaw);
  return ruc === null ? { ruc: null } : { ruc, tax_id: ruc };
}
