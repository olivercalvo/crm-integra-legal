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

/**
 * Payload para registrar un pago contra UNA factura específica. El monto
 * se aplica completo (createPayment crea el payment + la application en la
 * misma operación lógica).
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
  invoice_id: string;
  payment_date: string; // YYYY-MM-DD
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
 * Pago + datos del usuario que lo registró + monto aplicado a UNA factura
 * específica. Lo devuelve getPaymentsForInvoice.
 */
export interface PaymentForInvoice extends PaymentRow {
  /** Monto aplicado a esta factura (puede ser != amount si en el futuro
   *  se permite split multi-factura). En el MVP siempre = amount. */
  amount_applied: string | number;
  /** Nombre completo del usuario que registró el pago, o null. */
  created_by_name: string | null;
}
