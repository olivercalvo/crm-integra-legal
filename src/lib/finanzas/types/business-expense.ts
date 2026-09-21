/**
 * Tipos compartidos del módulo Finanzas — gastos del bufete.
 *
 * Convenciones:
 *   - status y payment_method en BD son strings con CHECK constraint, no enums.
 *     Acá los modelamos como union types para safety client-side.
 *   - Montos como `string | number` cuando vienen de Supabase (NUMERIC se
 *     serializa así vía REST API). Convertir a number con Number() antes de
 *     operar.
 *   - tax_rate viene de BD en formato decimal (0.0700 = 7%). El form lo
 *     muestra como porcentaje pero internamente siempre se maneja decimal.
 *
 * Diferencia con la tabla `expenses` (módulo Legal):
 *   - business_expenses = compras propias del bufete (alquiler, oficina,
 *     servicios) donde el ITBMS pagado es crédito fiscal recuperable.
 *   - expenses = adelantos al cliente (tasas, peritos, mensajería judicial)
 *     reembolsables vía facturas REI. No generan crédito fiscal.
 */

// ---------- Status / payment_method / tax_rate ----------------------------

/** Valores válidos de business_expenses.status. */
/**
 * Desde la 048 lo DERIVA el trigger de `supplier_payments`; no se escribe a
 * mano. En el alta, `status: "pagado"` es la intención "registrar el pago al
 * crear", no un valor que se inserte.
 */
export type BusinessExpenseStatus = "pendiente_pago" | "parcialmente_pagado" | "pagado";

/** Valores válidos de business_expenses.payment_method (cuando no es NULL). */
export type BusinessExpensePaymentMethod =
  | "efectivo"
  | "transferencia"
  | "tarjeta"
  | "cheque"
  | "otro";

/**
 * Whitelist de tasas ITBMS aceptadas en Panamá (decimal). El CHECK de BD
 * acepta cualquier valor en [0, 1] para future-proof; la aplicación enforza
 * este subset.
 */
export const VALID_TAX_RATES = [0, 0.07, 0.10, 0.15] as const;
export type BusinessExpenseTaxRate = (typeof VALID_TAX_RATES)[number];

// ---------- Row shapes ----------------------------------------------------

/** Fila completa de business_expenses tal como viene del SELECT. */
export interface BusinessExpenseRow {
  id: string;
  tenant_id: string;
  expense_date: string;            // YYYY-MM-DD
  /**
   * Vencimiento del gasto. Default = expense_date + plazo del proveedor,
   * editable. Es la fecha con la que la antigüedad calcula los tramos; antes de
   * que existiera, se contaban desde expense_date y salían más pesimistas.
   */
  due_date: string | null;
  /** Proveedor como entidad (migración 033). NULLABLE: los viejos no lo tienen. */
  supplier_id: string | null;
  /**
   * ⚠️ RESPALDO de la migración 033, no la fuente de verdad.
   * El proveedor real es `supplier_id`. Estas dos columnas quedan hasta
   * verificar que nada se perdió; eliminarlas es un commit posterior.
   */
  supplier_name: string | null;
  supplier_ruc: string | null;
  /**
   * Número del comprobante del proveedor que respalda la compra
   * (migración `044`). Opcional: hay desembolsos sin factura numerada
   * —recibos, vales de caja chica—, y exigirlo dejaría esos gastos sin
   * poder cargarse. Se valida el LARGO, nunca el formato.
   */
  supplier_invoice_number: string | null;
  chart_account_code: string | null;
  description: string;
  subtotal: string | number;       // NUMERIC(12,2) → string vía REST
  tax_rate: string | number;       // NUMERIC(5,4)
  tax_amount: string | number;
  total: string | number;          // GENERATED ALWAYS AS (subtotal + tax_amount)
  status: BusinessExpenseStatus;
  payment_date: string | null;
  payment_method: BusinessExpensePaymentMethod | null;
  receipt_url: string | null;
  receipt_filename: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Snapshot del proveedor para el listado y el detalle. */
export interface SupplierSnapshot {
  id: string;
  supplier_number: string;
  legal_name: string;
  trade_name: string | null;
  payment_terms_days: number;
}

/** Snapshot mínimo de la cuenta contable para joins. */
export interface ChartAccountSnapshot {
  code: string;
  name: string;
}

/** Item del listado con join al chart_of_accounts para mostrar el nombre. */
export interface BusinessExpenseListItem extends BusinessExpenseRow {
  account: ChartAccountSnapshot | null;
  supplier: SupplierSnapshot | null;
}

/**
 * El nombre del proveedor a mostrar.
 *
 * Prioriza la entidad y cae al texto libre viejo solo si el gasto no está
 * enlazado. Así, un gasto migrado muestra EXACTAMENTE lo mismo que mostraba
 * antes de la migración 033.
 */
export function nombreProveedorDeGasto(
  g: Pick<BusinessExpenseListItem, "supplier" | "supplier_name">
): string | null {
  if (g.supplier) {
    return g.supplier.trade_name?.trim() || g.supplier.legal_name;
  }
  return g.supplier_name;
}

/**
 * Una línea de compra tal como la muestra el DETALLE: la fila de
 * `expense_lines` más el nombre de su cuenta y de su código de impuesto.
 */
export interface LineaDeCompraDetalle {
  id: string;
  line_order: number;
  description: string;
  chart_account_code: string | null;
  chart_account_name: string | null;
  amount: number;
  /** FK a `tax_codes` (migración `045`). Nunca NULL en una línea de compra. */
  tax_code_id: string | null;
  /** `tax_codes.name`, p. ej. "ITBMS 7%" o "Exento". */
  tax_code_name: string | null;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
}

/** Detalle completo: el list item más quién lo registró y sus líneas. */
export interface BusinessExpenseWithDetails extends BusinessExpenseListItem {
  /** Nombre completo del usuario que registró el gasto (denormalizado). */
  created_by_name: string | null;
  /**
   * Las líneas, en orden. Es lo que permite ver, en una compra mixta, qué
   * renglón fue gravado y cuál exento: el encabezado solo tiene la suma.
   */
  lineas: LineaDeCompraDetalle[];
}

// ---------- Input shapes --------------------------------------------------

/** Payload de creación. */
/**
 * Una línea de compra tal como llega del formulario.
 *
 * Espeja `expense_lines`, que desde la `036` cuelga de un gasto de trámite **o**
 * de una compra por arco exclusivo. Es la misma tabla: por eso una compra no
 * necesitó esquema nuevo.
 */
export interface LineaDeCompraInput {
  description: string;
  /** 🔑 Obligatoria. `null` se rechaza en el servidor, no solo en la pantalla. */
  chart_account_code: string | null;
  /** Base imponible de la línea. */
  amount: number;
  /**
   * 🔑 Obligatorio (migración `045`): el id del código de `tax_codes` elegido.
   * El servidor lo resuelve contra el catálogo —tenant, activo— y escribe la
   * tasa DEL CATÁLOGO. `tax_rate` viaja para que la pantalla muestre el total
   * sin esperar la respuesta, pero el servidor no le cree.
   */
  tax_code_id: string;
  tax_rate: number;
  tax_amount: number;
}

export interface CreateBusinessExpenseInput {
  expense_date: string;            // YYYY-MM-DD
  /**
   * Vencimiento del gasto. Default = expense_date + plazo del proveedor,
   * editable. Es la fecha con la que la antigüedad calcula los tramos; antes de
   * que existiera, se contaban desde expense_date y salían más pesimistas.
   */
  due_date: string | null;
  /** Proveedor como entidad (migración 033). NULLABLE: los viejos no lo tienen. */
  supplier_id: string | null;
  /**
   * ⚠️ RESPALDO de la migración 033, no la fuente de verdad.
   * El proveedor real es `supplier_id`. Estas dos columnas quedan hasta
   * verificar que nada se perdió; eliminarlas es un commit posterior.
   */
  supplier_name: string | null;
  supplier_ruc: string | null;
  /**
   * Número del comprobante del proveedor que respalda la compra
   * (migración `044`). Opcional: hay desembolsos sin factura numerada
   * —recibos, vales de caja chica—, y exigirlo dejaría esos gastos sin
   * poder cargarse. Se valida el LARGO, nunca el formato.
   */
  supplier_invoice_number: string | null;
  // 🔴 `chart_account_code` YA NO ESTÁ EN EL INPUT. La cuenta vive en
  //    `expense_lines.chart_account_code`, una por línea (migración `040`), y un
  //    CHECK fuerza la columna del encabezado a NULL. Sacarlo del tipo —en vez
  //    de dejarlo deprecado— es lo que hace que el compilador señale a cada
  //    lugar que todavía lo mandaba, uno por uno, en vez de dejarlos compilar
  //    mandando un dato que se ignora en silencio.
  /**
   * Las líneas de la compra. **Obligatorias y con cuenta**: una compra sin
   * líneas no se puede registrar en el libro, y una línea sin cuenta no se
   * puede imputar. Lo valida `validarLineasDeCompra()` y, en la base, el CHECK
   * `expense_lines_cuenta_obligatoria` de la `037`.
   */
  lineas: LineaDeCompraInput[];
  description: string;
  /** Σ de `lineas[].amount`. Lo calcula el SERVIDOR, no llega del cliente. */
  subtotal: number;
  tax_rate: number;                // decimal (0.07 = 7%)
  /** Σ de `lineas[].tax_amount`. Lo calcula el SERVIDOR. */
  tax_amount: number;
  /**
   * En el ALTA: `"pagado"` = "registrar el pago al crear" (exige
   * `payment_account_code`); `"pendiente_pago"` = solo la compra. En el UPDATE
   * se ignora: el estado lo derivan los pagos (048).
   */
  status: BusinessExpenseStatus;
  payment_date: string | null;
  payment_method: BusinessExpensePaymentMethod | null;
  /** El banco de donde salió el pago, cuando el alta dice "pagado". Bloque 3. */
  payment_account_code?: string | null;
  notes: string | null;
}

/** Payload de actualización. Mismos campos que create. */
export type UpdateBusinessExpenseInput = CreateBusinessExpenseInput;

// ---------- UI labels -----------------------------------------------------

export const BUSINESS_EXPENSE_STATUS_LABEL: Record<BusinessExpenseStatus, string> = {
  pendiente_pago: "Pendiente de pago",
  parcialmente_pagado: "Parcialmente pagado",
  pagado: "Pagado",
};

export const BUSINESS_EXPENSE_PAYMENT_METHOD_LABEL: Record<BusinessExpensePaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cheque: "Cheque",
  otro: "Otro",
};

export const TAX_RATE_LABEL: Record<string, string> = {
  "0": "Exento (0%)",
  "0.07": "7%",
  "0.1": "10%",
  "0.15": "15%",
};

/**
 * EL SELECTOR DE IMPUESTO DE UNA LÍNEA SALE DE `tax_codes`, COMO EN FACTURACIÓN.
 *
 * Hasta el 16/09/2026 acá vivía `OPCIONES_DE_IMPUESTO`, una lista fija armada
 * desde `VALID_TAX_RATES`, porque `expense_lines` guardaba solo `tax_rate` (un
 * decimal) y no había dónde anotar CUÁL código se eligió. Dos consecuencias:
 * si Rose cambiaba la tasa en Configuración → Impuestos, compras no la seguía;
 * y `EXENTO` e `ITBMS_0` (los dos con tasa 0) eran indistinguibles.
 *
 * Desde la migración `045` la línea tiene `tax_code_id`, el editor usa el
 * MISMO `TaxCodeSelect` que las facturas con los códigos cargados de la base
 * (`listTaxCodesActive`), y el servidor resuelve la tasa contra el catálogo.
 * `VALID_TAX_RATES` queda solo para normalizar la tasa del ENCABEZADO, que es
 * un derivado (ver `derivarTasaDeCabecera` en `validators/business-expense.ts`).
 */

/** Convierte un tax_rate decimal a su label legible. */
export function taxRateLabel(rate: number): string {
  // Normalizamos a string sin ceros finales (0.10 → "0.1") para matchear keys.
  const key = String(Number(rate));
  return TAX_RATE_LABEL[key] ?? `${(rate * 100).toFixed(2)}%`;
}

// ---------- Helpers de cálculo --------------------------------------------

/**
 * Calcula tax_amount esperado dado subtotal + rate. Redondeo a 2 decimales
 * como hace NUMERIC(12,2). Usado por el form para auto-fill y por el
 * validator para verificar coherencia con tolerancia.
 */
export function computeExpectedTaxAmount(subtotal: number, taxRate: number): number {
  const raw = subtotal * taxRate;
  return Math.round(raw * 100) / 100;
}

/** Calcula el total esperado. La BD lo calcula también vía GENERATED. */
export function computeTotal(subtotal: number, taxAmount: number): number {
  return Math.round((subtotal + taxAmount) * 100) / 100;
}
