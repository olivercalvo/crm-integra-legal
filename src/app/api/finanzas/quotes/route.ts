import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { listQuotes } from "@/lib/finanzas/queries/quotes";
import { createQuote, validateCreateQuote } from "@/lib/finanzas/api/quotes";
import { MutationError } from "@/lib/finanzas/api/errors";
import type { QuoteFilters, QuoteStatus } from "@/lib/finanzas/types/quote";

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;

/**
 * POST /api/finanzas/quotes
 * Crea una cotización en estado borrador (con prospect inline opcional).
 *
 * Permisos: admin, abogada, contador (D8). Asistente queda excluido.
 *
 * Body: CreateQuoteInput (ver types/quote.ts)
 */
export async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const validation = validateCreateQuote(
    body as Parameters<typeof validateCreateQuote>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await createQuote(ctx.db, ctx.tenantId, ctx.userId, validation.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] createQuote failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] createQuote unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

/**
 * GET /api/finanzas/quotes
 * Lista paginada con filtros opcionales.
 *
 * Query params:
 *   ?status=<QuoteStatus>            (también acepta múltiples: ?status=enviada&status=aceptada)
 *   ?client_id=<UUID>
 *   ?case_id=<UUID>
 *   ?search=<text>                   (parcial sobre quote_number)
 *   ?page=<n>&pageSize=<m>
 */
export async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const filters: QuoteFilters = {};

  const statusParams = sp.getAll("status").filter(Boolean) as QuoteStatus[];
  if (statusParams.length === 1) filters.status = statusParams[0];
  else if (statusParams.length > 1) filters.status = statusParams;

  const clientId = sp.get("client_id");
  if (clientId) filters.client_id = clientId;

  const caseId = sp.get("case_id");
  if (caseId) filters.case_id = caseId;

  const search = sp.get("search");
  if (search) filters.search = search;

  const page = sp.get("page");
  if (page) filters.page = parseInt(page, 10);

  const pageSize = sp.get("pageSize");
  if (pageSize) filters.pageSize = parseInt(pageSize, 10);

  const result = await listQuotes(ctx.db, ctx.tenantId, filters);
  return NextResponse.json(result);
}
