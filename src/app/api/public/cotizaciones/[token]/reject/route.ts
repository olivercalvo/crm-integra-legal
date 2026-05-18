/**
 * POST /api/public/cotizaciones/[token]/reject
 *
 * Endpoint PÚBLICO (sin auth). La "autenticación" es el public_token del path.
 *
 * Flujo (Sprint 2E.4 P5/P6):
 *   1. Validar formato token (UUID).
 *   2. Validar payload (reason ≥ 10 chars).
 *   3. commitRejection: atómico — INSERT quote_rejections + UPDATE quotes.
 *   4. runRejectionCascade: best-effort — 2 emails (cliente + abogadas).
 *
 * Response: { ok: true, quote_number, rejected_at } o
 *           { ok: false, error, fieldErrors? }
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MutationError } from "@/lib/finanzas/api/errors";
import {
  commitRejection,
  validateRejectInput,
} from "@/lib/finanzas/api/quote-portal";
import { runRejectionCascade } from "@/lib/finanzas/api/quote-portal-cascade";

interface RouteParams {
  params: { token: string };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const runtime = "nodejs";
export const maxDuration = 30;

function extractIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return (req as unknown as { ip?: string | null }).ip ?? null;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const token = params.token?.trim() ?? "";
  if (!UUID_RE.test(token)) {
    return NextResponse.json(
      { ok: false, error: "Link inválido" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body inválido" },
      { status: 400 }
    );
  }

  const validation = validateRejectInput(
    body as Parameters<typeof validateRejectInput>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, error: "Datos incompletos", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  const db = createAdminClient();

  const ctx = {
    ip_address: extractIp(request),
    user_agent: request.headers.get("user-agent")?.slice(0, 1000) ?? null,
    origin_url:
      request.headers.get("referer") ??
      request.headers.get("origin") ??
      null,
  };

  try {
    const rejectResult = await commitRejection(db, token, validation.data, ctx);

    const cascadeResult = await runRejectionCascade(
      db,
      { tenantId: rejectResult.bundle.tenant_id },
      rejectResult
    );

    console.info("[finanzas/portal] rejection cascade summary", {
      quote_id: rejectResult.bundle.id,
      email_client_ok: cascadeResult.emails.client?.ok ?? false,
      email_lawyers_total: cascadeResult.emails.lawyers.length,
      email_lawyers_ok: cascadeResult.emails.lawyers.filter((e) => e.ok).length,
    });

    return NextResponse.json({
      ok: true,
      quote_number: rejectResult.bundle.quote_number,
      rejected_at: rejectResult.rejected_at,
    });
  } catch (err) {
    if (err instanceof MutationError) {
      console.warn("[finanzas/portal] commitRejection rejected", {
        message: err.message,
        status: err.status,
      });
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.status }
      );
    }
    console.error("[finanzas/portal] commitRejection unexpected", err);
    return NextResponse.json(
      { ok: false, error: "Error interno al registrar el rechazo" },
      { status: 500 }
    );
  }
}
