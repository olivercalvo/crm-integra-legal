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
  /** 073: la cuenta del impuesto de la tasa de la línea de compra. */
  tax_account?: string | null;
  tax_code?: string | null;
  /** E8: la tasa de la línea (para saber si la NC la cambia). */
  tax_code_id?: string | null;
  /** Base ya acreditada por NC vigentes (`status = 'emitida'`). */
  acreditado_base: number;
  /** ITBMS ya acreditado por NC vigentes. */
  acreditado_itbms: number;
  cuenta_valida: boolean;
}

/**
 * Una línea pedida. Con `expense_line_id`, todo lo demás cae en lo de la
 * compra; sin ella (E8: NC sin compra, o línea agregada), cuenta, descripción
 * y monto son obligatorios. El impuesto lo escribe la persona y se acepta con
 * la tolerancia de la compra (±0,02): el comprobante del proveedor manda.
 */
export interface LineaPedida {
  expense_line_id: string | null;
  amount: number;
  chart_account_code?: string;
  description?: string;
  /** `undefined` = el de la línea de la compra; `null` = sin impuesto. */
  tax_code_id?: string | null;
  /** `null`/`undefined` = el sugerido por la tasa. */
  tax_amount?: number | null;
}

/** Una tasa del catálogo con su cuenta (073). */
export interface TasaParaNcDeCompra {
  code: string;
  rate: number;
  account_code: string | null;
  active: boolean;
}

/** Lo que hace falta del plan y del catálogo para las líneas que no vienen de la compra. */
export interface CatalogosParaNcDeCompra {
  tasas: Map<string, TasaParaNcDeCompra>;
  /** Códigos de cuenta activos y válidos para un gasto (`esTipoValidoParaGasto`, sin control). */
  cuentasValidas: Set<string>;
}

export interface LineaCalculada {
  /** La línea de la compra, si viene de una. */
  linea: LineaDeCompraParaNc | null;
  expense_line_id: string | null;
  line_order: number;
  description: string;
  chart_account_code: string;
  cuenta_valida: boolean;
  tax_code_id: string | null;
  tax_rate: number;
  tax_account: string | null;
  tax_code: string | null;
  amount: number;
  tax_amount: number;
}

export type ResultadoCalculo =
  | { ok: true; lineas: LineaCalculada[]; subtotal: number; itbms: number; total: number }
  | { ok: false; mensaje: string };

/** La misma tolerancia que la compra (`validators/expense-line.ts`). */
export const TOLERANCIA_ITBMS_NC = 0.02;

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
 * Misma regla que el RPC de la `066`/`076`.
 */
export function itbmsDeLineaDeNc(l: LineaDeCompraParaNc, monto: number): number {
  if (round2(monto) === disponibleEnLinea(l)) {
    return round2(l.tax_amount - l.acreditado_itbms);
  }
  return round2(monto * l.tax_rate);
}

/**
 * Valida el pedido y calcula los montos. Es la MISMA función en la pantalla y
 * en el servidor, y la base (`create_supplier_credit_note`, 076) vuelve a
 * calcular todo y rechaza un asiento que no coincida.
 * @param saldoDeLaCompra `balance_due`: el tope del documento (J-3). `null` =
 *   NC sin compra: sin tope, la NC entera es saldo a favor con el proveedor.
 */
export function calcularNcDeCompra(
  lineasDeCompra: LineaDeCompraParaNc[],
  pedido: LineaPedida[],
  saldoDeLaCompra: number | null,
  catalogos: CatalogosParaNcDeCompra = { tasas: new Map(), cuentasValidas: new Set() }
): ResultadoCalculo {
  const porId = new Map(lineasDeCompra.map((l) => [l.id, l]));
  const lineas: LineaCalculada[] = [];
  let orden = 0;
  for (const p of pedido) {
    const monto = round2(Number(p.amount) || 0);
    if (monto <= 0) continue;
    orden += 1;
    const l = p.expense_line_id ? porId.get(p.expense_line_id) : undefined;
    if (p.expense_line_id && !l) {
      return { ok: false, mensaje: "Una línea de la nota de crédito no pertenece a esta compra." };
    }
    if (l) {
      const disponible = disponibleEnLinea(l);
      if (monto > disponible) {
        return {
          ok: false,
          mensaje:
            `Línea ${l.line_order} ("${l.description}"): puedes acreditar hasta B/. ${disponible.toFixed(2)} ` +
            `de base; ya se acreditaron B/. ${round2(l.acreditado_base).toFixed(2)} con otras notas de crédito.`,
        };
      }
    }

    const descripcion = (p.description ?? l?.description ?? "").trim();
    if (descripcion.length < 3 || descripcion.length > 300) {
      return { ok: false, mensaje: `Línea ${orden}: la descripción debe tener entre 3 y 300 caracteres.` };
    }
    const cuenta = (p.chart_account_code ?? l?.chart_account_code ?? "").trim();
    if (!cuenta) {
      return { ok: false, mensaje: `Línea ${orden} ("${descripcion}"): elige la cuenta contable.` };
    }
    const cuentaValida = l && cuenta === l.chart_account_code ? l.cuenta_valida : catalogos.cuentasValidas.has(cuenta);

    // El impuesto: el de la línea de la compra si no se cambió; si no, el del
    // catálogo (nunca el del body).
    const taxId = p.tax_code_id !== undefined ? p.tax_code_id : l?.tax_code_id ?? null;
    let tasa = 0;
    let taxAccount: string | null = null;
    let taxCode: string | null = null;
    const mismaTasa = !!l && (taxId ?? null) === (l.tax_code_id ?? null);
    if (mismaTasa && l) {
      tasa = l.tax_rate;
      taxAccount = l.tax_account ?? null;
      taxCode = l.tax_code ?? null;
    } else if (taxId) {
      const t = catalogos.tasas.get(taxId);
      if (!t || !t.active) {
        return { ok: false, mensaje: `Línea ${orden} ("${descripcion}"): elige un impuesto activo del catálogo.` };
      }
      tasa = t.rate;
      taxAccount = t.account_code;
      taxCode = t.code;
    }

    let impuesto: number;
    if (l && mismaTasa && monto === disponibleEnLinea(l)) {
      impuesto = itbmsDeLineaDeNc(l, monto);
    } else {
      const sugerido = round2(monto * tasa);
      impuesto = p.tax_amount === null || p.tax_amount === undefined ? sugerido : round2(Number(p.tax_amount));
      if (!(impuesto >= 0) || Math.abs(impuesto - sugerido) > TOLERANCIA_ITBMS_NC + 1e-9) {
        return {
          ok: false,
          mensaje:
            `Línea ${orden} ("${descripcion}"): el impuesto (B/. ${impuesto.toFixed(2)}) no corresponde a su tasa ` +
            `(B/. ${sugerido.toFixed(2)}).`,
        };
      }
    }

    lineas.push({
      linea: l ?? null,
      expense_line_id: l?.id ?? null,
      line_order: orden,
      description: descripcion,
      chart_account_code: cuenta,
      cuenta_valida: cuentaValida,
      tax_code_id: taxId ?? null,
      tax_rate: tasa,
      tax_account: taxAccount,
      tax_code: taxCode,
      amount: monto,
      tax_amount: impuesto,
    });
  }
  if (lineas.length === 0) {
    return { ok: false, mensaje: "Indica cuánto se acredita en al menos una línea." };
  }
  const subtotal = round2(lineas.reduce((s, x) => s + x.amount, 0));
  const itbms = round2(lineas.reduce((s, x) => s + x.tax_amount, 0));
  const total = round2(subtotal + itbms);
  if (saldoDeLaCompra !== null && total > round2(saldoDeLaCompra)) {
    return {
      ok: false,
      mensaje:
        `La nota de crédito (B/. ${total.toFixed(2)}) supera lo que falta pagar de esta compra ` +
        `(B/. ${round2(saldoDeLaCompra).toFixed(2)}). Regístrala sin asociarla a la compra: queda como ` +
        `saldo a favor con el proveedor.`,
    };
  }
  return { ok: true, lineas, subtotal, itbms, total };
}

export interface CompraParaNc {
  /** `null` en una NC sin compra (E8). */
  id: string | null;
  /** La compra, o "sin compra asociada". */
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
  /** Fecha de REGISTRO de la NC (la elige el contador; ver `fecha-de-registro.ts`). */
  fechaDeRegistro: string,
  calculo: Extract<ResultadoCalculo, { ok: true }>
): ResultadoAsientoCompra {
  const comoCompra = construirAsientoDeCompra({
    id: compra.id ?? "nueva",
    expense_date: fechaDeRegistro,
    accounting_date: fechaDeRegistro,
    description: compra.description,
    total: calculo.total,
    supplier_name: compra.supplier_name,
    supplier_id: compra.supplier_id,
    lineas: calculo.lineas.map((x) => ({
      line_order: x.line_order,
      description: x.description,
      amount: x.amount,
      tax_amount: x.tax_amount,
      tax_account: x.tax_account,
      tax_code: x.tax_code,
      chart_account_code: x.chart_account_code,
      cuenta_valida: x.cuenta_valida,
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
        : /^(ITBMS|Impuesto) de compras \(crédito fiscal\)/.test(l.description ?? "")
          ? (l.description as string).replace("de compras (crédito fiscal)", "de compras acreditado por el proveedor")
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
