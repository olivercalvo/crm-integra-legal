/**
 * TESORERÍA → ASIENTO. Filas 15 y 16 del acta del 25/08.
 *
 * Dos movimientos simétricos, los dos contra un banco:
 *
 *   COBRO de una factura     DEBE  el banco / HABER 100004 Cuentas por Cobrar
 *   PAGO a un proveedor      DEBE  200001 Cuentas por pagar / HABER el banco
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EL BANCO LO ELIGE QUIEN REGISTRA. NO HAY DEFAULT. NUNCA.
 * ═════════════════════════════════════════════════════════════════════════════
 * Rose, reunión del 25/08: **"el banco del cobro lo escoge quien registra"**.
 *
 * Hay tres bancos activos y no son intercambiables:
 *
 *   · `100001 Banco General Operativa`        — la plata del bufete
 *   · `100002 Banco General Inversiones`
 *   · `100003 Banco General Saldo Clientes`   — plata que NO es del bufete
 *
 * Ese tercero es el motivo por el que un default sería peligroso y no solo
 * impreciso: mandar a la operativa un cobro que en realidad entró a la cuenta de
 * saldos de clientes dice que el bufete cobró algo que está reteniendo. Y el
 * asiento es inmutable.
 *
 * Por eso, un cobro o un pago **sin banco no se postea**, y el rechazo lo nombra.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ⚠️ DOS FAMILIAS DE RUTAS QUE SE LLAMAN CASI IGUAL — NO CONFUNDIRLAS
 * ═════════════════════════════════════════════════════════════════════════════
 * Esto es lo más fácil de romper de todo el bloque, así que va acá arriba:
 *
 *   ✅ `payments` (módulo FINANZAS) — el cobro de una FACTURA.
 *      Rutas: `/api/finanzas/invoices/[id]/payments`, `/api/finanzas/payments/[id]`.
 *      Helper: `api/payments.ts`. **ESTO SÍ POSTEA**, y es lo que arma este módulo.
 *
 *   🔴 `client_payments` (módulo LEGAL) — el cobro a nivel CASO.
 *      Rutas: `/api/payments`, `/api/payments/[id]`.
 *      **ESTO NO POSTEA, Y NO DEBE.** No tiene ninguna columna contable, no tiene
 *      banco, y no representa un hecho contable del bufete: es el registro
 *      interno de lo que un cliente entregó a cuenta de un caso. Lo contable es
 *      la FACTURA y su cobro.
 *
 * Los nombres de ruta se diferencian en un `/finanzas`. Si alguna vez alguien
 * "unifica los pagos", esta distinción es lo primero que se pierde, y el síntoma
 * sería un libro contable que cobra dos veces la misma plata.
 *
 * Módulo PURO: sin I/O, sin React, sin Supabase.
 */

import type { AsientoInput, LineaAsiento } from "@/lib/finanzas/contabilidad/posting";

/** Cuenta control de clientes. El cobro la acredita. */
export const CUENTA_POR_COBRAR = "100004";

/** Cuenta control de proveedores. El pago la debita. */
export const CUENTA_POR_PAGAR = "200001";

/** `source_type` del asiento de un cobro. Ya existía en el CHECK. */
export const SOURCE_TYPE_COBRO = "pago" as const;

/**
 * `source_type` del asiento de un pago a proveedor. Lo agrega la migración `042`.
 *
 * 🔴 **NO reusa `pago`, y el motivo no es de prolijidad.** El UNIQUE de la `034`
 * no habría chocado —el `source_id` sería el id de una COMPRA, otro uuid— pero
 * `destino-documento.ts:50` mapea `pago → /finanzas/facturas/{id}` porque un
 * cobro vive en el detalle de la factura que canceló. Un pago a proveedor con
 * ese tipo mandaría al contador a una factura que no existe.
 *
 * El propio `destino-documento.ts` ya argumentó este caso exacto para
 * `gasto_tramite` vs `gasto`, y lo llamó "el bug del 01/09 reintroducido un
 * módulo más adelante". Es la misma situación una tabla después.
 */
export const SOURCE_TYPE_PAGO_PROVEEDOR = "pago_proveedor" as const;

/** Los tres bancos son cuentas de activo; cualquier cuenta de activo sirve. */
export interface CuentaDeBanco {
  code: string;
  name: string;
  account_type: string;
  active: boolean;
}

/**
 * ¿Esta cuenta puede recibir o entregar plata?
 *
 * Tiene que ser un ACTIVO activo. No se restringe a los tres bancos conocidos
 * por código: el bufete puede abrir una cuenta nueva y el plan de cuentas es el
 * que manda. **La lista que se ofrece en pantalla y el guard del servidor tienen
 * sesgos opuestos** (SOP-024 regla 3): la lista es corta y opinada, el guard
 * rechaza solo lo imposible.
 */
export function esCuentaDeBancoValida(c: CuentaDeBanco | null | undefined): boolean {
  return !!c && c.active && c.account_type === "asset";
}

// ---------------------------------------------------------------------------
// COBRO DE UNA FACTURA
// ---------------------------------------------------------------------------

export interface CobroParaAsiento {
  id: string;
  /** `REC-000012`. Es la referencia del asiento (Parte B, 21/09/2026). */
  payment_number: string | null;
  payment_date: string;
  amount: number;
  client_name: string | null;
  /** Los números de las facturas a las que se aplicó. Para la descripción. */
  facturas: string[];
  /** `payments.payment_account_code`. `null` en los cobros anteriores a la `041`. */
  payment_account_code: string | null;
  /** ¿Ese código es una cuenta de activo activa? Lo resuelve quien lee la base. */
  banco_valido: boolean;
}

export type ResultadoAsientoTesoreria =
  | { ok: true; asiento: AsientoInput }
  | { ok: false; motivo: string; mensaje: string };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function claveIdempotenteDeCobro(paymentId: string): string {
  return `cobro:${paymentId}`;
}

export function claveIdempotenteDePagoProveedor(compraId: string): string {
  return `pago-proveedor:${compraId}`;
}

/**
 * Arma el asiento de un cobro.
 *
 *   DEBE  el banco elegido     (entra plata)
 *   HABER 100004 Cuentas por Cobrar Clientes  (baja lo que nos debían)
 *
 * ⚠️ El asiento NO toca la factura ni su `amount_paid`: eso lo deriva el trigger
 * T7a desde `payment_applications`, y escribirlo a mano está prohibido (CLAUDE.md).
 * Acá solo se registra el hecho contable.
 */
export function construirAsientoDeCobro(
  c: CobroParaAsiento
): ResultadoAsientoTesoreria {
  if (!c.payment_account_code) {
    return {
      ok: false,
      motivo: "sin_banco",
      mensaje:
        `Este cobro no dice a qué cuenta bancaria entró la plata, así que no se puede ` +
        `registrar en el libro contable. Elija el banco: es un dato que no se puede ` +
        `deducir, porque el bufete tiene una cuenta operativa y una de saldos de ` +
        `clientes, y no significan lo mismo.`,
    };
  }
  if (!c.banco_valido) {
    return {
      ok: false,
      motivo: "banco_invalido",
      mensaje:
        `La cuenta ${c.payment_account_code} no existe, está inactiva, o no es una ` +
        `cuenta de activo en el plan vigente, así que no puede recibir un cobro. ` +
        `Elija una cuenta bancaria activa.`,
    };
  }

  const monto = round2(c.amount);
  if (monto <= 0) {
    return {
      ok: false,
      motivo: "monto_invalido",
      mensaje: `El cobro tiene que ser mayor que cero (llegó ${monto.toFixed(2)}).`,
    };
  }

  const facturas = c.facturas.length > 0 ? c.facturas.join(", ") : "sin aplicar";
  const quien = c.client_name ? ` — ${c.client_name}` : "";

  const lines: LineaAsiento[] = [
    {
      account_code: c.payment_account_code,
      debit: monto,
      credit: 0,
      description: `Cobro ${facturas}`,
    },
    { account_code: CUENTA_POR_COBRAR, debit: 0, credit: monto, description: c.client_name },
  ];

  return {
    ok: true,
    asiento: {
      transaction_date: c.payment_date,
      description: `Cobro de ${facturas}${quien}`,
      source_type: SOURCE_TYPE_COBRO,
      lines,
      source_id: c.id,
      // La referencia es el RECIBO, no "la primera factura": con varias
      // facturas la primera es arbitraria y el recibo es el documento real del
      // asiento. Verificado el 21/09/2026 que ningún reporte leía acá un
      // número de factura (task_plan.md, Parte B, precisión 2). Los cobros de
      // antes de la 047 (sin número) caen a la factura, como siempre.
      reference: c.payment_number ?? c.facturas[0] ?? null,
      idempotency_key: claveIdempotenteDeCobro(c.id),
    },
  };
}

// ---------------------------------------------------------------------------
// PAGO A UN PROVEEDOR
// ---------------------------------------------------------------------------

export interface PagoProveedorParaAsiento {
  /** El id de la COMPRA. No hay tabla de pagos a proveedor — ver el encabezado. */
  compra_id: string;
  payment_date: string;
  total: number;
  description: string;
  supplier_name: string | null;
  /** `business_expenses.payment_account_code`, que existe desde la `036`. */
  payment_account_code: string | null;
  banco_valido: boolean;
}

/**
 * Arma el asiento de un pago a proveedor.
 *
 *   DEBE  200001 Cuentas por pagar  (baja lo que debíamos)
 *   HABER el banco elegido          (sale plata)
 *
 * ⚠️ **No hay tabla de pagos a proveedor**, y es una decisión de alcance, no un
 * olvido. El pago se modela como un cambio de estado de la COMPRA
 * (`markBusinessExpenseAsPaid`), así que:
 *
 *   · Solo existe el pago TOTAL de una compra. No hay pago parcial, ni un pago
 *     que salde tres compras, ni anticipos a proveedor.
 *   · El `source_id` del asiento es el id de la COMPRA, no de un pago.
 *
 * El acta no pide ninguna de las tres cosas que faltan (pide el módulo de
 * *recibir* pago y los cobros parciales, los dos del lado del cliente). El día
 * que haga falta, esto se migra a una tabla propia igual que la cuenta de la
 * compra se migró a `expense_lines`.
 */
export function construirAsientoDePagoProveedor(
  p: PagoProveedorParaAsiento
): ResultadoAsientoTesoreria {
  if (!p.payment_account_code) {
    return {
      ok: false,
      motivo: "sin_banco",
      mensaje:
        `Para marcar esta compra como pagada hace falta decir de qué cuenta bancaria ` +
        `salió la plata: es lo que el asiento acredita, y no se puede deducir.`,
    };
  }
  if (!p.banco_valido) {
    return {
      ok: false,
      motivo: "banco_invalido",
      mensaje:
        `La cuenta ${p.payment_account_code} no existe, está inactiva, o no es una ` +
        `cuenta de activo en el plan vigente, así que no puede pagar. Elija una ` +
        `cuenta bancaria activa.`,
    };
  }

  const monto = round2(p.total);
  if (monto <= 0) {
    return {
      ok: false,
      motivo: "monto_invalido",
      mensaje: `El pago tiene que ser mayor que cero (llegó ${monto.toFixed(2)}).`,
    };
  }

  const quien = p.supplier_name ? ` — ${p.supplier_name}` : "";

  const lines: LineaAsiento[] = [
    {
      account_code: CUENTA_POR_PAGAR,
      debit: monto,
      credit: 0,
      description: p.supplier_name,
    },
    {
      account_code: p.payment_account_code,
      debit: 0,
      credit: monto,
      description: `Pago ${p.description}`,
    },
  ];

  return {
    ok: true,
    asiento: {
      transaction_date: p.payment_date,
      description: `Pago a proveedor: ${p.description}${quien}`,
      source_type: SOURCE_TYPE_PAGO_PROVEEDOR,
      lines,
      source_id: p.compra_id,
      idempotency_key: claveIdempotenteDePagoProveedor(p.compra_id),
    },
  };
}
