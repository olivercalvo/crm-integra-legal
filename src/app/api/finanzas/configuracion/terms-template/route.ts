import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import {
  getTermsTemplateRow,
  updateTermsTemplate,
} from "@/lib/finanzas/api/quote-terms";
import { MutationError } from "@/lib/finanzas/api/errors";

const READ_ROLES = ["admin", "abogada", "contador"] as const;
const WRITE_ROLES = ["admin"] as const;

/**
 * GET /api/finanzas/configuracion/terms-template
 * Devuelve el template T&C del tenant para preview en la pantalla de
 * configuración o para el editor. Permisos: admin, abogada, contador.
 */
export async function GET(_request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!READ_ROLES.includes(ctx.userRole as (typeof READ_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const row = await getTermsTemplateRow(ctx.db, ctx.tenantId);
  return NextResponse.json(row);
}

/**
 * PUT /api/finanzas/configuracion/terms-template
 * Actualiza el template T&C del tenant. Permisos: SOLO admin (D9).
 *
 * Body: { content: string }
 */
export async function PUT(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!WRITE_ROLES.includes(ctx.userRole as (typeof WRITE_ROLES)[number])) {
    return NextResponse.json(
      { error: "Solo el administrador puede editar la plantilla de Términos y Condiciones" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const content = (body as { content?: unknown })?.content;
  if (typeof content !== "string") {
    return NextResponse.json(
      { error: "El campo 'content' es requerido y debe ser texto." },
      { status: 400 }
    );
  }

  try {
    await updateTermsTemplate(ctx.db, ctx.tenantId, ctx.userId, content);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] updateTermsTemplate failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] updateTermsTemplate unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
