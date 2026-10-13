import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { cargarFechaDeApertura } from "@/lib/finanzas/api/apertura";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";

// Leer: los tres roles de finanzas. Escribir: admin y contador (como el inicio contable).
const FINANZAS_ROLES = ["admin", "abogada", "contador"] as const;
const ROLES_ESCRITURA = ["admin", "contador"] as const;

/** GET → { fecha_apertura, es_parametro, inicio } (la fecha efectiva). */
export const GET = conManejoDeAuditoria(async function GET() {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, FINANZAS_ROLES);
  if (denied) return denied;
  const f = await cargarFechaDeApertura(ctx.db, ctx.tenantId);
  return NextResponse.json({ fecha_apertura: f.fecha, es_parametro: f.esParametro, inicio: f.inicio });
});

/**
 * PUT { fecha_apertura: "2026-06-30" | null }. null vuelve al valor por defecto
 * (el día anterior al inicio contable). La decide Josuarth. La base exige que sea
 * anterior al inicio (CHECK) y que no cambie con una apertura vigente (100): los
 * dos rechazos llegan como 409 con el mensaje de la base. El tenant sale del perfil.
 */
export const PUT = conManejoDeAuditoria(async function PUT(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES_ESCRITURA);
  if (denied) return denied;
  let body: { fecha_apertura?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const v = body?.fecha_apertura;
  if (v !== null && (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v))) {
    return NextResponse.json({ errors: { fecha_apertura: "Elige una fecha (o vuelve al valor por defecto)." } }, { status: 400 });
  }
  const { error } = await ctx.db.from("finanzas_parametros").upsert(
    { tenant_id: ctx.tenantId, fecha_apertura: v, updated_at: new Date().toISOString(), updated_by: ctx.userId },
    { onConflict: "tenant_id" }
  );
  if (error) {
    if ((error as { code?: string }).code === "23514") {
      const msg = /apertura_antes_del_inicio/.test(error.message)
        ? "La fecha de la apertura tiene que ser anterior al inicio contable."
        : error.message;
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    console.error("[finanzas] PUT fecha-apertura failed", error);
    return NextResponse.json({ error: "No se pudo guardar la fecha de la apertura." }, { status: 500 });
  }
  const f = await cargarFechaDeApertura(ctx.db, ctx.tenantId);
  return NextResponse.json({ fecha_apertura: f.fecha, es_parametro: f.esParametro });
});
