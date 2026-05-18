/**
 * POST /api/public/cotizaciones/[token]/accept
 *
 * Endpoint PÚBLICO (sin auth). La "autenticación" es el public_token del path.
 *
 * Flujo (Sprint 2E.4 P5):
 *   1. Validar formato token (UUID).
 *   2. Validar payload (full_name, position, id_document?, consent_accepted).
 *   3. commitAcceptance: atómico — INSERT quote_acceptances + UPDATE quotes.
 *      Si falla, responde 4xx al cliente para reintentar.
 *   4. runAcceptanceCascade: best-effort — PDF firmado + convertToInvoices +
 *      emails. Cualquier fallo se loguea pero NO bloquea la respuesta.
 *
 * Response: { ok: true, quote_number, accepted_at, signature_text } o
 *           { ok: false, error, fieldErrors? }
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MutationError } from "@/lib/finanzas/api/errors";
import {
  commitAcceptance,
  validateAcceptInput,
} from "@/lib/finanzas/api/quote-portal";
import { runAcceptanceCascade } from "@/lib/finanzas/api/quote-portal-cascade";

interface RouteParams {
  params: { token: string };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// La cascada (PDF + emails) puede tardar hasta ~30s con Resend lento.
export const runtime = "nodejs";
export const maxDuration = 60;

function extractIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  // NextRequest.ip puede estar undefined en Node runtime — fallback null.
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

  const validation = validateAcceptInput(
    body as Parameters<typeof validateAcceptInput>[0]
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

  // Paso crítico atómico.
  try {
    const acceptResult = await commitAcceptance(db, token, validation.data, ctx);

    // Paso best-effort (no bloquea la respuesta al cliente).
    const cascadeResult = await runAcceptanceCascade(
      db,
      { tenantId: acceptResult.bundle.tenant_id, userId: null },
      acceptResult
    );

    console.info("[finanzas/portal] acceptance cascade summary", {
      quote_id: acceptResult.bundle.id,
      signed_pdf_ok: cascadeResult.signed_pdf_ok,
      signed_pdf_error: cascadeResult.signed_pdf_error,
      invoices_created: cascadeResult.invoices_created,
      invoices_error: cascadeResult.invoices_error,
      email_client_ok: cascadeResult.emails.client?.ok ?? false,
      email_lawyers_total: cascadeResult.emails.lawyers.length,
      email_lawyers_ok: cascadeResult.emails.lawyers.filter((e) => e.ok).length,
    });

    return NextResponse.json({
      ok: true,
      quote_number: acceptResult.bundle.quote_number,
      accepted_at: acceptResult.accepted_at,
      signature_text: acceptResult.signature_text,
    });
  } catch (err) {
    if (err instanceof MutationError) {
      console.warn("[finanzas/portal] commitAcceptance rejected", {
        message: err.message,
        status: err.status,
      });
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.status }
      );
    }
    console.error("[finanzas/portal] commitAcceptance unexpected", err);
    return NextResponse.json(
      { ok: false, error: "Error interno al registrar la aceptación" },
      { status: 500 }
    );
  }
}
