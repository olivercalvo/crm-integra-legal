/**
 * Pagos a proveedores (`supplier_payments`, migración 048 — Bloque 3, 21/09/2026).
 *
 * Reglas de Josuarth (21/09): pago PARCIAL a un proveedor SÍ; un pago cubre UNA
 * compra, no varias. Varios pagos por compra, cada uno con su asiento.
 *
 * `kind` distingue un PAGO registrado (`payment`: número CE-, banco, método,
 * comprobante en PDF) de un SALDO HEREDADO del backfill de la 048
 * (`migrated_balance`: sin número, sin banco, sin método, sin comprobante; se
 * puede eliminar, no se reversa). El CHECK de la tabla ata las dos cosas.
 */

import type { PaymentMethod } from "@/lib/finanzas/types/payment";
import type { AsientoDeCobro, ReversionDeCobro } from "@/lib/finanzas/types/payment";

export type SupplierPaymentKind = "payment" | "migrated_balance";
export type SupplierPaymentStatus = "registrado" | "anulado";

export interface CreateSupplierPaymentInput {
  business_expense_id: string;
  payment_date: string; // YYYY-MM-DD
  amount: number;
  method: PaymentMethod;
  /** 🔴 La cuenta de donde SALIÓ la plata. Obligatoria: la elige quien registra. */
  payment_account_code: string | null;
  reference: string | null;
  notes: string | null;
}

export interface SupplierPaymentRow {
  id: string;
  business_expense_id: string;
  kind: SupplierPaymentKind;
  /** `CE-000012`; NULL en los saldos heredados. */
  payment_number: string | null;
  payment_date: string;
  amount: number;
  method: PaymentMethod | null;
  payment_account_code: string | null;
  reference: string | null;
  notes: string | null;
  status: SupplierPaymentStatus;
  created_at: string;
  created_by: string | null;
}

/** Una fila de la sección "Pagos" del detalle de la compra. */
export interface SupplierPaymentForExpense extends SupplierPaymentRow {
  created_by_name: string | null;
  /** Nombre del banco del plan, para no mostrar solo el código. */
  bank_name: string | null;
  /** El asiento del pago, o null (saldo heredado, o anterior al cableado). */
  asiento: AsientoDeCobro | null;
  /** Si fue reversado, cómo. */
  reversion: ReversionDeCobro | null;
}

export const SUPPLIER_PAYMENT_KIND_LABEL: Record<SupplierPaymentKind, string> = {
  payment: "Pago",
  migrated_balance: "Saldo heredado de la migración",
};
