/**
 * NOTA DE CRÉDITO DE COMPRA (3.5): los montos y el asiento. Módulo PURO.
 *
 * El proveedor acredita parte o toda una compra. El asiento es **el de la
 * compra, armado sobre las líneas acreditadas, AL REVÉS**, que es el patrón de
 * la NC de venta (`asiento-nota-credito.ts` hace lo mismo con la factura):
 *
 *   DEBE  200001 Cuentas por pagar  (el total de la NC, con el proveedor)
 *   HABER la cuenta de cada línea   (la base acreditada, agrupada por cuenta)
 *   HABER 200003 ITBMS              (el ITBMS acreditado: baja el crédito fiscal)
 *
 * Nada se resta a mano: `construirAsientoDeCompra` arma el asiento (con sus
 * validaciones de cuentas y de cuadre) y acá se dan vuelta débitos y créditos.
 *
 * 🔴 Los montos también los calcula la base (`create_supplier_credit_note`,
 *    `066`) y el RPC VERIFICA que el asiento coincida. Si algún día esta
 *    función y el SQL discrepan, la base rechaza y no se registra nada.
 */

import type { AsientoInput, LineaAsiento } from "@/lib/finanzas/contabilidad/posting";
import {
  construirAsientoDeCompra,
  CUENTA_POR_PAGAR,
  type ResultadoAsientoCompra,
} from "@/lib/finanzas/contabilidad/asiento-compra";

export const SOURCE_TYPE_NOTA_CREDITO_PROVEEDOR = "nota_credito_proveedor" as const;

/** Una línea de la compra, con lo que ya le acreditaron NC vigentes. */
export interface LineaDeCompraParaNc {
  id: string;
  line_order: number;
  description: string;
  chart_account_code: string | null;
  /** La base de la línea de compra. */
  amount: number;
  tax_rate: number;
  tax_amount: number;
  /** Base ya acreditada por NC vigentes (`status = 'emitida'`). */
  acreditado_base: number;
  /** ITBMS ya acreditado por NC vigentes. */
  acreditado_itbms: number;
  cuenta_valida: boolean;
}

export interface LineaPedida {
  expense_line_id: string;
  amount: number;
}

export interface LineaCalculada {
  linea: LineaDeCompraParaNc;
  amount: number;
  tax_amount: number;
}

export type ResultadoCalculo =
  | { ok: true; lineas: LineaCalculada[]; subtotal: number; itbms: number; total: number }
  | { ok: false; mensaje: string };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Lo que todavía se puede acreditar de la base de una línea. */
export function disponibleEnLinea(l: LineaDeCompraParaNc): number {
  return round2(l.amount - l.acreditado_base);
}

/**
 * El ITBMS de lo acreditado en una línea. Si se acredita TODO lo que queda, el
 * ITBMS es el remanente exacto: el de la compra se cargó con ±0,02 de
 * tolerancia y recalcularlo podría dejar un centavo de saldo que nadie debe.
 * Misma regla que el RPC de la `066`.
 */
export function itbmsDeLineaDeNc(l: LineaDeCompraParaNc, monto: number): number {
  if (round2(monto) === disponibleEnLinea(l)) {
    return round2(l.tax_amount - l.acreditado_itbms);
  }
  return round2(monto * l.tax_rate);
}

/**
 * Valida el pedido contra la compra y calcula los montos.
 * @param saldoDeLaCompra `balance_due`: el tope del documento (J-3).
 */
export function calcularNcDeCompra(
  lineasDeCompra: LineaDeCompraParaNc[],
  pedido: LineaPedida[],
  saldoDeLaCompra: number
): ResultadoCalculo {
  const porId = new Map(lineasDeCompra.map((l) => [l.id, l]));
  const lineas: LineaCalculada[] = [];
  for (const p of pedido) {
    const monto = round2(Number(p.amount) || 0);
    if (monto <= 0) continue;
    const l = porId.get(p.expense_line_id);
    if (!l) return { ok: false, mensaje: "Una línea de la nota de crédito no pertenece a esta compra." };
    const disponible = disponibleEnLinea(l);
    if (monto > disponible) {
      return {
        ok: false,
        mensaje:
          `Línea ${l.line_order} ("${l.description}"): puedes acreditar hasta B/. ${disponible.toFixed(2)} ` +
          `de base; ya se acreditaron B/. ${round2(l.acreditado_base).toFixed(2)} con otras notas de crédito.`,
      };
    }
    lineas.push({ linea: l, amount: monto, tax_amount: itbmsDeLineaDeNc(l, monto) });
  }
  if (lineas.length === 0) {
    return { ok: false, mensaje: "Indica cuánto se acredita en al menos una línea." };
  }
  const subtotal = round2(lineas.reduce((s, x) => s + x.amount, 0));
  const itbms = round2(lineas.reduce((s, x) => s + x.tax_amount, 0));
  const total = round2(subtotal + itbms);
  if (total > round2(saldoDeLaCompra)) {
    return {
      ok: false,
      mensaje:
        `La nota de crédito (B/. ${total.toFixed(2)}) supera lo que falta pagar de esta compra ` +
        `(B/. ${round2(saldoDeLaCompra).toFixed(2)}). Si el proveedor te devolvió dinero o te dejó ` +
        `saldo a favor, consulta con el contador antes de registrarla.`,
    };
  }
  return { ok: true, lineas, subtotal, itbms, total };
}

export interface CompraParaNc {
  id: string;
  description: string;
  supplier_name: string | null;
  supplier_id: string | null;
}

/**
 * El asiento de la NC: el de la compra sobre lo acreditado, AL REVÉS.
 * Sin número (lo pone la base dentro de la misma transacción) ni `source_id`
 * (la NC todavía no existe cuando se arma): el RPC los completa.
 */
export function construirAsientoDeNotaDeCompra(
  compra: CompraParaNc,
  hoy: string,
  calculo: Extract<ResultadoCalculo, { ok: true }>
): ResultadoAsientoCompra {
  const comoCompra = construirAsientoDeCompra({
    id: compra.id,
    expense_date: hoy,
    description: compra.description,
    total: calculo.total,
    supplier_name: compra.supplier_name,
    lineas: calculo.lineas.map((x) => ({
      line_order: x.linea.line_order,
      description: x.linea.description,
      amount: x.amount,
      tax_amount: x.tax_amount,
      chart_account_code: x.linea.chart_account_code,
      cuenta_valida: x.linea.cuenta_valida,
    })),
  });
  if (!comoCompra.ok) {
    return {
      ...comoCompra,
      mensaje: comoCompra.mensaje.replace(/registrar la compra/g, "registrar la nota de crédito de la compra"),
    };
  }

  const lines: LineaAsiento[] = comoCompra.asiento.lines.map((l) => ({
    account_code: l.account_code,
    debit: l.credit,
    credit: l.debit,
    description:
      l.account_code === CUENTA_POR_PAGAR
        ? compra.supplier_name
        : l.description === "ITBMS de compras (crédito fiscal)"
          ? "ITBMS de compras acreditado por el proveedor"
          : l.description,
    // El tercero en la cuenta control, para que el Mayor de 200001 diga de
    // qué proveedor es sin adivinar por el texto.
    ...(l.account_code === CUENTA_POR_PAGAR && compra.supplier_id ? { supplier_id: compra.supplier_id } : {}),
  }));

  const asiento: AsientoInput = {
    ...comoCompra.asiento,
    source_type: SOURCE_TYPE_NOTA_CREDITO_PROVEEDOR,
    source_id: null,
    idempotency_key: null,
    lines,
  };
  return { ok: true, asiento };
}
