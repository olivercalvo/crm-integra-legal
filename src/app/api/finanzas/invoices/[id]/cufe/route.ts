import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { registrarCufeDelPortal } from "@/lib/finanzas/api/invoices";
import { MutationError } from "@/lib/finanzas/api/errors";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/finanzas/invoices/[id]/cufe
 *
 * Guarda el CUFE de una factura emitida A MANO en el portal de ideati (las
 * anteriores al 8 de julio de 2026, punto `050`). Es lo que habilita emitirles
 * una nota de crédito electrónica: el bloque de referencia se arma con el CUFE
 * del documento que se corrige.
 *
 * 🔴 No cambia `fe_estado`: la factura sigue `no_emitida` porque este sistema
 * no la emitió. Lo que queda registrado es `dgi_cufe_origen = 'portal_050'`.
 *
 * Permisos: admin + abogada, los mismos que emiten una nota de crédito. El
 * contador NO — el dato sale del portal de facturación, no del libro, y es la
 * misma línea que separa emitir de reversar en todo el módulo.
 *
 * Body esperado: { cufe }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const raw = (body as { cufe?: unknown } | null)?.cufe;
  if (typeof raw !== "string") {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: { cufe: "Pegue el CUFE de la factura." } },
      { status: 400 }
    );
  }

  try {
    const result = await registrarCufeDelPortal(ctx.db, ctx.tenantId, params.id, raw);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MutationError) {
      // Los 400 del validador llevan el mensaje al campo, para que la pantalla
      // lo muestre donde la persona está mirando.
      if (err.status === 400) {
        return NextResponse.json(
          { error: "Validación fallida", fieldErrors: { cufe: err.message } },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api] POST invoices/[id]/cufe failed", err);
    return NextResponse.json({ error: "No se pudo guardar el CUFE" }, { status: 500 });
  }
}
