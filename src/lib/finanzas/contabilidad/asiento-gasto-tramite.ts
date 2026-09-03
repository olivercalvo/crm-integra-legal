/**
 * EL ASIENTO DE UN GASTO DE TRÁMITE — armado puro.
 *
 * Decidido en el acta de la reunión con RM del 25/08/2026, en la lista de
 * "decisiones ya tomadas, no volver a preguntar":
 *
 *   "Gasto de trámite al incurrirlo: DEBE 130003, HABER Cuentas por Pagar."
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA FORMA DEL ASIENTO: N DÉBITOS, UN CRÉDITO
 * ═════════════════════════════════════════════════════════════════════════════
 *   DEBE   la cuenta de CADA LÍNEA, por su total (base + ITBMS)
 *   HABER  `200001 Cuentas por pagar`, por la suma de todas
 *
 * Ejemplo real, el gasto del 15/03 que motivó todo el modelo de líneas:
 *
 *   DEBE  130003  Fondo Legales de Clientes   Timbres fiscales       412,35
 *   DEBE  500005  Costos trámites legales     Honorario externo      900,00
 *   DEBE  130003  Fondo Legales de Clientes   Mensajería             185,50
 *   HABER 200001  Cuentas por pagar                                        1.497,85
 *
 * **Cuadra por construcción:** el crédito ES la suma de los débitos, calculada
 * por la misma función. No hay forma de que difieran salvo un error de redondeo,
 * y eso se verifica igual antes de devolver.
 *
 * Dos líneas con la misma cuenta NO se consolidan (`130003` aparece dos veces
 * arriba). Es a propósito: cada renglón conserva su descripción, que es
 * exactamente lo que Josuarth pidió ver en el mayor — "se abren las fracciones".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL ITBMS VA AL MISMO DÉBITO, Y NO A CRÉDITO FISCAL
 * ─────────────────────────────────────────────────────────────────────────────
 * En un gasto de trámite el impuesto es **pass-through**: el bufete paga 107 por
 * cuenta del cliente y le refactura 107 exento (los `REIM-*` del catálogo tienen
 * `default_tax_code = 'EXENTO'`). No es crédito fiscal porque el gasto no es del
 * bufete. Por eso el débito de cada línea es su `line_total`, no su `amount`.
 *
 * ⚠️ En una COMPRA del bufete es distinto: ahí el ITBMS pagado va al DÉBITO de
 * `200003 ITBMS por Pagar`, la misma cuenta que las ventas usan al crédito —
 * Josuarth: *"es una sola cuenta... y ahí va todo lo que vendo y lo que compro"*.
 * En un gasto de trámite no, porque el gasto no es del bufete: es del cliente, y
 * se le refactura entero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 UNA LÍNEA SIN CUENTA NO SE POSTEA, Y EL TIPO LO OBLIGA
 * ─────────────────────────────────────────────────────────────────────────────
 * `chart_account_code` es `string | null` porque las líneas del backfill
 * histórico dicen la verdad: nadie las clasificó nunca. Esta función devuelve un
 * **resultado discriminado**, no lanza y no "elige un default": el que la llama
 * no puede ignorar el caso sin que el compilador se lo marque.
 *
 * **Ese rechazo es la razón de ser del NULL.** Sin él, el NULL sería solo una
 * columna vacía; con él, es lo que impide que un gasto que nadie clasificó entre
 * al libro contra una cuenta inventada — en un libro que después no se puede
 * corregir.
 *
 * Módulo PURO: sin I/O, sin React, sin Supabase. La ruta que lo usa vive en
 * `app/api/expenses/[id]/post-to-ledger/route.ts`.
 */

import {
  CUENTA_POR_PAGAR,
  round2,
  type ExpenseLineRow,
} from "@/lib/finanzas/types/expense-line";
import type { AsientoInput, LineaAsiento } from "@/lib/finanzas/contabilidad/posting";

/** `source_type` de un gasto de trámite en el ledger. */
export const SOURCE_TYPE_GASTO_TRAMITE = "gasto_tramite" as const;

/** Lo que hace falta del encabezado para armar el asiento. */
export interface GastoParaAsiento {
  id: string;
  /** Fecha de la OPERACIÓN (Art. 5.1). Define el período contable. */
  date: string;
  concept: string;
  /** Código del caso, para que la naturaleza del asiento sea identificable. */
  case_code: string | null;
  /** Razón social del proveedor, si tiene. */
  supplier_legal_name: string | null;
}

export type ResultadoAsiento =
  | { ok: true; asiento: AsientoInput }
  | {
      ok: false;
      motivo: "sin_lineas" | "sin_clasificar" | "monto_cero" | "descuadre";
      mensaje: string;
      /** `line_order` de las líneas sin cuenta. Solo en `sin_clasificar`. */
      lineasSinCuenta?: number[];
    };

/**
 * La naturaleza de la operación (Art. 5.5 del DE 34/1998): tiene que decir QUÉ
 * pasó, no solo a qué documento pertenece. Se arma con el caso, el concepto y el
 * proveedor cuando hay.
 */
export function descripcionDelAsiento(gasto: GastoParaAsiento): string {
  const partes = ["Gasto de trámite"];
  if (gasto.case_code) partes.push(gasto.case_code);
  const cabeza = partes.join(" — ");
  const cola = gasto.supplier_legal_name
    ? `${gasto.concept} · ${gasto.supplier_legal_name}`
    : gasto.concept;
  return `${cabeza}: ${cola}`.slice(0, 300);
}

/**
 * Arma el asiento de un gasto de trámite. NO postea: devuelve el input listo
 * para `postJournalEntry()`.
 *
 * @param cuentaPorPagar código de la CxP. Es un parámetro y no un literal para
 *   que un cambio de plan de cuentas no obligue a perseguir strings, igual que
 *   `CUENTA_DISTRIBUCION_SOCIAS` en el Estado de Resultado.
 */
export function construirAsientoDeGastoTramite(
  gasto: GastoParaAsiento,
  lineas: readonly ExpenseLineRow[],
  cuentaPorPagar: string = CUENTA_POR_PAGAR
): ResultadoAsiento {
  if (lineas.length === 0) {
    return {
      ok: false,
      motivo: "sin_lineas",
      mensaje:
        "Este gasto no tiene ninguna línea de detalle, así que no hay nada que registrar en el libro.",
    };
  }

  // ── 🔴 EL RECHAZO QUE JUSTIFICA EL NULL ──────────────────────────────────
  const sinCuenta = lineas.filter((l) => !l.chart_account_code);
  if (sinCuenta.length > 0) {
    const n = sinCuenta.length;
    const cuales = sinCuenta.map((l) => l.line_order);
    return {
      ok: false,
      motivo: "sin_clasificar",
      lineasSinCuenta: cuales,
      mensaje:
        `Este gasto tiene ${n} ${n === 1 ? "línea" : "líneas"} sin cuenta contable ` +
        `(${n === 1 ? "la línea" : "las líneas"} ${cuales.join(", ")}). ` +
        `${n === 1 ? "Clasifíquela" : "Clasifíquelas"} antes de registrarlo en el libro.`,
    };
  }

  // Cada línea es un DÉBITO por su total: el ITBMS de un gasto de trámite es
  // pass-through, no crédito fiscal. Ver el encabezado.
  const debitos: LineaAsiento[] = lineas.map((l) => ({
    // El `!` es seguro: el filtro de arriba ya devolvió si había alguna en null.
    account_code: l.chart_account_code as string,
    debit: round2(l.line_total),
    credit: 0,
    description: l.description,
  }));

  const total = round2(debitos.reduce((s, d) => s + d.debit, 0));

  if (total <= 0) {
    return {
      ok: false,
      motivo: "monto_cero",
      mensaje:
        "El total del gasto es cero. Un asiento sin importe no se registra en el libro.",
    };
  }

  const credito: LineaAsiento = {
    account_code: cuentaPorPagar,
    debit: 0,
    credit: total,
    description: gasto.supplier_legal_name ?? "Cuentas por pagar",
  };

  const lineasAsiento = [...debitos, credito];

  // Cuadra por construcción —el crédito ES la suma de los débitos— así que esto
  // solo puede fallar por un redondeo. Se verifica igual: un descuadre que llega
  // al RPC vuelve como un error genérico, y acá se puede decir de cuánto es.
  const sumaDebitos = round2(lineasAsiento.reduce((s, l) => s + l.debit, 0));
  const sumaCreditos = round2(lineasAsiento.reduce((s, l) => s + l.credit, 0));
  if (sumaDebitos !== sumaCreditos) {
    return {
      ok: false,
      motivo: "descuadre",
      mensaje:
        `El asiento no cuadra: débitos ${sumaDebitos.toFixed(2)} contra créditos ` +
        `${sumaCreditos.toFixed(2)}. No se registró nada.`,
    };
  }

  return {
    ok: true,
    asiento: {
      transaction_date: gasto.date,
      description: descripcionDelAsiento(gasto),
      source_type: SOURCE_TYPE_GASTO_TRAMITE,
      source_id: gasto.id,
      lines: lineasAsiento,
    },
  };
}
