/**
 * GET /api/debug/test-resend
 *
 * Endpoint TEMPORAL de diagnóstico para Sprint 2E.3 hotfix (2026-05-14).
 *
 * Oliver reportó silent failure: el dialog mostraba banner verde "Email
 * enviado" pero el email no llegaba a inbox ni a spam. Este endpoint
 * permite hacer un test send aislado y ver la respuesta cruda de Resend
 * para diferenciar entre:
 *   - DNS de integra-panama.com NO verificado en Resend (root cause)
 *   - Bug en el código del check de éxito (ya endurecido en este sprint)
 *   - Otro problema (rate limit, payload inválido, etc.)
 *
 * Comportamiento:
 *   - Requiere auth + rol admin (no asistente, no abogada).
 *   - Hace un send sencillo a oliver@clienteenelcentro.com (override por
 *     query string ?to=otro@example.com para probar con otra address).
 *   - Devuelve JSON con:
 *       * resend_response_status: status HTTP equivalente
 *       * resend_response_body: response cruda
 *       * resend_email_id: si vino
 *       * resend_error: si vino
 *       * timestamp_sent: ISO UTC
 *       * dns_status: estado del dominio según Resend (verified/pending/failed)
 *       * dns_records_missing: records DNS pendientes si los hay
 *
 * TODO: remove after hotfix 2E.3 verificado.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { EMAIL_FROM, getResend } from "@/lib/email/resend";

export const runtime = "nodejs";
export const maxDuration = 30;

const DEFAULT_TO = "oliver@clienteenelcentro.com";
const DOMAIN = "integra-panama.com";

interface ResendDomain {
  id: string;
  name: string;
  status: string;
  records?: Array<{
    record: string;
    name: string;
    type: string;
    value?: string;
    status?: string;
  }>;
}

async function fetchResendDomains(apiKey: string): Promise<{
  ok: boolean;
  status: number;
  body: unknown;
  domain?: ResendDomain;
}> {
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    let domain: ResendDomain | undefined;
    const list = (body as { data?: ResendDomain[] } | null)?.data;
    if (Array.isArray(list)) {
      domain = list.find((d) => d.name === DOMAIN);
    }
    return { ok: res.ok, status: res.status, body, domain };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (ctx.userRole !== "admin") {
    return NextResponse.json(
      { error: "Solo admins pueden ejecutar este endpoint de diagnóstico" },
      { status: 403 }
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "RESEND_API_KEY no está configurado en este entorno" },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const to = url.searchParams.get("to") ?? DEFAULT_TO;
  const timestamp = new Date().toISOString();

  // ---------- 1. Estado del dominio en Resend ----------
  const dnsCheck = await fetchResendDomains(apiKey);

  // ---------- 2. Test send ----------
  let resendResponseStatus: number | null = null;
  let resendEmailId: string | null = null;
  let resendError: unknown = null;
  let resendRawBody: unknown = null;

  try {
    const resend = getResend();
    const result = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject: `Test Resend CRM Integra Legal — ${timestamp}`,
      text: `Test de Resend desde CRM Integra Legal — ${timestamp}\n\nSi recibes este email, el envío vía Resend está funcionando correctamente con el dominio ${DOMAIN}.`,
      html: `<p>Test de Resend desde CRM Integra Legal — <strong>${timestamp}</strong></p><p>Si recibes este email, el envío vía Resend está funcionando correctamente con el dominio <code>${DOMAIN}</code>.</p>`,
    });
    resendRawBody = result;
    resendEmailId = result.data?.id ?? null;
    resendError = result.error ?? null;
    resendResponseStatus = result.error ? 422 : 200;
  } catch (err) {
    resendError =
      err instanceof Error ? { name: err.name, message: err.message } : err;
    resendResponseStatus = 0;
  }

  // ---------- 3. Armar tabla de records DNS faltantes (si hay) ----------
  const dnsRecordsMissing =
    dnsCheck.domain?.records?.filter(
      (r) => r.status && r.status !== "verified"
    ) ?? [];

  return NextResponse.json({
    timestamp_sent: timestamp,
    from: EMAIL_FROM,
    to,

    dns_status: dnsCheck.domain?.status ?? "domain_not_found_in_resend",
    dns_resend_api_ok: dnsCheck.ok,
    dns_resend_api_status: dnsCheck.status,
    dns_domain_record: dnsCheck.domain ?? null,
    dns_records_missing: dnsRecordsMissing,
    dns_raw_response: dnsCheck.body,

    resend_response_status: resendResponseStatus,
    resend_email_id: resendEmailId,
    resend_error: resendError,
    resend_response_body: resendRawBody,

    diagnosis:
      dnsCheck.domain?.status === "verified" && resendEmailId
        ? "✓ DNS verificado y envío aceptado por Resend. Si el email no llega, revisar spam, bounces en Resend dashboard, o reputación del IP."
        : dnsCheck.domain?.status !== "verified"
          ? `✗ Dominio ${DOMAIN} NO está verificado en Resend (status: ${dnsCheck.domain?.status ?? "no encontrado"}). Edwin debe completar los records DNS pendientes.`
          : "✗ DNS verificado pero el envío fue rechazado. Revisar resend_error para detalles.",
  });
}
