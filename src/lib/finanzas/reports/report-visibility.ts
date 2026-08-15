/**
 * Filtro de PRESENTACIÓN para el Balance General y el Estado de Resultado:
 * "solo cuentas con saldo" vs "todas las cuentas" (pedido de Josuar).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTO NO CALCULA NADA
 * ─────────────────────────────────────────────────────────────────────────────
 * Recibe secciones YA armadas por `accounting-reports.ts` y devuelve las mismas
 * secciones con menos FILAS. Los `total` y `subtotal` se copian intactos, nunca
 * se recalculan: una cuenta en 0 no aporta al total, así que ocultarla no puede
 * cambiarlo. Esa es justamente la garantía que cubren los tests — los totales de
 * las dos vistas tienen que ser idénticos.
 *
 * Si alguna vez hace falta recalcular acá, es señal de que el filtro dejó de ser
 * presentación y hay que replantearlo.
 */

import type { ReportGroup, ReportSection } from "@/lib/finanzas/reports/accounting-reports";

/** Vista de cuentas del reporte. */
export type AccountVisibility = "with-balance" | "all";

/** Default pedido por Josuar: entrar viendo solo lo que tiene saldo. */
export const DEFAULT_ACCOUNT_VISIBILITY: AccountVisibility = "with-balance";

/**
 * Tolerancia al comparar montos en B/. (medio centavo). Mismo criterio que usa
 * `accounting-reports.ts` para decidir si un número es cero.
 */
const EPSILON = 0.005;

/** true cuando el monto NO es cero (con tolerancia de medio centavo). */
export function hasBalance(amount: number): boolean {
  return Math.abs(amount) >= EPSILON;
}

/**
 * Filtra los renglones de un grupo. Un grupo que se queda sin cuentas con saldo
 * DESAPARECE entero (encabezado y subtotal incluidos): mostrar "Total Activo no
 * corriente 0.00" sin ninguna cuenta debajo es ruido, no información.
 */
export function filterGroups(
  groups: ReportGroup[],
  visibility: AccountVisibility
): ReportGroup[] {
  if (visibility === "all") return groups;

  const filtered: ReportGroup[] = [];
  for (const g of groups) {
    const rows = g.rows.filter((r) => hasBalance(r.amount));
    if (rows.length === 0) continue;
    // subtotal se COPIA, no se recalcula (ver cabecera del archivo).
    filtered.push({ ...g, rows });
  }
  return filtered;
}

/**
 * Filtra una sección completa. El encabezado y el total de la sección se
 * conservan SIEMPRE, aunque no quede ninguna cuenta visible: son parte de la
 * estructura del estado financiero, no un detalle de cuenta.
 */
export function filterSection(
  section: ReportSection,
  visibility: AccountVisibility
): ReportSection {
  if (visibility === "all") return section;
  return { ...section, groups: filterGroups(section.groups, visibility) };
}

/**
 * Cuántas cuentas en 0 esconde la vista "solo con saldo". Se muestra al lado del
 * toggle para que quede claro que el reporte no está incompleto: hay filas
 * ocultas a propósito.
 */
export function countZeroRows(sections: ReportSection[]): number {
  return sections
    .flatMap((s) => s.groups)
    .flatMap((g) => g.rows)
    .filter((r) => !hasBalance(r.amount)).length;
}
