import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { registrarFacturaExterna } from "@/lib/finanzas/api/facturas-externas";
import { validarPedidoDeFacturaExterna } from "@/lib/finanzas/validators/factura-externa";
import { MutationError } from "@/lib/finanzas/api/errors";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";

export const runtime = "nodejs";

/**
 * POST /api/finanzas/facturas-externas
 *
 * Registra una factura que la DGI ya autorizó desde otro punto (QuickBooks 050,
 * portal 100), con su CUFE. Número FAC-EXT-, factura, asiento y CUFE en UNA
 * transacción (RPC `register_external_invoice`, migración `092`). Nunca va al
 * PAC y nunca toma correlativo del 051.
 *
 * Permisos: admin y contador (Oliver, 05/10/2026). La abogada y el asistente,
 * 403. Los mismos roles que `/finanzas/facturas-externas` en route-access.ts.
 *
 * 🔑 El `tenant_id` sale del perfil, nunca del body (SOP-014).
 */
const ROLES = ["admin", "contador"] as const;

export const POST = conManejoDeAuditoria(async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const v = validarPedidoDeFacturaExterna(body);
  if (!v.ok) {
    const primero = Object.values(v.errors)[0];
    return NextResponse.json(
      { error: primero ?? "Validación fallida", fieldErrors: v.errors },
      { status: 400 }
    );
  }

  try {
    const r = await registrarFacturaExterna(
      ctx.db,
      createAdminClient(ctx.userId),
      ctx.tenantId,
      ctx.userId,
      v.data
    );
    return NextResponse.json(r, { status: 201 });
  } catch (err) {
    if (err instanceof MutationError) {
      return NextResponse.json({ error: err.message, fieldErrors: err.fieldErrors }, { status: err.status });
    }
    console.error("[finanzas] registrarFacturaExterna unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});
