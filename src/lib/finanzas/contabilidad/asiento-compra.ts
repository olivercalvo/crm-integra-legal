/**
 * COMPRA DEL BUFETE → ASIENTO. Fila 12 del acta del 25/08.
 *
 *   DEBE  la cuenta de CADA línea, por su `amount` (la base)
 *   DEBE  200003 ITBMS por Pagar, por la suma de los impuestos
 *   HABER 200001 Cuentas por pagar, por el total
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL ITBMS DE COMPRAS VA AL DÉBITO DE LA MISMA CUENTA QUE LAS VENTAS
 * ═════════════════════════════════════════════════════════════════════════════
 * `200003 ITBMS por Pagar` recibe las ventas al CRÉDITO y las compras al DÉBITO.
 * No hay una cuenta de crédito fiscal separada. Josuarth, 25/08, textual:
 *
 *   "Pero hay otra cuenta ITMS por pagar. No, es una sola. Es una sola cuenta.
 *    Que se llama ITMS por pagar. Y ahí va todo lo que vendo y lo que compro."
 *
 *   "Hay sistemas contables que tienen una ITD para compra y una ITD para
 *    ingreso. Pero luego el contador todos los meses tiene que cerrar. Entonces
 *    nosotros preferimos tener un solo mayor."
 *
 * 🔴 El plan de trabajo afirmó lo contrario durante semanas —que el ITBMS de
 *    compras estaba BLOQUEADO esperando una cuenta de crédito fiscal— y hubo que
 *    corregirlo cuatro veces. La respuesta estaba en la transcripción todo el
 *    tiempo. Separarlo no es una mejora: es deshacer una decisión del contador.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE MÓDULO NO REUSA `asiento-gasto-tramite.ts`
 * ═════════════════════════════════════════════════════════════════════════════
 * La forma se parece —N débitos contra un crédito único a `200001`— y por eso da
 * ganas de unificarlos. **No se unifican**, y el motivo no es de estilo:
 *
 *   · Un gasto de trámite es un **pass-through al cliente**: no genera ITBMS,
 *     porque el bufete no está comprando nada, está adelantando plata. Su
 *     asiento nunca toca `200003`.
 *   · Una compra es del bufete y **sí** genera crédito fiscal.
 *
 * Un módulo compartido tendría que llevar un `if (esTramite)` adentro, y ese if
 * es exactamente el lugar donde alguien, en seis meses, va a agregarle ITBMS al
 * gasto de trámite "para unificar". Son dos hechos contables distintos que se
 * parecen; que cada uno tenga su archivo es lo que impide confundirlos.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * SIN CUENTA POR DEFECTO
 * ═════════════════════════════════════════════════════════════════════════════
 * La cuenta sale de `expense_lines.chart_account_code`. Si una línea apunta a una
 * cuenta que no existe o está inactiva en el plan vigente, este módulo **rechaza
 * el asiento nombrando la línea y la cuenta**.
 *
 * ⚠️ Ninguna cuenta genérica de respaldo. Un default convierte un error de
 * clasificación en un gasto mal imputado que nadie ve hasta que el contador lee
 * el estado de resultados — y el asiento es inmutable.
 *
 * ⚠️ La cuenta del HABER es `200001 Cuentas por pagar` SIEMPRE, incluso si la
 * compra se registra ya pagada. La pata contra el banco (DEBE CxP / HABER banco)
 * es el asiento del PAGO, que es su propio bloque: `business_expenses` no tiene
 * columna de cuenta bancaria, y el banco lo elige quien registra (criterio de
 * Rose, 25/08). Postear contra un banco adivinado sería inventar el dato.
 *
 * Módulo PURO: sin I/O, sin React, sin Supabase.
 */

import type { AsientoInput, LineaAsiento } from "@/lib/finanzas/contabilidad/posting";

/**
 * ITBMS, una sola cuenta para ventas y compras. Ver el encabezado.
 *
 * ⚠️ Coincide con la constante homónima de `asiento-factura.ts` y **no se
 * importa de allá**: son dos lecturas independientes de la misma decisión del
 * contador. Si algún día se separan las cuentas, cada asiento tiene que poder
 * moverse solo — y mientras tanto, que las dos digan `200003` es la evidencia de
 * que la decisión se aplicó en los dos lados, no de que hay una constante que
 * alguien puede cambiar y mover los dos sin darse cuenta.
 */
export const CUENTA_ITBMS = "200003";

/** Cuenta control de proveedores. El crédito de toda compra va acá. */
export const CUENTA_POR_PAGAR = "200001";

/** `source_type` del asiento de una compra. */
export const SOURCE_TYPE_COMPRA = "gasto" as const;

/**
 * Una línea de compra, con la validez de su cuenta ya resuelta.
 *
 * 🔑 `source_type` es **`gasto`**, no `compra`. `gasto` ya existe en el CHECK de
 * `journal_entries`, ya significa `business_expenses` en `destino-documento.ts`
 * (`sop.md`), y los asientos sembrados ya lo usan con `source_id` = el id de la
 * compra — así que el UNIQUE de la `034` ya está aplicando. Agregar `compra`
 * habría dejado dos tipos para la misma tabla y los asientos viejos en el
 * anterior.
 */
export interface LineaCompraParaAsiento {
  line_order: number;
  description: string;
  /** La base imponible de la línea. */
  amount: number;
  /** ITBMS de la línea. Cero en las exentas. */
  tax_amount: number;
  chart_account_code: string | null;
  /**
   * ¿La cuenta existe, está activa, y es de un tipo que puede recibir un
   * desembolso? Lo resuelve quien lee la base; acá llega calculado.
   */
  cuenta_valida: boolean;
}

export interface CompraParaAsiento {
  id: string;
  expense_date: string;
  description: string;
  /** `business_expenses.total` — la base más el impuesto. */
  total: number;
  supplier_name: string | null;
  lineas: LineaCompraParaAsiento[];
}

export type ResultadoAsientoCompra =
  | { ok: true; asiento: AsientoInput }
  | { ok: false; motivo: string; mensaje: string };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** La NATURALEZA de la operación (Art. 5.5). */
export function descripcionDelAsientoDeCompra(c: CompraParaAsiento): string {
  return c.supplier_name
    ? `Compra ${c.description} — ${c.supplier_name}`
    : `Compra ${c.description}`;
}

/**
 * La clave de idempotencia.
 *
 * 🔑 Segunda llave, no la primera. La garantía es el UNIQUE parcial
 * `(tenant_id, source_type, source_id)` de la `034`, que con
 * `source_type='gasto'` + `source_id = compra.id` ya impide el duplicado. Ésta
 * sale del mismo id, así que no pueden discrepar.
 */
export function claveIdempotenteDeCompra(compraId: string): string {
  return `compra:${compraId}`;
}

/**
 * Arma el asiento de una compra.
 *
 * ⚠️ Lo que NO valida, porque lo valida el RPC y duplicarlo crearía dos
 * verdades: que el período esté abierto y que las cuentas existan en la base. El
 * cuadre aritmético sí, como red contra un error de redondeo de este archivo.
 */
export function construirAsientoDeCompra(
  c: CompraParaAsiento
): ResultadoAsientoCompra {
  if (c.lineas.length === 0) {
    return {
      ok: false,
      motivo: "sin_lineas",
      mensaje:
        `La compra "${c.description}" no tiene líneas, así que no se puede saber ` +
        `contra qué cuentas registrarla.`,
    };
  }

  // ---- 1) Líneas sin cuenta ------------------------------------------------
  const sinCuenta = c.lineas.filter((l) => !l.chart_account_code);
  if (sinCuenta.length > 0) {
    const detalle = sinCuenta
      .map((l) => `línea ${l.line_order} ("${l.description}")`)
      .join(", ");
    return {
      ok: false,
      motivo: "sin_cuenta",
      mensaje:
        `No se puede registrar la compra "${c.description}" en el libro contable: ` +
        `${detalle} ${sinCuenta.length === 1 ? "no tiene" : "no tienen"} cuenta contable. ` +
        `Asigne una cuenta a cada línea antes de guardar.`,
    };
  }

  // ---- 2) Cuentas inválidas en el plan vigente -----------------------------
  // 🔴 El mensaje NOMBRA la línea y la cuenta. El RPC también rechaza esto
  //    (paso 4: `AND c.active` dentro del EXISTS) pero su mensaje solo dice el
  //    código. Este guard existe por el MENSAJE, no por el permiso.
  const invalidas = c.lineas.filter((l) => !l.cuenta_valida);
  if (invalidas.length > 0) {
    const detalle = invalidas
      .map((l) => `línea ${l.line_order} → cuenta ${l.chart_account_code}`)
      .join(", ");
    return {
      ok: false,
      motivo: "cuenta_invalida",
      mensaje:
        `No se puede registrar la compra "${c.description}" en el libro contable: ` +
        `${detalle} ${invalidas.length === 1 ? "apunta" : "apuntan"} a una cuenta que no ` +
        `existe, está inactiva, o no admite un desembolso en el plan de cuentas vigente. ` +
        `Corrija la cuenta de la línea antes de guardar.`,
    };
  }

  // ---- 3) Agrupar los débitos POR CUENTA -----------------------------------
  // Dos líneas pueden apuntar a la misma cuenta. Una línea de asiento por
  // cuenta: el mayor de esa cuenta se lee mejor y el asiento no crece con el
  // detalle de la compra.
  const porCuenta = new Map<string, number>();
  for (const l of c.lineas) {
    const cuenta = l.chart_account_code as string;
    porCuenta.set(cuenta, round2((porCuenta.get(cuenta) ?? 0) + l.amount));
  }

  const itbms = round2(c.lineas.reduce((s, l) => s + l.tax_amount, 0));
  const haber = round2(c.total);

  const lines: LineaAsiento[] = [];
  for (const [cuenta, monto] of Array.from(porCuenta.entries()).sort()) {
    if (monto === 0) continue;
    lines.push({ account_code: cuenta, debit: monto, credit: 0, description: null });
  }
  if (itbms > 0) {
    lines.push({
      account_code: CUENTA_ITBMS,
      debit: itbms,
      credit: 0,
      description: "ITBMS de compras (crédito fiscal)",
    });
  }
  lines.push({
    account_code: CUENTA_POR_PAGAR,
    debit: 0,
    credit: haber,
    description: c.supplier_name,
  });

  // ---- 4) Red contra un error de redondeo DE ESTE ARCHIVO ------------------
  const sumaDebitos = round2(lines.reduce((s, l) => s + l.debit, 0));
  if (sumaDebitos !== haber) {
    return {
      ok: false,
      motivo: "no_cuadra",
      mensaje:
        `La compra "${c.description}" no cuadra: el total es ${haber.toFixed(2)} ` +
        `pero las líneas suman ${sumaDebitos.toFixed(2)} ` +
        `(diferencia ${round2(haber - sumaDebitos).toFixed(2)}). ` +
        `No se registró nada en el libro contable.`,
    };
  }

  return {
    ok: true,
    asiento: {
      transaction_date: c.expense_date,
      description: descripcionDelAsientoDeCompra(c),
      source_type: SOURCE_TYPE_COMPRA,
      lines,
      source_id: c.id,
      idempotency_key: claveIdempotenteDeCompra(c.id),
    },
  };
}
