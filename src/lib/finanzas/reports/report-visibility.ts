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

// ---------------------------------------------------------------------------
// Estado de Resultado NIIF 18 — la misma regla, sobre una lista plana
// ---------------------------------------------------------------------------

/**
 * El ER NIIF 18 no devuelve secciones: devuelve una LISTA PLANA de filas ya
 * ordenadas. El criterio de visibilidad es el mismo —una cuenta en 0 no se
 * presenta— pero el recorrido es distinto, así que va aparte.
 *
 * Por qué importa acá más que en el Balance: el plan de Integra tiene 45 cuentas
 * de resultado y **22 están en cero**. Sin filtro, el reporte que abre el
 * contador son treinta y pico de renglones en 0.00 con los números reales
 * perdidos en el medio, y el modelo que él mandó no se parece en nada a eso. Un
 * renglón sin saldo en un estado financiero se lee como error.
 *
 * QUÉ SE CONSERVA SIEMPRE, aunque dé cero:
 *   · `bloque`, `resultado` e `impuesto` — son la ESTRUCTURA del estado, no un
 *     detalle de cuenta. Los cuatro subtotales obligatorios salen de ahí.
 *   · Las cuentas marcadas `estructural` (la distribución a socias): sin ese
 *     renglón la sección queda con encabezado y nada debajo.
 *
 * QUÉ SE OCULTA:
 *   · Cuentas en 0.
 *   · Un grupo que se queda sin ninguna cuenta con saldo, junto con su subtotal.
 *
 * Los subtotales NO se recalculan, igual que en el resto del archivo: una cuenta
 * en 0 no aporta al total, así que ocultarla no puede moverlo. Es la garantía
 * que cubren los tests.
 */
export function filterFilasER<
  T extends
    | { kind: "bloque" }
    | { kind: "grupo" }
    | { kind: "cuenta"; valor: { balanza: number }; estructural?: boolean }
    | { kind: "subtotal" }
    | { kind: "resultado" }
    | { kind: "impuesto" }
>(filas: T[], visibility: AccountVisibility): T[] {
  if (visibility === "all") return filas;

  const salida: T[] = [];
  // Buffer del grupo en curso: se vuelca solo si alguna de sus cuentas tiene
  // saldo. Un grupo sin cuentas visibles desaparece entero, con su subtotal.
  let grupoPendiente: T | null = null;
  let cuentasDelGrupo: T[] = [];
  let algunaConSaldo = false;

  const volcar = (subtotal: T | null) => {
    if (grupoPendiente && algunaConSaldo) {
      salida.push(grupoPendiente, ...cuentasDelGrupo);
      if (subtotal) salida.push(subtotal);
    }
    grupoPendiente = null;
    cuentasDelGrupo = [];
    algunaConSaldo = false;
  };

  for (const fila of filas) {
    if (fila.kind === "grupo") {
      volcar(null); // un grupo nuevo cierra el anterior (no debería pasar, pero no se pierde)
      grupoPendiente = fila;
      continue;
    }

    if (fila.kind === "cuenta") {
      const visible =
        fila.estructural === true || hasBalance(fila.valor.balanza);
      if (!visible) continue;
      if (grupoPendiente) {
        cuentasDelGrupo.push(fila);
        algunaConSaldo = true;
      } else {
        salida.push(fila);
      }
      continue;
    }

    if (fila.kind === "subtotal") {
      volcar(fila);
      continue;
    }

    // bloque / resultado / impuesto: estructura, siempre se conservan.
    volcar(null);
    salida.push(fila);
  }

  volcar(null);
  return salida;
}

/** Cuántas cuentas en 0 esconde la vista "solo con saldo" en el ER. */
export function countZeroFilasER(
  filas: Array<{ kind: string; valor?: { balanza: number }; estructural?: boolean }>
): number {
  return filas.filter(
    (f) =>
      f.kind === "cuenta" &&
      f.estructural !== true &&
      f.valor !== undefined &&
      !hasBalance(f.valor.balanza)
  ).length;
}
