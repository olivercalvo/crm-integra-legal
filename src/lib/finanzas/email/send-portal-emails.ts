/**
 * Orquestador de envío de los emails post-portal (Sprint 2E.4).
 *
 * Para aceptación dispara 1 email al cliente (con PDF firmado adjunto) +
 * N emails a las abogadas. Para rechazo: 1 al cliente + N a las abogadas.
 *
 * Política: best-effort. Cada envío es independiente; un fallo individual
 * NO bloquea el resto. Loggea siempre el resultado por (to, ok).
 */

import { EMAIL_FROM, getResend } from "@/lib/email/resend";
import {
  renderClientAcceptanceHtml,
  renderClientAcceptanceText,
  type ClientAcceptanceEmailProps,
} from "@/lib/finanzas/email/client-acceptance-confirmation-template";
import {
  renderClientRejectionHtml,
  renderClientRejectionText,
  type ClientRejectionEmailProps,
} from "@/lib/finanzas/email/client-rejection-confirmation-template";
import {
  renderLawyerAcceptanceHtml,
  renderLawyerAcceptanceText,
  type LawyerAcceptanceEmailProps,
} from "@/lib/finanzas/email/lawyer-acceptance-notification-template";
import {
  renderLawyerRejectionHtml,
  renderLawyerRejectionText,
  type LawyerRejectionEmailProps,
} from "@/lib/finanzas/email/lawyer-rejection-notification-template";
import type { LawyerRecipient } from "@/lib/finanzas/email/get-lawyer-emails";

export interface SendResult {
  to: string;
  ok: boolean;
  resend_id?: string;
  error?: string;
}

interface ResendResponse {
  data?: { id?: string };
  error?: { message?: string };
}

/**
 * Envío genérico con validación estricta de data.id (lección Sprint 2E.3:
 * no confiar en `!error`, exigir data.id presente).
 */
async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: string }[];
}): Promise<SendResult> {
  try {
    const resend = getResend();
    const raw = await resend.emails.send({
      from: EMAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments,
    });
    // El tipado del SDK Resend es una unión discriminada {data,error:null} |
    // {data:null,error}. Para unificar la lectura usamos un shape compatible.
    const result = raw as unknown as ResendResponse;

    console.info("[finanzas/email] resend send", {
      to: opts.to,
      subject: opts.subject,
      has_id: !!result?.data?.id,
      error: result?.error?.message ?? null,
    });

    if (result?.error) {
      return {
        to: opts.to,
        ok: false,
        error: result.error.message ?? "Resend devolvió error",
      };
    }
    if (!result?.data?.id) {
      return {
        to: opts.to,
        ok: false,
        error: "Resend no devolvió id de envío",
      };
    }
    return { to: opts.to, ok: true, resend_id: result.data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[finanzas/email] resend send threw", { to: opts.to, err });
    return { to: opts.to, ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// ACCEPTANCE
// ---------------------------------------------------------------------------

export async function sendAcceptanceEmails(input: {
  client_to: string;
  client_props: ClientAcceptanceEmailProps;
  pdf_buffer: Buffer;
  pdf_file_name: string;
  lawyers: LawyerRecipient[];
  lawyer_props_base: Omit<LawyerAcceptanceEmailProps, "recipient_first_name">;
}): Promise<{ client: SendResult; lawyers: SendResult[] }> {
  const clientResult = await sendEmail({
    to: input.client_to,
    subject: `Aceptación registrada · Cotización ${input.client_props.quote_number}`,
    html: renderClientAcceptanceHtml(input.client_props),
    text: renderClientAcceptanceText(input.client_props),
    attachments: [
      {
        filename: input.pdf_file_name,
        content: input.pdf_buffer.toString("base64"),
      },
    ],
  });

  const lawyerResults: SendResult[] = [];
  for (const lawyer of input.lawyers) {
    const firstName = lawyer.full_name?.split(/\s+/)[0] ?? null;
    const props: LawyerAcceptanceEmailProps = {
      ...input.lawyer_props_base,
      recipient_first_name: firstName,
    };
    const res = await sendEmail({
      to: lawyer.email,
      subject: `Cliente aceptó · ${input.lawyer_props_base.quote_number} (${input.lawyer_props_base.client_name})`,
      html: renderLawyerAcceptanceHtml(props),
      text: renderLawyerAcceptanceText(props),
    });
    lawyerResults.push(res);
  }

  return { client: clientResult, lawyers: lawyerResults };
}

// ---------------------------------------------------------------------------
// REJECTION
// ---------------------------------------------------------------------------

export async function sendRejectionEmails(input: {
  client_to: string;
  client_props: ClientRejectionEmailProps;
  lawyers: LawyerRecipient[];
  lawyer_props_base: Omit<LawyerRejectionEmailProps, "recipient_first_name">;
}): Promise<{ client: SendResult; lawyers: SendResult[] }> {
  const clientResult = await sendEmail({
    to: input.client_to,
    subject: `Rechazo registrado · Cotización ${input.client_props.quote_number}`,
    html: renderClientRejectionHtml(input.client_props),
    text: renderClientRejectionText(input.client_props),
  });

  const lawyerResults: SendResult[] = [];
  for (const lawyer of input.lawyers) {
    const firstName = lawyer.full_name?.split(/\s+/)[0] ?? null;
    const props: LawyerRejectionEmailProps = {
      ...input.lawyer_props_base,
      recipient_first_name: firstName,
    };
    const res = await sendEmail({
      to: lawyer.email,
      subject: `Cliente rechazó · ${input.lawyer_props_base.quote_number} (${input.lawyer_props_base.client_name})`,
      html: renderLawyerRejectionHtml(props),
      text: renderLawyerRejectionText(props),
    });
    lawyerResults.push(res);
  }

  return { client: clientResult, lawyers: lawyerResults };
}
