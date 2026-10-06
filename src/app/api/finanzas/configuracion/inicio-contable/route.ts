import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { cargarInicioContable, validarInicioContable } from "@/lib/finanzas/contabilidad/inicio-contable";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";

// Leer: los tres roles de finanzas (la abogada ve por qué un documento no tiene asiento).
const FINANZAS_ROLES = ["admin", "abogada", "contador"] as const;

// 🔴 Escribir: admin y contador. La RLS de la 078 lo vuelve a exigir, y el
// trigger de la 096 rechaza un cambio que deje documentos del lado equivocado.
const ROLES_ESCRITURA = ["admin", "contador"] as const;

/** GET /api/finanzas/configuracion/inicio-contable → { fecha_inicio_contable }. */
export const GET = conManejoDeAuditoria(async function GET() {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, FINANZAS_ROLES);
  if (denied) return denied;
  const fecha_inicio_contable = await cargarInicioContable(ctx.db, ctx.tenantId);
  return NextResponse.json({ fecha_inicio_contable }, { status: 200 });
});

/**
 * PUT /api/finanzas/configuracion/inicio-contable  { fecha_inicio_contable: "2026-07-01" }
 *
 * El `tenant_id` sale del perfil, nunca del body. Se escribe con la SESIÓN (no
 * con el cliente de servicio) para que la bitácora contable (087) registre a
 * quien hizo el cambio y la RLS vuelva a mirar el rol.
 *
 * 409: el trigger de la 096 lo rechazó porque cruzaría documentos; el mensaje
 * de la base nombra cuáles, y se devuelve tal cual.
 */
export const PUT = conManejoDeAuditoria(async function PUT(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES_ESCRITURA);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const v = validarInicioContable(body);
  if (!v.ok) {
    return NextResponse.json({ errors: { fecha_inicio_contable: v.error } }, { status: 400 });
  }

  const { error } = await ctx.db.from("finanzas_parametros").upsert(
    {
      tenant_id: ctx.tenantId,
      fecha_inicio_contable: v.fecha,
      updated_at: new Date().toISOString(),
      updated_by: ctx.userId,
    },
    { onConflict: "tenant_id" }
  );
  if (error) {
    if ((error as { code?: string }).code === "23514") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[finanzas] PUT inicio-contable failed", error);
    return NextResponse.json({ error: "No se pudo guardar el inicio contable." }, { status: 500 });
  }
  return NextResponse.json({ fecha_inicio_contable: v.fecha }, { status: 200 });
});
