/**
 * POST /api/finanzas/quotes/[id]/duplicate
 *
 * Sprint 2E.4 — feature Duplicar cotización. Crea un nuevo quote en estado
 * 'borrador' copiando título, líneas, observaciones y T&C del origen.
 * Cliente del origen se copia (NOT NULL en BD) — la abogada puede cambiarlo
 * desde el editor (banner amarillo lo recuerda).
 *
 * Permitido desde TODOS los estados del origen (D4).
 *
 * Permisos: admin + abogada (NO contador, NO asistente). Igual que crear.
 *
 * Response: { id, quote_number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { duplicateQuote } from "@/lib/finanzas/api/quotes";
import { MutationError } from "@/lib/finanzas/api/errors";

interface RouteParams {
  params: { id: string };
}

const ALLOWED_ROLES = ["admin", "abogada"] as const;

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const result = await duplicateQuote(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      params.id
    );

    // Audit log — no bloqueante.
    try {
      await ctx.db.from("audit_log").insert({
        tenant_id: ctx.tenantId,
        user_id: ctx.userId,
        entity: "quotes",
        entity_id: result.id,
        action: "duplicate_quote",
        field: null,
        old_value: null,
        new_value: JSON.stringify({
          source_quote_id: params.id,
          new_quote_number: result.quote_number,
        }),
      });
    } catch (err) {
      console.warn("[finanzas] duplicateQuote: audit_log insert falló", err);
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] duplicateQuote failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] duplicateQuote unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
