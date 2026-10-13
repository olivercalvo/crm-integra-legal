import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";
import { cargarFechaDeApertura, precargaDeApertura } from "@/lib/finanzas/api/apertura";
import { generarPlantillaDeApertura } from "@/lib/finanzas/import/apertura-workbook";

export const runtime = "nodejs";

/**
 * GET /api/finanzas/asientos/apertura/plantilla[?vacia=1]
 * La plantilla de la apertura. Por defecto viene precargada con lo que el CRM
 * conoce al corte (una ayuda, no la fuente: los saldos salen de QuickBooks);
 * con ?vacia=1, sin precarga. Admin y contador.
 */
const ROLES = ["admin", "contador"] as const;

export const GET = conManejoDeAuditoria(async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  const vacia = request.nextUrl.searchParams.get("vacia") === "1";
  const { fecha, inicio } = await cargarFechaDeApertura(ctx.db, ctx.tenantId);
  const [cuentas, clientes, proveedores, precarga] = await Promise.all([
    ctx.db.from("chart_of_accounts").select("code, name, account_type, cuenta_control").eq("tenant_id", ctx.tenantId).eq("active", true).order("code"),
    ctx.db.from("clients").select("client_number, name, es_de_prueba").eq("tenant_id", ctx.tenantId).order("client_number"),
    ctx.db.from("suppliers").select("supplier_number, legal_name, trade_name").eq("tenant_id", ctx.tenantId).eq("active", true).order("supplier_number"),
    vacia ? Promise.resolve([]) : precargaDeApertura(ctx.db, ctx.tenantId, fecha),
  ]);
  const buf = generarPlantillaDeApertura({
    fechaApertura: fecha,
    inicioContable: inicio,
    cuentas: (cuentas.data ?? []) as { code: string; name: string; account_type: string; cuenta_control: string | null }[],
    clientes: ((clientes.data ?? []) as { client_number: string | null; name: string; es_de_prueba: boolean }[])
      .filter((c) => c.client_number && !c.es_de_prueba)
      .map((c) => ({ codigo: c.client_number as string, nombre: c.name })),
    proveedores: ((proveedores.data ?? []) as { supplier_number: string | null; legal_name: string; trade_name: string | null }[])
      .filter((p) => p.supplier_number)
      .map((p) => ({ codigo: p.supplier_number as string, nombre: p.trade_name?.trim() || p.legal_name })),
    precarga,
  });
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="apertura-${fecha}${vacia ? "-vacia" : ""}.xlsx"`,
    },
  });
});
