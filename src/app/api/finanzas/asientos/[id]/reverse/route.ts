/**
 * POST /api/finanzas/asientos/[id]/reverse — reversa un asiento MANUAL.
 *
 * Bloque 7 (22/09/2026). Body: `{ reason }`. Delega en `reverseJournalEntry`
 * → RPC `reverse_journal_entry` (055): espejo verificado, fecha de hoy,
 * `reverses_entry_id`. Esta ruta no arma líneas.
 *
 * 🔒 Roles: **admin y contador**, los mismos que CARGAN un asiento manual
 * (`ADMIN_CONTADOR_ONLY_PREFIXES` y la ruta de alta). No son los mismos que
 * reversan un cobro o un gasto —ahí entra también la abogada— porque acá la
 * pieza que se corrige es la que ella no puede crear: si no puede cargar un
 * asiento de diario, no puede deshacerlo.
 *
 * El tenant sale del contexto autenticado, nunca del request (SOP-014).
 */

import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { reverseJournalEntry } from "@/lib/finanzas/api/asientos";
import { MutationError } from "@/lib/finanzas/api/errors";
import { MOTIVO_MAX, MOTIVO_MIN } from "@/lib/finanzas/contabilidad/reversion";

export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

/** Tiene que coincidir con la ruta de alta y con route-access.ts. */
const MUTATING_ROLES = ["admin", "contador"] as const;

export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole as (typeof MUTATING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const raw = (body as { reason?: unknown } | null)?.reason;
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length < MOTIVO_MIN || reason.length > MOTIVO_MAX) {
    return NextResponse.json(
      {
        error: "Validación fallida",
        fieldErrors: {
          reason: `El motivo de la reversión debe tener entre ${MOTIVO_MIN} y ${MOTIVO_MAX} caracteres.`,
        },
      },
      { status: 400 }
    );
  }

  try {
    const result = await reverseJournalEntry(
      ctx.db,
      createAdminClient(),
      ctx.tenantId,
      ctx.userId,
      params.id,
      reason
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas/asientos] reverse failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas/asientos] reverse unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
