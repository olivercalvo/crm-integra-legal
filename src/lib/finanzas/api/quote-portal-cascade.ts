/**
 * Cascada de acciones post-aceptación / post-rechazo del portal público
 * (Sprint 2E.4, P5/P6).
 *
 * Estos helpers se invocan DESPUÉS de que commitAcceptance/commitRejection
 * persistieron el estado crítico (UPDATE quotes + INSERT audit row). Su
 * objetivo es disparar los "efectos colaterales" — PDF firmado, conversión
 * a facturas, emails — sin bloquear la respuesta al cliente: cada paso es
 * best-effort y un fallo se loguea pero NO rollbackea la aceptación legal.
 *
 * Convención de retorno: cada función devuelve un resumen estructurado
 * (`postHooksResult`) que el endpoint puede registrar en console.info para
 * audit operativo. NO se loguea en BD — un futuro Sprint podría agregar
 * una tabla `portal_post_hook_runs` si hace falta dashboards.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { convertToInvoices } from "@/lib/finanzas/api/quotes";
import { ensureSignedQuotePdf } from "@/lib/finanzas/pdf/ensure-signed-quote-pdf";
import { getLawyerEmails } from "@/lib/finanzas/email/get-lawyer-emails";
import {
  sendAcceptanceEmails,
  sendRejectionEmails,
  type SendResult,
} from "@/lib/finanzas/email/send-portal-emails";
import type { AcceptResult, RejectResult } from "@/lib/finanzas/api/quote-portal";
import { getPublicAppUrl } from "@/lib/utils/public-url";

type DB = SupabaseClient;

function formatPanamaTimestamp(isoUtc: string): string {
  const d = new Date(isoUtc);
  const fmt = new Intl.DateTimeFormat("es-PA", {
    timeZone: "America/Panama",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get(
    "minute"
  )}:${get("second")} · UTC-5`;
}

// ---------------------------------------------------------------------------
// ACCEPTANCE cascade
// ---------------------------------------------------------------------------

export interface AcceptanceCascadeResult {
  signed_pdf_ok: boolean;
  signed_pdf_error?: string;
  invoices_created: number;
  invoices_error?: string;
  emails: { client: SendResult | null; lawyers: SendResult[] };
}

export async function runAcceptanceCascade(
  db: DB,
  ctx: { tenantId: string; userId: string | null },
  acceptResult: AcceptResult
): Promise<AcceptanceCascadeResult> {
  const { bundle, acceptance_id, signature_text, accepted_at } = acceptResult;
  const result: AcceptanceCascadeResult = {
    signed_pdf_ok: false,
    invoices_created: 0,
    emails: { client: null, lawyers: [] },
  };

  // 0. Cargar el acceptance row completo — necesario para el PDF firmado
  //    y para los emails (datos del firmante + audit log técnico).
  const { data: accRow } = await db
    .from("quote_acceptances")
    .select(
      "full_name, position, id_document, ip_address, user_agent, origin_url, consent_text_version"
    )
    .eq("id", acceptance_id)
    .maybeSingle();
  const signerName = (accRow?.full_name as string | null) ?? "";
  const signerPosition = (accRow?.position as string | null) ?? "";
  const signerDoc = (accRow?.id_document as string | null) ?? null;
  const accIp = (accRow?.ip_address as string | null) ?? null;
  const accUa = (accRow?.user_agent as string | null) ?? null;
  const accOrigin = (accRow?.origin_url as string | null) ?? null;
  const accConsentVer = (accRow?.consent_text_version as string | null) ?? "";

  // 1. PDF firmado + upload + documents rows.
  let pdfBuffer: Buffer | null = null;
  let pdfFileName: string | null = null;
  try {
    const signed = await ensureSignedQuotePdf(db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      quoteId: bundle.id,
      clientId: bundle.client.id,
      caseId: bundle.case_id,
      acceptanceRowId: acceptance_id,
      full_name: signerName,
      position: signerPosition,
      id_document: signerDoc,
      accepted_at_iso: accepted_at,
      ip_address: accIp,
      user_agent: accUa,
      origin_url: accOrigin,
      consent_text_version: accConsentVer,
      signature_text,
    });
    pdfBuffer = signed.buffer;
    pdfFileName = signed.file_name;
    result.signed_pdf_ok = true;
  } catch (err) {
    result.signed_pdf_error =
      err instanceof Error ? err.message : "Error desconocido al firmar PDF";
    console.error("[finanzas/portal] PDF firmado FALLÓ", err);
  }

  // 2. convertToInvoices (1-2 facturas borrador).
  try {
    // convertToInvoices necesita un userId — para portal público usamos el
    // created_by del quote como fallback (la abogada que la creó).
    let actorUserId = ctx.userId;
    if (!actorUserId) {
      const { data: q } = await db
        .from("quotes")
        .select("created_by")
        .eq("tenant_id", ctx.tenantId)
        .eq("id", bundle.id)
        .maybeSingle();
      actorUserId = (q?.created_by as string | null) ?? null;
    }
    if (!actorUserId) {
      throw new Error("Sin actor user_id para convertToInvoices");
    }
    const convResult = await convertToInvoices(
      db,
      ctx.tenantId,
      actorUserId,
      bundle.id
    );
    result.invoices_created = convResult.invoice_ids.length;
  } catch (err) {
    result.invoices_error =
      err instanceof Error ? err.message : "Error desconocido al convertir";
    console.error("[finanzas/portal] convertToInvoices FALLÓ", err);
  }

  // 3. Emails (los datos del firmante ya los cargamos en el paso 0).
  const acceptedAtPanama = formatPanamaTimestamp(accepted_at);
  const crmLink = `${getPublicAppUrl()}/finanzas/cotizaciones/${bundle.id}`;

  try {
    const lawyers = await getLawyerEmails(db, ctx.tenantId);

    // Smoke Test 7 fix: el correo al cliente debe ir al mismo destinatario
    // al que se envió la cotización (override del modal), no a client.email
    // por defecto. Fallback a client.email para cotizaciones legacy pre
    // Sprint 2E.3 que pudieran no tener sent_to_email persistido.
    const clientTo = bundle.sent_to_email ?? bundle.client.email;

    if (clientTo) {
      const emails = await sendAcceptanceEmails({
        client_to: clientTo,
        client_props: {
          client_name: bundle.client.name,
          quote_number: bundle.quote_number,
          title: bundle.title,
          accepted_at_panama: acceptedAtPanama,
          grand_total: bundle.grand_total,
          currency: bundle.currency,
          signer_name: signerName,
          signer_position: signerPosition,
        },
        pdf_buffer: pdfBuffer ?? Buffer.from(""),    // si PDF falló, mandamos email sin adjunto
        pdf_file_name: pdfFileName ?? `${bundle.quote_number}-firmada.pdf`,
        lawyers,
        lawyer_props_base: {
          client_name: bundle.client.name,
          quote_number: bundle.quote_number,
          title: bundle.title,
          accepted_at_panama: acceptedAtPanama,
          grand_total: bundle.grand_total,
          currency: bundle.currency,
          signer_name: signerName,
          signer_position: signerPosition,
          signer_id_document: signerDoc,
          invoice_count: result.invoices_created,
          crm_link: crmLink,
        },
      });
      result.emails.client = emails.client;
      result.emails.lawyers = emails.lawyers;
    } else {
      console.warn(
        "[finanzas/portal] cliente sin email, NO se manda confirmación al cliente — solo abogadas"
      );
      // Sin email del cliente, mandamos solo el lawyer notification via
      // sendAcceptanceEmails con un client_to dummy y un pdfBuffer vacío;
      // pero descartamos el clientResult (es esperable que falle).
      const dummy = await sendAcceptanceEmails({
        client_to: "no-client-email@invalid.local",
        client_props: {
          client_name: bundle.client.name,
          quote_number: bundle.quote_number,
          title: bundle.title,
          accepted_at_panama: acceptedAtPanama,
          grand_total: bundle.grand_total,
          currency: bundle.currency,
          signer_name: signerName,
          signer_position: signerPosition,
        },
        pdf_buffer: Buffer.from(""),
        pdf_file_name: "no-client.pdf",
        lawyers,
        lawyer_props_base: {
          client_name: bundle.client.name,
          quote_number: bundle.quote_number,
          title: bundle.title,
          accepted_at_panama: acceptedAtPanama,
          grand_total: bundle.grand_total,
          currency: bundle.currency,
          signer_name: signerName,
          signer_position: signerPosition,
          signer_id_document: signerDoc,
          invoice_count: result.invoices_created,
          crm_link: crmLink,
        },
      });
      result.emails.client = {
        to: "—",
        ok: false,
        error: "cliente sin email registrado",
      };
      result.emails.lawyers = dummy.lawyers;
    }
  } catch (err) {
    console.error("[finanzas/portal] sendAcceptanceEmails FALLÓ", err);
  }

  return result;
}

// ---------------------------------------------------------------------------
// REJECTION cascade
// ---------------------------------------------------------------------------

export interface RejectionCascadeResult {
  emails: { client: SendResult | null; lawyers: SendResult[] };
}

export async function runRejectionCascade(
  db: DB,
  ctx: { tenantId: string },
  rejectResult: RejectResult
): Promise<RejectionCascadeResult> {
  const { bundle, rejected_at, reason } = rejectResult;
  const rejectedAtPanama = formatPanamaTimestamp(rejected_at);
  const crmLink = `${getPublicAppUrl()}/finanzas/cotizaciones/${bundle.id}`;

  const result: RejectionCascadeResult = {
    emails: { client: null, lawyers: [] },
  };

  try {
    const lawyers = await getLawyerEmails(db, ctx.tenantId);

    // Smoke Test 7 fix: ver runAcceptanceCascade — mismo criterio.
    const clientTo = bundle.sent_to_email ?? bundle.client.email;

    if (clientTo) {
      const emails = await sendRejectionEmails({
        client_to: clientTo,
        client_props: {
          client_name: bundle.client.name,
          quote_number: bundle.quote_number,
          title: bundle.title,
        },
        lawyers,
        lawyer_props_base: {
          client_name: bundle.client.name,
          quote_number: bundle.quote_number,
          title: bundle.title,
          rejected_at_panama: rejectedAtPanama,
          reason,
          crm_link: crmLink,
        },
      });
      result.emails.client = emails.client;
      result.emails.lawyers = emails.lawyers;
    } else {
      console.warn(
        "[finanzas/portal] cliente sin email, solo notificamos a abogadas"
      );
      result.emails.client = {
        to: "—",
        ok: false,
        error: "cliente sin email registrado",
      };
    }
  } catch (err) {
    console.error("[finanzas/portal] sendRejectionEmails FALLÓ", err);
  }

  return result;
}
