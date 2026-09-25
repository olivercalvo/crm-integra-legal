/**
 * QUÉ CUENTA EN EL RESUMEN DE ITBMS, Y CÓMO SE RESTA. Puro, sin base.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE (25/09/2026)
 * ─────────────────────────────────────────────────────────────────────────────
 * El resumen no leía `credit_notes`: una nota de crédito de venta no restaba
 * ITBMS. Es un error del Bloque 5 (la NC nació ahí) que el reporte arrastraba.
 * La regla la fijó Oliver:
 *
 *   · ITBMS débito  = ITBMS de facturas autorizadas − ITBMS de NC de venta
 *                     autorizadas y vigentes, del período.
 *   · ITBMS crédito = ITBMS de compras − ITBMS de NC de compra (3.5).
 *   · Las facturas y NC anuladas no cuentan.
 *   · La NC cuenta en el mes DE LA NC, no en el de su factura.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ QUIERE DECIR "AUTORIZADA" ACÁ (decisión documentada)
 * ─────────────────────────────────────────────────────────────────────────────
 * · FACTURA: emitida y no anulada (`emitida`, `parcialmente_pagada`, `pagada`).
 *   NO se exige `fe_estado = 'authorized'`: las facturas anteriores al 8/7/2026
 *   se autorizaron en el portal de ideati y el CRM no guardó su CUFE. Exigirlo
 *   las sacaría del reporte aunque la DGI sí las tiene.
 * · NC DE VENTA: `status = 'emitida'` (vigente), `fe_estado = 'authorized'` y
 *   su factura NO anulada. Literal del pedido. Una NC que todavía es documento
 *   interno no vale ante la DGI y no se declara; y la NC que sale de ANULAR una
 *   factura no se resta porque su factura ya no cuenta (se restaría dos veces).
 *
 * Antes, una factura anulada contaba positivo en su mes y negativo en el de la
 * anulación. Desde la `052` sólo se anula dentro del mismo mes, así que las dos
 * cuentas se compensaban; ahora simplemente no cuenta.
 */

export type EstadoFactura =
  | "borrador"
  | "cancelada_pre_emision"
  | "emitida"
  | "parcialmente_pagada"
  | "pagada"
  | "anulada"
  | string;

export interface FacturaParaItbms {
  status: EstadoFactura;
  /** `YYYY-MM-DD`. Sólo hace falta si se filtra por mes. */
  issue_date?: string;
  subtotal_total: number;
  tax_total: number;
}

export interface NotaDeVentaParaItbms {
  status: string;
  /** `YYYY-MM-DD` de la NC (NO de su factura). */
  issue_date?: string;
  fe_estado: string | null;
  /** El status de la factura que acredita. */
  factura_status: EstadoFactura;
  subtotal_total: number;
  tax_total: number;
}

export interface NotaDeCompraParaItbms {
  status: string;
  subtotal_total: number;
  tax_total: number;
  /** Base acreditada de líneas con ITBMS > 0. Si falta, se usa el subtotal si hubo ITBMS. */
  base_gravada?: number;
}

export interface CompraParaItbms {
  subtotal: number;
  tax_amount: number;
  /** Base de las líneas con ITBMS > 0 (una compra mixta no cuenta entera). */
  base_gravada: number;
}

const FACTURA_VALIDA = new Set(["emitida", "parcialmente_pagada", "pagada"]);

export function cuentaLaFactura(f: Pick<FacturaParaItbms, "status">): boolean {
  return FACTURA_VALIDA.has(f.status);
}

export function cuentaLaNotaDeVenta(
  n: Pick<NotaDeVentaParaItbms, "status" | "fe_estado" | "factura_status">
): boolean {
  return n.status === "emitida" && n.fe_estado === "authorized" && cuentaLaFactura({ status: n.factura_status });
}

export function cuentaLaNotaDeCompra(n: Pick<NotaDeCompraParaItbms, "status">): boolean {
  return n.status === "emitida";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Líneas 1, 2 y 3: ventas, ventas gravadas e ITBMS débito, netos de NC. */
/**
 * @param mes `YYYY-MM` opcional. Si viene, cada documento cuenta en el mes de SU
 *            fecha: la factura en el de la factura, la NC en el de la NC.
 */
export function ventasDelPeriodo(
  facturas: FacturaParaItbms[],
  notas: NotaDeVentaParaItbms[],
  mes?: string
): { ventas: number; gravadas: number; itbms: number } {
  const delMes = (d?: string) => !mes || (d ?? "").slice(0, 7) === mes;
  let ventas = 0;
  let gravadas = 0;
  let itbms = 0;
  for (const f of facturas) {
    if (!delMes(f.issue_date) || !cuentaLaFactura(f)) continue;
    ventas += f.subtotal_total;
    itbms += f.tax_total;
    if (f.tax_total > 0) gravadas += f.subtotal_total;
  }
  for (const n of notas) {
    if (!delMes(n.issue_date) || !cuentaLaNotaDeVenta(n)) continue;
    ventas -= n.subtotal_total;
    itbms -= n.tax_total;
    if (n.tax_total > 0) gravadas -= n.subtotal_total;
  }
  return { ventas: round2(ventas), gravadas: round2(gravadas), itbms: round2(itbms) };
}

/** Líneas 4, 5 y 6: compras, compras gravadas e ITBMS crédito, netos de NC de compra. */
export function comprasDelPeriodo(
  compras: CompraParaItbms[],
  notas: NotaDeCompraParaItbms[]
): { compras: number; gravadas: number; itbms: number } {
  let total = 0;
  let gravadas = 0;
  let itbms = 0;
  for (const c of compras) {
    total += c.subtotal;
    gravadas += c.base_gravada;
    itbms += c.tax_amount;
  }
  for (const n of notas) {
    if (!cuentaLaNotaDeCompra(n)) continue;
    total -= n.subtotal_total;
    itbms -= n.tax_total;
    gravadas -= n.base_gravada ?? (n.tax_total > 0 ? n.subtotal_total : 0);
  }
  return { compras: round2(total), gravadas: round2(gravadas), itbms: round2(itbms) };
}
