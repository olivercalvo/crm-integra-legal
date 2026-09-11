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
export type BusinessExpenseStatus = "pendiente_pago" | "pagado";

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

/** Detalle completo. Hoy igual al list item; se separa por extensibilidad. */
export interface BusinessExpenseWithDetails extends BusinessExpenseListItem {
  /** Nombre completo del usuario que registró el gasto (denormalizado). */
  created_by_name: string | null;
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
  status: BusinessExpenseStatus;
  payment_date: string | null;
  payment_method: BusinessExpensePaymentMethod | null;
  notes: string | null;
}

/** Payload de actualización. Mismos campos que create. */
export type UpdateBusinessExpenseInput = CreateBusinessExpenseInput;

/** Payload para markAsPaid (atajo de status). */
export interface MarkAsPaidInput {
  payment_date: string;            // YYYY-MM-DD, requerido
  payment_method: BusinessExpensePaymentMethod | null;
}

// ---------- UI labels -----------------------------------------------------

export const BUSINESS_EXPENSE_STATUS_LABEL: Record<BusinessExpenseStatus, string> = {
  pendiente_pago: "Pendiente de pago",
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
 * Las opciones del SELECTOR de impuesto de una línea de gasto.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ NO SON LOS `tax_codes` DE FACTURACIÓN
 * ═════════════════════════════════════════════════════════════════════════════
 * Josuarth pidió el 10/09/2026 que el campo se vea igual que en facturación:
 * un desplegable con «ITBMS 7% (7.0%)», no un campo numérico con «0.07», que
 * es un número de programador.
 *
 * El desplegable es el mismo. Lo que **no** se puede compartir es la fuente:
 * `invoice_lines` guarda `tax_code_id` —una FK a `tax_codes`— y
 * **`expense_lines` guarda `tax_rate`, un decimal**. No hay columna donde
 * anotar CUÁL código se eligió.
 *
 * ⚠️ Consecuencia concreta: en `tax_codes` conviven `EXENTO` e `ITBMS_0`, los
 *    dos con tasa 0. Un gasto no puede distinguirlos —los dos se guardarían
 *    como `0`— así que acá se ofrece una sola opción para la tasa cero. Para
 *    separar «exento» de «gravado al 0%» en compras hace falta agregarle
 *    `tax_code_id` a `expense_lines`: es una migración con su backfill y toca
 *    el resumen de ITBMS. Queda anotado, no escondido.
 *
 * Las tasas salen de `VALID_TAX_RATES`, que es lo que el validador acepta: el
 * selector no puede ofrecer algo que después se rechace.
 */
export interface OpcionDeImpuesto {
  /** El valor que se guarda en `expense_lines.tax_rate`. */
  rate: number;
  /** Lo que se lee en el desplegable, con el formato de facturación. */
  label: string;
}

export const OPCIONES_DE_IMPUESTO: OpcionDeImpuesto[] = VALID_TAX_RATES.map((rate) => ({
  rate,
  label:
    rate === 0
      ? "Exento (0%)"
      : `ITBMS ${+(rate * 100).toFixed(2)}% (${(rate * 100).toFixed(1)}%)`,
}));

/**
 * La opción que corresponde a una tasa guardada.
 *
 * Compara por NÚMERO y no por texto: de la base la tasa vuelve como `"0.0700"`
 * y del formulario como `"0.07"`. Son el mismo impuesto.
 */
export function opcionDeImpuestoDe(rate: string | number): OpcionDeImpuesto | null {
  const n = typeof rate === "number" ? rate : Number(String(rate).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return OPCIONES_DE_IMPUESTO.find((o) => Math.abs(o.rate - n) < 1e-9) ?? null;
}

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
