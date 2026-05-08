/**
 * Errores compartidos del módulo Finanzas. Originalmente vivían como
 * `InvoiceMutationError` dentro de `api/invoices.ts`; al sumar el módulo de
 * cotizaciones (Sprint 2E.1) se extrajeron acá para reusar el mismo patrón
 * en quotes, payments, credit notes, etc.
 *
 * Convenciones:
 *   - `message` es en español, listo para mostrar al usuario.
 *   - `detail` es para logging server-side; NO devolver al cliente.
 *   - `status` default = 400 (validación). 403 = permisos, 404 = not found,
 *     500 = error inesperado de BD.
 */

export class MutationError extends Error {
  /** Código HTTP sugerido para devolver. */
  status: number;
  /** Detalles internos para logging (NO mostrar al usuario). */
  detail?: unknown;
  constructor(message: string, status = 400, detail?: unknown) {
    super(message);
    this.name = "MutationError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Mapea errores de Postgres (incluyendo RAISE EXCEPTION de los triggers
 * T1-T8b / T2-quote / T4-quote / T6-quote) a mensajes friendly en español.
 * Si no matchea ningún patrón conocido devuelve el message tal cual (los
 * triggers ya tienen mensajes en español).
 */
export function pgErrorToMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "Error desconocido";
  const e = err as { message?: string; code?: string; details?: string };
  if (e.message) {
    // 23514 = check_violation. El detail trae el constraint name + valores.
    if (e.code === "23514" && e.details) {
      return `Validación rechazada por la base de datos: ${e.details}`;
    }
    return e.message;
  }
  return "Error desconocido al procesar la operación";
}
