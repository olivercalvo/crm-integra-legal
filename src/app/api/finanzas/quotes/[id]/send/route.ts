/**
 * POST /api/finanzas/quotes/[id]/send
 *
 * Sprint 2E.3 (D2 + D4). Envía la cotización al cliente:
 *   1. Genera (o reusa cache) el PDF actual del quote.
 *   2. Transición status='borrador' → 'enviada' + genera public_token +
 *      guarda sent_to_email + sent_at + sent_by.
 *   3. Envía email vía Resend con PDF adjunto y link al portal público.
 *      Si el email falla, el quote QUEDA enviado (el operador puede
 *      reenviar o compartir el link manualmente).
 *
 * Body: { sent_to_email: string }
 * Response: { id, public_token, email_sent, email_error? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { sendQuote, validateSendQuote } from "@/lib/finanzas/api/quotes";
import { MutationError } from "@/lib/finanzas/api/errors";
import {
  ensureQuotePdfRow,
  downloadQuotePdfBuffer,
} from "@/lib/finanzas/pdf/ensure-quote-pdf";
import { sendQuoteEmail } from "@/lib/finanzas/email/send-quote-email";
import { getPublicAppUrl } from "@/lib/utils/public-url";

interface RouteParams {
  params: { id: string };
}

// La generación del PDF + envío del email puede tardar.
export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;

export async function POST(request: NextRequest, { params }: RouteParams) {
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

  const validation = validateSendQuote(
    body as Parameters<typeof validateSendQuote>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  // ---------- 1. Generar (o cache hit) el PDF actual ----------
  let pdfResult: Awaited<ReturnType<typeof ensureQuotePdfRow>>;
  try {
    pdfResult = await ensureQuotePdfRow(
      ctx.db,
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userName: ctx.userName ?? null,
      },
      params.id
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error generando PDF";
    console.error("[finanzas] sendQuote: pdf prep failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!pdfResult) {
    return NextResponse.json(
      { error: "Cotización no encontrada" },
      { status: 404 }
    );
  }

  // Materializar buffer: usamos el que acabamos de generar (regenerated=true)
  // o descargamos del storage si fue cache hit.
  let pdfBuffer: Buffer;
  try {
    pdfBuffer =
      pdfResult.buffer ??
      (await downloadQuotePdfBuffer(ctx.db, pdfResult.storage_key));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error obteniendo PDF";
    console.error("[finanzas] sendQuote: buffer materialization failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // ---------- 2. Transición de estado en BD ----------
  let sendResult: { id: string; public_token: string };
  try {
    sendResult = await sendQuote(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      params.id,
      validation.data
    );
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] sendQuote helper failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] sendQuote unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }

  // ---------- 3. Enviar email (best effort) ----------
  const { bundle } = pdfResult;
  const publicLink = `${getPublicAppUrl()}/cotizacion/${sendResult.public_token}`;
  const grandTotal = Number(bundle.quote.grand_total ?? 0);
  const subtotalHon = Number(bundle.quote.subtotal_hon ?? 0);
  const subtotalRei = Number(bundle.quote.subtotal_rei ?? 0);

  // Sprint 2E.4 P1: line_summary (3-5 ítems max) para mostrar en el cuerpo
  // del email — más útil que el legacy summary_line genérico.
  const lineSummary = bundle.lines.slice(0, 5).map((ln) => ({
    description: ln.description as string,
    amount_label: `$${(Number(ln.line_total ?? 0)).toFixed(2)}`,
  }));
  const extraLinesCount = Math.max(0, bundle.lines.length - lineSummary.length);

  // summary_line legacy se mantiene para compat con clientes viejos que
  // todavía esperan ese texto en su tracking de emails.
  const compositionParts: string[] = [];
  if (subtotalHon > 0) compositionParts.push("honorarios profesionales");
  if (subtotalRei > 0) compositionParts.push("reembolso de gastos");
  const summaryLine =
    compositionParts.length > 0
      ? `Cubre ${compositionParts.join(" y ")}.`
      : null;

  const emailRes = await sendQuoteEmail({
    to: validation.data.sent_to_email,
    pdfBuffer,
    pdfFileName: pdfResult.file_name,
    email: {
      client_name: bundle.client.name,
      quote_number: bundle.quote.quote_number,
      title: bundle.quote.title ?? "",
      valid_until: bundle.quote.valid_until,
      grand_total: grandTotal,
      currency: "USD",
      public_link: publicLink,
      sent_by_name: ctx.userName ?? "Equipo Integra Legal",
      line_summary: lineSummary,
      extra_lines_count: extraLinesCount,
      summary_line: summaryLine,
    },
  });

  if (!emailRes.ok) {
    console.warn(
      "[finanzas] sendQuote: email falló — cotización quedó marcada como enviada pero NO se envió email",
      { quote_id: params.id, error: emailRes.error }
    );
  }

  return NextResponse.json({
    id: sendResult.id,
    public_token: sendResult.public_token,
    email_sent: emailRes.ok,
    email_error: emailRes.ok ? null : emailRes.error,
  });
}
