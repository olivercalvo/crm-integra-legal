/**
 * Email a las abogadas notificando que un cliente aceptó una cotización
 * desde el portal (Sprint 2E.4).
 *
 * Incluye: datos del cliente, monto, firmante, link directo al CRM y aviso
 * sobre las facturas borrador generadas automáticamente.
 */

import {
  escapeHtml,
  formatMoney,
  wrapHtml,
  GOLD,
  GRAY_50,
  GRAY_200,
  GRAY_500,
  GRAY_700,
  NAVY,
} from "@/lib/finanzas/email/notification-shared";

export interface LawyerAcceptanceEmailProps {
  recipient_first_name: string | null;   // null = saludo genérico
  client_name: string;
  quote_number: string;
  title: string;
  accepted_at_panama: string;
  grand_total: number;
  currency: string;
  signer_name: string;
  signer_position: string;
  signer_id_document: string | null;
  invoice_count: number;                  // 0 si no se generaron facturas (best-effort falló)
  crm_link: string;
}

export function renderLawyerAcceptanceHtml(
  props: LawyerAcceptanceEmailProps
): string {
  const {
    recipient_first_name,
    client_name,
    quote_number,
    title,
    accepted_at_panama,
    grand_total,
    currency,
    signer_name,
    signer_position,
    signer_id_document,
    invoice_count,
    crm_link,
  } = props;

  const greeting = recipient_first_name
    ? `Hola, ${escapeHtml(recipient_first_name)}:`
    : "Hola:";

  const invoiceLine =
    invoice_count > 0
      ? `Se generaron <strong>${invoice_count}</strong> factura${invoice_count === 1 ? "" : "s"} en estado borrador a partir de la cotización. Necesitan revisión antes de emitirlas.`
      : `La generación automática de facturas falló. Será necesario crear las facturas manualmente desde el CRM.`;

  const body = `
    <p style="margin:0 0 16px;font-size:16px;color:${NAVY};">${greeting}</p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${GRAY_700};">
      <strong>${escapeHtml(client_name)}</strong> aceptó la cotización
      <strong style="color:${NAVY};font-family:monospace;">${escapeHtml(quote_number)}</strong>${title ? ` <span style="font-style:italic;color:${NAVY};">(${escapeHtml(title)})</span>` : ""}.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GRAY_50};border:1px solid ${GRAY_200};border-radius:6px;margin:18px 0;">
      <tr>
        <td style="padding:14px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:${GRAY_500};font-weight:600;padding-bottom:6px;">Aceptada</td>
              <td align="right" style="font-size:12px;color:${NAVY};padding-bottom:6px;">${escapeHtml(accepted_at_panama)}</td>
            </tr>
            <tr>
              <td style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:${GRAY_500};font-weight:600;padding-bottom:6px;">Firmante</td>
              <td align="right" style="font-size:12px;color:${NAVY};padding-bottom:6px;">
                ${escapeHtml(signer_name)} · ${escapeHtml(signer_position)}
                ${signer_id_document ? `<br /><span style="color:${GRAY_500};font-size:11px;">Doc: ${escapeHtml(signer_id_document)}</span>` : ""}
              </td>
            </tr>
            <tr>
              <td style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:${GRAY_500};font-weight:600;">Monto</td>
              <td align="right" style="font-size:18px;font-weight:700;color:${NAVY};font-family:-apple-system,monospace;">${escapeHtml(formatMoney(grand_total, currency))}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${GRAY_700};">
      ${invoiceLine}
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;">
      <tr>
        <td style="border-radius:6px;background-color:${GOLD};">
          <a href="${escapeHtml(crm_link)}" target="_blank" rel="noopener noreferrer"
             style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:${NAVY};text-decoration:none;">
            Ver en el CRM →
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:${GRAY_500};">
      El PDF firmado con la evidencia electrónica de la aceptación ya está
      disponible en la sección Documentos del cliente${invoice_count > 0 ? " y del caso asociado" : ""}.
    </p>
  `;

  return wrapHtml({
    preheader: `${client_name} aceptó la cotización ${quote_number}`,
    bodyHtml: body,
  });
}

export function renderLawyerAcceptanceText(
  props: LawyerAcceptanceEmailProps
): string {
  const greeting = props.recipient_first_name
    ? `Hola, ${props.recipient_first_name}:`
    : "Hola:";

  const invoiceLine =
    props.invoice_count > 0
      ? `Se generaron ${props.invoice_count} factura(s) en estado borrador. Necesitan revisión antes de emitirlas.`
      : `La generación automática de facturas falló. Crearlas manualmente desde el CRM.`;

  return [
    greeting,
    "",
    `${props.client_name} aceptó la cotización ${props.quote_number}.`,
    props.title ? `Referencia: ${props.title}` : null,
    "",
    `Aceptada: ${props.accepted_at_panama}`,
    `Firmante: ${props.signer_name} (${props.signer_position})${props.signer_id_document ? ` · Doc: ${props.signer_id_document}` : ""}`,
    `Monto: ${formatMoney(props.grand_total, props.currency)}`,
    "",
    invoiceLine,
    "",
    `Ver en el CRM: ${props.crm_link}`,
    "",
    "El PDF firmado ya está disponible en Documentos del cliente",
    props.invoice_count > 0 ? "y del caso asociado." : ".",
    "",
    "— CRM Integra Legal",
  ]
    .filter((l) => l !== null)
    .join("\n");
}
