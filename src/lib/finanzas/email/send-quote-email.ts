/**
 * Envío del email de cotización con PDF adjunto vía Resend (Sprint 2E.3, D2).
 *
 * El caller debe haber preparado el buffer del PDF y los datos del cliente.
 * Devuelve { ok: true } en éxito o { ok: false, error } en falla.
 *
 * NO lanza errores — la falla del email NO debe revertir la transición de
 * estado del quote (D2: el cliente puede recibir el link público manualmente
 * si el email falla).
 */

import { EMAIL_FROM, getResend } from "@/lib/email/resend";
import {
  renderQuoteEmailHtml,
  renderQuoteEmailText,
  type QuoteEmailProps,
} from "@/lib/finanzas/email/quote-email-template";

export interface SendQuoteEmailInput {
  to: string;
  subject?: string;
  pdfBuffer: Buffer;
  pdfFileName: string;
  email: QuoteEmailProps;
}

export interface SendQuoteEmailResult {
  ok: boolean;
  /** ID del envío en Resend si fue exitoso. */
  resend_id?: string;
  /** Mensaje de error si ok=false. */
  error?: string;
}

export async function sendQuoteEmail(
  input: SendQuoteEmailInput
): Promise<SendQuoteEmailResult> {
  const { to, pdfBuffer, pdfFileName, email } = input;

  const subject =
    input.subject ?? `Cotización ${email.quote_number} · Integra Legal`;

  try {
    const resend = getResend();
    const html = renderQuoteEmailHtml(email);
    const text = renderQuoteEmailText(email);

    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
      text,
      attachments: [
        {
          filename: pdfFileName,
          content: pdfBuffer.toString("base64"),
        },
      ],
    });

    if (error) {
      console.error("[finanzas/email] resend returned error", error);
      return {
        ok: false,
        error: error.message ?? "Resend rechazó el envío del email",
      };
    }

    return { ok: true, resend_id: data?.id };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error desconocido al enviar email";
    console.error("[finanzas/email] sendQuoteEmail threw", err);
    return { ok: false, error: message };
  }
}
