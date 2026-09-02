/**
 * FUENTE DE DATOS del Estado de Cuenta por tercero.
 *
 * CLIENTE: sus facturas (débito, aumentan lo que debe) y sus cobros aplicados
 * (crédito). Las facturas en borrador, anuladas o canceladas antes de emitir NO
 * entran: no son deuda de nadie, igual que en la antigüedad.
 *
 * PROVEEDOR: sus gastos del bufete. Desde la migración 033 el proveedor ES una
 * entidad, así que se busca por `supplier_id` y no por el texto del nombre. Un
 * gasto viejo sin ficha sigue encontrándose por su `supplier_name`, para que
 * nada quede fuera del estado de cuenta.
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

/**
 * Los proveedores con gastos registrados.
 *
 * Devuelve la FICHA cuando existe (`id` real) y cae al nombre suelto solo para
 * los gastos que no tienen ficha. El `value` es lo que viaja por la URL.
 */
export interface OpcionProveedor {
  /** id de la ficha, o el nombre suelto si el gasto no tiene ficha. */
  value: string;
  label: string;
  /** false = es un nombre suelto, no una entidad. */
  esFicha: boolean;
}

export async function loadProveedoresConMovimiento(
  db: DB,
  tenantId: string
): Promise<OpcionProveedor[]> {
  const { data } = await db
    .from("business_expenses")
    .select("supplier_id, supplier_name")
    .eq("tenant_id", tenantId);

  const filas = (data ?? []) as { supplier_id: string | null; supplier_name: string | null }[];

  const idsConFicha = Array.from(
    new Set(filas.map((g) => g.supplier_id).filter((v): v is string => !!v))
  );

  const opciones: OpcionProveedor[] = [];
  if (idsConFicha.length > 0) {
    const { data: provs } = await db
      .from("suppliers")
      .select("id, legal_name, trade_name")
      .eq("tenant_id", tenantId)
      .in("id", idsConFicha);
    for (const p of (provs ?? []) as {
      id: string;
      legal_name: string;
      trade_name: string | null;
    }[]) {
      opciones.push({
        value: p.id,
        label: p.trade_name?.trim() || p.legal_name,
        esFicha: true,
      });
    }
  }

  // Gastos sin ficha: se ofrecen por su texto, para que no queden invisibles.
  const sueltos = new Set<string>();
  for (const g of filas) {
    if (g.supplier_id) continue;
    const n = g.supplier_name?.trim();
    if (n) sueltos.add(n);
  }
  sueltos.forEach((n) => opciones.push({ value: n, label: n, esFicha: false }));

  return opciones.sort((a, b) => a.label.localeCompare(b.label));
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
  /** id de la ficha, o el nombre suelto para un gasto sin ficha. */
  proveedor: string
): Promise<MovimientoTercero[]> {
  const esId =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      proveedor
    );

  let q = db
    .from("business_expenses")
    .select("id, description, expense_date, payment_date, total, status")
    .eq("tenant_id", tenantId);

  // Con ficha se busca por id; sin ficha, por el texto y SOLO entre los que no
  // tienen ficha, para no duplicar un gasto que ya salió por su proveedor.
  q = esId ? q.eq("supplier_id", proveedor) : q.is("supplier_id", null).eq("supplier_name", proveedor);

  const { data, error } = await q.order("expense_date");

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
