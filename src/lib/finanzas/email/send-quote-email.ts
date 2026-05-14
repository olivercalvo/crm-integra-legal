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

  // Subject (Sprint 2E.3.2): si la cotización tiene title, lo incluimos
  // para que el cliente lo vea en su bandeja sin abrir el correo. Si no
  // (cotización vieja antes del backfill), fallback al subject anterior.
  const defaultSubject =
    email.title && email.title.trim().length > 0
      ? `Cotización ${email.quote_number}: ${email.title.trim()} · Integra Legal`
      : `Cotización ${email.quote_number} · Integra Legal`;
  const subject = input.subject ?? defaultSubject;

  try {
    const resend = getResend();
    const html = renderQuoteEmailHtml(email);
    const text = renderQuoteEmailText(email);

    const sendResult = await resend.emails.send({
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

    // Hotfix Sprint 2E.3 (smoke 2026-05-14): Oliver reportó silent failure
    // (banner verde mostraba "Email enviado" pero el email no llegaba al
    // inbox). El check anterior — `if (error) { ... } return { ok: true }`
    // — no validaba que data.id estuviera presente, así que cualquier
    // respuesta de Resend sin error explícito se tomaba como éxito.
    //
    // Ahora validamos de forma estricta:
    //   1. data presente con .id (Resend devuelve un UUID en envíos
    //      aceptados — sin id NO hay envío real).
    //   2. error null/undefined.
    //
    // Además logueamos el response completo (no solo en error) para que
    // los logs de Vercel reflejen siempre el resultado del envío.
    const { data, error } = sendResult;
    console.info("[finanzas/email] resend response", {
      to,
      from: EMAIL_FROM,
      has_data: data != null,
      data_id: data?.id ?? null,
      error_name: error?.name ?? null,
      error_message: error?.message ?? null,
    });

    if (error) {
      console.error("[finanzas/email] resend returned error", error);
      return {
        ok: false,
        error: error.message ?? "Resend rechazó el envío del email",
      };
    }

    if (!data?.id) {
      // Caso extremo: ni data.id ni error. NO podemos confirmar el envío.
      console.error(
        "[finanzas/email] resend devolvió respuesta sin .id ni error — tratamos como fallido",
        sendResult
      );
      return {
        ok: false,
        error: "Resend no devolvió un id de envío — no podemos confirmar entrega",
      };
    }

    return { ok: true, resend_id: data.id };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error desconocido al enviar email";
    console.error("[finanzas/email] sendQuoteEmail threw", err);
    return { ok: false, error: message };
  }
}
