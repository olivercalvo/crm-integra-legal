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

/**
 * A qué documento va el pago (049: arco exclusivo). Exactamente uno de los dos
 * ids; el CHECK de la base lo hace imposible de violar.
 *   · `compra`  → `business_expenses` (Gastos del Bufete)
 *   · `tramite` → `expenses` (gasto de trámite, módulo Legal)
 */
export type SupplierPaymentDestino =
  | { kind: "compra"; id: string }
  | { kind: "tramite"; id: string };

export function destinoDePago(p: {
  business_expense_id: string | null;
  expense_id: string | null;
}): SupplierPaymentDestino {
  if (p.business_expense_id) return { kind: "compra", id: p.business_expense_id };
  if (p.expense_id) return { kind: "tramite", id: p.expense_id };
  throw new Error("Pago sin destino: viola el arco exclusivo de la 049");
}

export interface CreateSupplierPaymentInput {
  /** UNO de los dos (arco exclusivo, 049). El validador lo exige. */
  business_expense_id: string | null;
  expense_id: string | null;
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
  /** NULL cuando el pago es de un gasto de trámite (049). */
  business_expense_id: string | null;
  /** NULL cuando el pago es de una compra. */
  expense_id: string | null;
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
