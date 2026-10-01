/**
 * EL MÓDULO DE UN ASIENTO (tipo de transacción): FAC-ING, FAC-CO, NC-ING,
 * NC-CO, CO, PA, AD, AP y CA. Bloque 1, E3, plan punto 2.
 *
 * Es la columna por la que Josuarth filtra el Mayor (como el "Transaction Type"
 * de QuickBooks). **No se guarda: se deriva del `source_type`**, así que los
 * asientos anteriores a E3 lo tienen sin tocar el libro.
 *
 * Una REVERSIÓN lleva el módulo del asiento que revierte, con la marca
 * "Reversión": el espejo de un cobro es parte del módulo de cobros.
 *
 * ⚠️ El módulo NO es el prefijo del número del documento. Las facturas de venta
 * siguen numerándose `FAC-HON-` / `FAC-REI-` (P-2a) y su módulo es `FAC-ING`;
 * los cobros viejos son `REC-` y su módulo es `CO`. El número va en otra columna.
 *
 * Módulo PURO.
 */

export type Modulo = "FAC-ING" | "FAC-CO" | "NC-ING" | "NC-CO" | "CO" | "PA" | "AD" | "AP" | "CA";

export interface DefinicionDeModulo {
  codigo: Modulo;
  nombre: string;
  /** Los `source_type` que caen en este módulo. */
  sourceTypes: readonly string[];
}

/** En el orden en que se ofrecen en un filtro. */
export const MODULOS: readonly DefinicionDeModulo[] = [
  { codigo: "FAC-ING", nombre: "Facturas de venta", sourceTypes: ["factura"] },
  // P-2b (01/10/2026): el gasto de trámite es una factura de compra más. Lo que
  // lo distingue es la cuenta 130003 y el caso, no el módulo.
  { codigo: "FAC-CO", nombre: "Facturas de compra", sourceTypes: ["gasto", "gasto_tramite"] },
  { codigo: "NC-ING", nombre: "Notas de crédito de venta", sourceTypes: ["nota_credito"] },
  { codigo: "NC-CO", nombre: "Notas de crédito de compra", sourceTypes: ["nota_credito_proveedor"] },
  { codigo: "CO", nombre: "Cobros", sourceTypes: ["pago"] },
  { codigo: "PA", nombre: "Pagos a proveedores", sourceTypes: ["pago_proveedor"] },
  { codigo: "AD", nombre: "Asientos de diario", sourceTypes: ["manual"] },
  { codigo: "AP", nombre: "Apertura", sourceTypes: ["apertura"] },
  { codigo: "CA", nombre: "Cierre anual", sourceTypes: ["cierre"] },
];

const POR_SOURCE_TYPE = new Map<string, Modulo>(
  MODULOS.flatMap((m) => m.sourceTypes.map((s) => [s, m.codigo] as const))
);

export interface ModuloDelAsiento {
  /** `null` solo si el tipo es desconocido (o una reversión sin su original). */
  modulo: Modulo | null;
  esReversion: boolean;
}

/**
 * El módulo de un asiento. Para una reversión hace falta el `source_type` del
 * asiento que revierte; sin él queda sin módulo (pero marcada como reversión).
 */
export function moduloDelAsiento(
  sourceType: string,
  reversesSourceType?: string | null
): ModuloDelAsiento {
  if (sourceType === "reversion") {
    return {
      modulo: reversesSourceType ? POR_SOURCE_TYPE.get(reversesSourceType) ?? null : null,
      esReversion: true,
    };
  }
  return { modulo: POR_SOURCE_TYPE.get(sourceType) ?? null, esReversion: false };
}

/** Lo que se muestra en la columna: `CO`, `CO · Reversión`, o `Reversión` a secas. */
export function etiquetaDeModulo(m: ModuloDelAsiento): string {
  if (m.esReversion) return m.modulo ? `${m.modulo} · Reversión` : "Reversión";
  return m.modulo ?? "";
}

// ---------------------------------------------------------------------------
// E9: el FILTRO por módulo del Mayor y del Diario.
// ---------------------------------------------------------------------------

const CODIGOS = new Set<string>(MODULOS.map((m) => m.codigo));

/**
 * Los módulos de `?modulo=CO,AD`, en el orden de `MODULOS`. Un código que no
 * existe se descarta en silencio: es un enlace viejo o tipeado a mano, y
 * rechazarlo dejaría la pantalla en blanco.
 */
export function modulosDesdeParametro(valor: string | null | undefined): Modulo[] {
  if (!valor) return [];
  const pedidos = new Set(valor.split(",").map((v) => v.trim().toUpperCase()));
  return MODULOS.map((m) => m.codigo).filter((c) => pedidos.has(c) && CODIGOS.has(c));
}

/**
 * ¿Entra el asiento en el filtro? Sin módulos elegidos entra todo. Una
 * reversión entra con el módulo de lo que revierte: el espejo de un cobro es
 * parte de los cobros, y filtrar CO sin él mostraría un saldo que no existe.
 */
export function entraEnElFiltro(m: ModuloDelAsiento, elegidos: readonly Modulo[]): boolean {
  if (elegidos.length === 0) return true;
  return m.modulo !== null && elegidos.includes(m.modulo);
}
