/**
 * Junta lo que hace falta para armar el asiento de una factura.
 *
 * Son cuatro tablas y NO se resuelven con un solo `select` anidado, a propósito:
 * `invoice_lines → services_catalog → chart_of_accounts` es un embed de dos
 * saltos, y el segundo depende de un FK COMPUESTO
 * `(tenant_id, revenue_account) → chart_of_accounts(tenant_id, code)` que
 * PostgREST no sabe seguir. Se hace en tres consultas y se cruza acá.
 *
 * ⚠️ **`active` se lee en el momento de emitir, no se cachea.** Una cuenta que se
 * desactivó ayer tiene que rechazar hoy. Es la misma lectura que hace el RPC en
 * su paso 4; que estén las dos no es duplicación: la de acá produce el mensaje
 * que nombra el servicio, la del RPC es el permiso.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  FacturaParaAsiento,
  LineaFacturaParaAsiento,
} from "@/lib/finanzas/contabilidad/asiento-factura";

type DB = SupabaseClient;

interface FilaLinea {
  line_order: number;
  description: string;
  subtotal: number | string | null;
  tax_amount: number | string | null;
  service_id: string | null;
}

function num(v: number | string | null): number {
  return v === null ? 0 : typeof v === "number" ? v : Number(v);
}

/**
 * Devuelve la factura lista para `construirAsientoDeFactura()`, o `null` si no
 * existe.
 *
 * `invoice_number` viene por parámetro y no de la base: cuando esto se llama
 * desde `emitInvoice`, el correlativo ya se generó pero **todavía no se escribió**
 * —ese UPDATE es el paso siguiente, y es justamente el que no queremos hacer si
 * el posteo falla—. Leerlo de la base devolvería el slug de borrador.
 */
export async function cargarFacturaParaAsiento(
  db: DB,
  tenantId: string,
  invoiceId: string,
  invoiceNumber: string
): Promise<FacturaParaAsiento | null> {
  const { data: inv, error: errInv } = await db
    .from("invoices")
    .select(
      "id, issue_date, grand_total, client:clients!invoices_client_id_fkey(name)"
    )
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (errInv) throw errInv;
  if (!inv) return null;

  const { data: filas, error: errLin } = await db
    .from("invoice_lines")
    .select("line_order, description, subtotal, tax_amount, service_id")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("line_order", { ascending: true });

  if (errLin) throw errLin;
  const lineasCrudas = (filas ?? []) as unknown as FilaLinea[];

  // ---- Los servicios de esas líneas -------------------------------------
  const serviceIds = Array.from(
    new Set(lineasCrudas.map((l) => l.service_id).filter((x): x is string => !!x))
  );

  const servicios = new Map<string, { code: string; revenue_account: string | null }>();
  if (serviceIds.length > 0) {
    const { data: svc, error: errSvc } = await db
      .from("services_catalog")
      .select("id, code, revenue_account")
      .eq("tenant_id", tenantId)
      .in("id", serviceIds);
    if (errSvc) throw errSvc;
    for (const s of (svc ?? []) as { id: string; code: string; revenue_account: string | null }[]) {
      servicios.set(s.id, { code: s.code, revenue_account: s.revenue_account });
    }
  }

  // ---- Cuáles de esas cuentas existen Y están activas --------------------
  // El filtro `.eq("active", true)` es lo que hace que una cuenta desactivada
  // NO entre al set: no está la fila, así que `cuenta_valida` queda en false.
  // Una cuenta inexistente cae por el mismo camino, sin distinguirlas — para el
  // usuario las dos se arreglan igual, cambiando la cuenta del servicio.
  const codigos = Array.from(
    new Set(
      Array.from(servicios.values())
        .map((s) => s.revenue_account)
        .filter((x): x is string => !!x)
    )
  );

  const activas = new Set<string>();
  if (codigos.length > 0) {
    const { data: cta, error: errCta } = await db
      .from("chart_of_accounts")
      .select("code")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .in("code", codigos);
    if (errCta) throw errCta;
    for (const c of (cta ?? []) as { code: string }[]) activas.add(c.code);
  }

  const lineas: LineaFacturaParaAsiento[] = lineasCrudas.map((l) => {
    const svc = l.service_id ? servicios.get(l.service_id) : undefined;
    const cuenta = svc?.revenue_account ?? null;
    return {
      line_order: l.line_order,
      description: l.description,
      subtotal: num(l.subtotal),
      tax_amount: num(l.tax_amount),
      service_code: svc?.code ?? null,
      revenue_account: cuenta,
      cuenta_valida: cuenta !== null && activas.has(cuenta),
    };
  });

  const cliente = (inv as { client?: { name?: string } | { name?: string }[] | null }).client;
  const nombre = Array.isArray(cliente) ? cliente[0]?.name : cliente?.name;

  return {
    id: (inv as { id: string }).id,
    invoice_number: invoiceNumber,
    issue_date: (inv as { issue_date: string }).issue_date,
    grand_total: num((inv as { grand_total: number | string }).grand_total),
    client_name: nombre ?? "—",
    lineas,
  };
}
