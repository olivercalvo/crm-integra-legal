/**
 * FUENTE DE DATOS del Estado de Cuenta por tercero.
 *
 * CLIENTE: sus facturas (débito, aumentan lo que debe) y sus cobros aplicados
 * (crédito). Las facturas en borrador, anuladas o canceladas antes de emitir NO
 * entran: no son deuda de nadie, igual que en la antigüedad.
 *
 * PROVEEDOR: sus gastos del bufete. El proveedor es texto libre —no hay entidad—
 * así que se busca por nombre exacto. Ver el encabezado de `antiguedad-source.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { MovimientoTercero } from "@/lib/finanzas/reports/estado-cuenta";

type DB = SupabaseClient;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Los clientes que tienen algo que mostrar en un estado de cuenta. */
export async function loadClientesConMovimiento(
  db: DB,
  tenantId: string
): Promise<{ id: string; name: string }[]> {
  const { data } = await db
    .from("invoices")
    .select("client_id, clients!inner(id, name)")
    .eq("tenant_id", tenantId)
    .in("status", ["emitida", "parcialmente_pagada", "pagada"]);

  const mapa = new Map<string, string>();
  for (const f of (data ?? []) as unknown as { clients: { id: string; name: string } }[]) {
    mapa.set(f.clients.id, f.clients.name);
  }
  return Array.from(mapa.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Los nombres de proveedor que aparecen en gastos del bufete. */
export async function loadProveedoresConMovimiento(
  db: DB,
  tenantId: string
): Promise<string[]> {
  const { data } = await db
    .from("business_expenses")
    .select("supplier_name")
    .eq("tenant_id", tenantId);

  const nombres = new Set<string>();
  for (const g of (data ?? []) as { supplier_name: string | null }[]) {
    const n = g.supplier_name?.trim();
    if (n) nombres.add(n);
  }
  return Array.from(nombres).sort((a, b) => a.localeCompare(b));
}

/** Movimientos de un CLIENTE: facturas y cobros, en orden cronológico. */
export async function loadMovimientosDeCliente(
  db: DB,
  tenantId: string,
  clientId: string
): Promise<MovimientoTercero[]> {
  const { data: facturas, error } = await db
    .from("invoices")
    .select("id, invoice_number, issue_date, grand_total, status")
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .in("status", ["emitida", "parcialmente_pagada", "pagada"])
    .order("issue_date");

  if (error) {
    console.error("[finanzas/estado-cuenta] facturas failed", error);
    throw new Error("No se pudieron leer las facturas del cliente");
  }

  type Factura = {
    id: string;
    invoice_number: string;
    issue_date: string;
    grand_total: number | string;
  };
  const fs = (facturas ?? []) as unknown as Factura[];

  const movimientos: MovimientoTercero[] = fs.map((f) => ({
    fecha: String(f.issue_date).slice(0, 10),
    tipo: "Factura",
    documento: f.invoice_number,
    descripcion: `Emisión de ${f.invoice_number}`,
    debito: round2(Number(f.grand_total)),
    credito: 0,
    documentoId: f.id,
    sourceType: "factura",
  }));

  // -- cobros aplicados a esas facturas --------------------------------------
  if (fs.length > 0) {
    const { data: aplicaciones } = await db
      .from("payment_applications")
      .select("amount_applied, invoice_id, payments!inner(id, payment_date, reference, method)")
      .eq("tenant_id", tenantId)
      .in("invoice_id", fs.map((f) => f.id));

    type Aplicacion = {
      amount_applied: number | string;
      invoice_id: string;
      payments: { id: string; payment_date: string; reference: string | null; method: string };
    };
    const numeroPorId = new Map(fs.map((f) => [f.id, f.invoice_number]));

    for (const a of (aplicaciones ?? []) as unknown as Aplicacion[]) {
      const numero = numeroPorId.get(a.invoice_id) ?? "";
      movimientos.push({
        fecha: String(a.payments.payment_date).slice(0, 10),
        tipo: "Cobro",
        documento: a.payments.reference ?? a.payments.method,
        descripcion: `Cobro aplicado a ${numero}`,
        debito: 0,
        credito: round2(Number(a.amount_applied)),
        // El pago no tiene pantalla propia: vive en el detalle de la factura,
        // igual que en el Libro Mayor.
        documentoId: a.invoice_id,
        sourceType: "factura",
      });
    }
  }

  // Cronológico. Dentro del mismo día, primero la factura y después su cobro:
  // es el orden en que ocurrieron y el que hace legible el saldo corrido.
  return movimientos.sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
    return a.debito > 0 ? -1 : 1;
  });
}

/** Movimientos de un PROVEEDOR: sus gastos del bufete. */
export async function loadMovimientosDeProveedor(
  db: DB,
  tenantId: string,
  supplierName: string
): Promise<MovimientoTercero[]> {
  const { data, error } = await db
    .from("business_expenses")
    .select("id, description, expense_date, payment_date, total, status")
    .eq("tenant_id", tenantId)
    .eq("supplier_name", supplierName)
    .order("expense_date");

  if (error) {
    console.error("[finanzas/estado-cuenta] gastos failed", error);
    throw new Error("No se pudieron leer los gastos del proveedor");
  }

  type Gasto = {
    id: string;
    description: string | null;
    expense_date: string;
    payment_date: string | null;
    total: number | string;
    status: string;
  };

  const movimientos: MovimientoTercero[] = [];
  for (const g of (data ?? []) as unknown as Gasto[]) {
    const monto = round2(Number(g.total));
    movimientos.push({
      fecha: String(g.expense_date).slice(0, 10),
      tipo: "Gasto",
      documento: g.description?.trim() || "(sin descripción)",
      descripcion: "Gasto registrado, pendiente de pago",
      debito: monto,
      credito: 0,
      documentoId: g.id,
      sourceType: "gasto",
    });
    // Si ya se pagó, el pago cancela la deuda: entra como crédito en su fecha.
    if (g.payment_date) {
      movimientos.push({
        fecha: String(g.payment_date).slice(0, 10),
        tipo: "Pago",
        documento: g.description?.trim() || "(sin descripción)",
        descripcion: "Pago del gasto",
        debito: 0,
        credito: monto,
        documentoId: g.id,
        sourceType: "gasto",
      });
    }
  }

  return movimientos.sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
    return a.debito > 0 ? -1 : 1;
  });
}
