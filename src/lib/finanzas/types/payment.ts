/**
 * Tipos compartidos del módulo Finanzas — pagos.
 *
 * El schema modela payments + payment_applications (N:M pago↔factura).
 * Para el MVP del Sprint 2C, la UI registra UN pago aplicado al 100%
 * contra UNA factura: el concepto payment_applications queda oculto al
 * usuario. La estructura DB ya soporta multi-factura si en el futuro
 * se requiere una pantalla específica.
 *
 * Convenciones:
 *   - method y status en BD son TEXT con CHECK; acá los modelamos como
 *     union types para safety client-side.
 *   - Montos como `string` cuando vienen de Supabase (NUMERIC se serializa
 *     así vía REST API). Convertir a number con Number() antes de operar.
 */

export type PaymentMethod =
  | "efectivo"
  | "transferencia"
  | "cheque"
  | "tarjeta"
  | "ach"
  | "otro";

export type PaymentStatus = "registrado" | "conciliado" | "anulado";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
  tarjeta: "Tarjeta",
  ach: "ACH",
  otro: "Otro",
};

export const PAYMENT_METHODS: PaymentMethod[] = [
  "efectivo",
  "transferencia",
  "cheque",
  "tarjeta",
  "ach",
  "otro",
];

// ---------- Inputs --------------------------------------------------------

/** Cuánto del cobro se aplica a UNA factura. */
export interface PaymentApplicationInput {
  invoice_id: string;
  amount: number;
}

/**
 * Payload para registrar un cobro (recibo de caja) aplicado a una o varias
 * facturas del MISMO cliente (Parte B, 21/09/2026 — Josuarth: "sí hace falta
 * poder pagar varias facturas con una sola transferencia").
 *
 * `amount` es el total de la transferencia y tiene que ser IGUAL a la suma de
 * `applications`: un excedente sin aplicar se rechaza hasta que el bufete
 * defina dónde va (`amount_unapplied` queda para ese día, ver task_plan.md).
 */
export interface CreatePaymentInput {
  /**
   * 🔴 La cuenta del plan donde ENTRÓ la plata (migración `041`).
   *
   * Obligatoria: la elige quien registra, sin default. Rose, 25/08. La columna
   * es NULLABLE en la base solo por los cobros anteriores a la `041`; para uno
   * nuevo, `createPayment` la exige y el formulario también.
   */
  payment_account_code: string | null;
  /** Una o varias, sin repetir. Cada monto > 0 y ≤ al saldo de su factura. */
  applications: PaymentApplicationInput[];
  payment_date: string; // YYYY-MM-DD
  /** Total del cobro = suma de `applications`. */
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
}

// ---------- API row shapes ------------------------------------------------

/** Pago tal como vive en la tabla payments. */
export interface PaymentRow {
  id: string;
  payment_number: string | null;
  client_id: string;
  payment_date: string;
  amount: string | number;
  amount_unapplied: string | number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  status: PaymentStatus;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

/**
 * El asiento del cobro, si ya está en el libro. Es lo que se reversa, y lo que
 * la vista previa de la reversión refleja línea por línea.
 */
export interface AsientoDeCobro {
  id: string;
  entry_number: number;
  /** ISO `YYYY-MM-DD`. */
  transaction_date: string;
  description: string;
  reference: string | null;
  lines: {
    account_code: string;
    account_name: string;
    debit: number;
    credit: number;
    description: string | null;
  }[];
}

/** Cómo y por qué se reversó un cobro. Sale de `payment_reversals` (046). */
export interface ReversionDeCobro {
  /** El asiento espejo. */
  entry_number: number;
  /** El asiento del cobro que se revirtió. */
  reversed_entry_number: number;
  reason: string;
  reversed_at: string;
  reversed_by_name: string | null;
}

/**
 * Pago + datos del usuario que lo registró + monto aplicado a UNA factura
 * específica. Lo devuelve getPaymentsForInvoice.
 *
 * Desde el 17/09/2026 incluye también los cobros REVERSADOS (`status =
 * 'anulado'` con `reversion` cargada): al reversar se borran sus
 * `payment_applications`, así que ya no se los encuentra por ahí; se los
 * encuentra por `payment_reversals`. Sin esto, un cobro reversado desaparecía
 * de la pantalla como si nunca hubiera existido.
 */
export interface PaymentForInvoice extends PaymentRow {
  /** Monto aplicado a esta factura (puede ser != amount si en el futuro
   *  se permite split multi-factura). En el MVP siempre = amount. */
  amount_applied: string | number;
  /** Nombre completo del usuario que registró el pago, o null. */
  created_by_name: string | null;
  /** El asiento del cobro, o null si todavía no está en el libro. */
  asiento: AsientoDeCobro | null;
  /** Si el cobro fue reversado, cómo. Null en los vigentes. */
  reversion: ReversionDeCobro | null;
}

/**
 * Una fila del LISTADO de cobros (`/finanzas/cobros`, Bloque 2). A diferencia
 * de `PaymentForInvoice` no está parada sobre una factura: trae al cliente y a
 * la(s) factura(s) a las que se aplicó — hoy una, el modelo admite varias.
 */
export interface PaymentListItem extends PaymentRow {
  client_name: string;
  client_number: string | null;
  /** Las facturas aplicadas (o, si está reversado, las que tenía aplicadas). */
  facturas: { invoice_id: string; invoice_number: string; amount_applied: number }[];
  created_by_name: string | null;
  asiento: AsientoDeCobro | null;
  reversion: ReversionDeCobro | null;
}

/** Una factura a la que se le puede registrar un cobro (alta de `/finanzas/cobros/nuevo`). */
export interface InvoiceCobrable {
  id: string;
  invoice_number: string;
  invoice_kind: string;
  client_id: string;
  client_name: string;
  client_number: string | null;
  issue_date: string;
  due_date: string | null;
  status: "emitida" | "parcialmente_pagada";
  grand_total: number;
  amount_paid: number;
  balance_due: number;
}

