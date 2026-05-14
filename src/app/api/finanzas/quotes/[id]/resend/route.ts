/**
 * POST /api/finanzas/quotes/[id]/resend
 *
 * Sprint 2E.3 hotfix (2026-05-14). Reenvía una cotización ya enviada al
 * cliente. Permite mantener o cambiar el email destinatario. NO cambia el
 * status (sigue siendo el que estaba: 'enviada', 'aceptada' o 'rechazada')
 * y conserva el public_token original para que el link del portal sea el
 * mismo.
 *
 * Flujo:
 *   1. Validar permisos + estado válido.
 *   2. Materializar el PDF (cache hit si el contenido no cambió).
 *   3. UPDATE de columnas sent_at + sent_to_email + sent_by (status intacto).
 *   4. Enviar email vía Resend con PDF adjunto.
 *   5. Registrar audit_log con action='resend_quote'.
 *
 * Body: { sent_to_email: string }
 * Response: { id, public_token, email_sent, email_error?, sent_to_email, sent_at }
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { resendQuote, validateSendQuote } from "@/lib/finanzas/api/quotes";
import { MutationError } from "@/lib/finanzas/api/errors";
import {
  ensureQuotePdfRow,
  downloadQuotePdfBuffer,
} from "@/lib/finanzas/pdf/ensure-quote-pdf";
import { sendQuoteEmail } from "@/lib/finanzas/email/send-quote-email";

interface RouteParams {
  params: { id: string };
}

// La generación del PDF + envío del email puede tardar.
export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://crm-integra-legal.vercel.app";

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

  // ---------- 1. Materializar el PDF (cache hit si no cambió) ----------
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
    console.error("[finanzas] resendQuote: pdf prep failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!pdfResult) {
    return NextResponse.json(
      { error: "Cotización no encontrada" },
      { status: 404 }
    );
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer =
      pdfResult.buffer ??
      (await downloadQuotePdfBuffer(ctx.db, pdfResult.storage_key));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error obteniendo PDF";
    console.error("[finanzas] resendQuote: buffer materialization failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // ---------- 2. UPDATE columnas (sin tocar status) ----------
  let resendResult: Awaited<ReturnType<typeof resendQuote>>;
  try {
    resendResult = await resendQuote(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      params.id,
      validation.data
    );
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] resendQuote helper failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] resendQuote unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }

  // ---------- 3. Enviar email (best effort) ----------
  const { bundle } = pdfResult;
  const publicLink = `${APP_BASE_URL}/cotizacion/${resendResult.public_token}`;
  const grandTotal = Number(bundle.quote.grand_total ?? 0);
  const subtotalHon = Number(bundle.quote.subtotal_hon ?? 0);
  const subtotalRei = Number(bundle.quote.subtotal_rei ?? 0);

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
      summary_line: summaryLine,
    },
  });

  if (!emailRes.ok) {
    console.warn(
      "[finanzas] resendQuote: email falló — sent_at se actualizó pero NO se envió email",
      { quote_id: params.id, error: emailRes.error }
    );
  }

  // ---------- 4. Audit log ----------
  const sentAt = new Date().toISOString();
  try {
    await ctx.db.from("audit_log").insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      entity: "quotes",
      entity_id: params.id,
      action: "resend_quote",
      field: null,
      old_value: JSON.stringify({
        sent_at: resendResult.previous_sent_at,
        sent_to_email: resendResult.previous_sent_to_email,
      }),
      new_value: JSON.stringify({
        sent_at: sentAt,
        sent_to_email: validation.data.sent_to_email,
        email_sent: emailRes.ok,
        email_error: emailRes.ok ? null : emailRes.error,
      }),
    });
  } catch (err) {
    // El audit log no es bloqueante: si falla, el resend igual quedó hecho.
    console.warn("[finanzas] resendQuote: audit_log insert falló", err);
  }

  return NextResponse.json({
    id: resendResult.id,
    public_token: resendResult.public_token,
    email_sent: emailRes.ok,
    email_error: emailRes.ok ? null : emailRes.error,
    sent_to_email: validation.data.sent_to_email,
    sent_at: sentAt,
  });
}
