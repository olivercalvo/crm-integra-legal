/**
 * Email a las abogadas notificando que un cliente rechazó una cotización
 * desde el portal (Sprint 2E.4).
 *
 * Incluye: datos del cliente, motivo del rechazo, link directo al CRM.
 */

import {
  escapeHtml,
  wrapHtml,
  GOLD,
  GRAY_50,
  GRAY_200,
  GRAY_500,
  GRAY_700,
  NAVY,
} from "@/lib/finanzas/email/notification-shared";

export interface LawyerRejectionEmailProps {
  recipient_first_name: string | null;
  client_name: string;
  quote_number: string;
  title: string;
  rejected_at_panama: string;
  reason: string;
  crm_link: string;
}

export function renderLawyerRejectionHtml(
  props: LawyerRejectionEmailProps
): string {
  const {
    recipient_first_name,
    client_name,
    quote_number,
    title,
    rejected_at_panama,
    reason,
    crm_link,
  } = props;

  const greeting = recipient_first_name
    ? `Hola, ${escapeHtml(recipient_first_name)}:`
    : "Hola:";

  const body = `
    <p style="margin:0 0 16px;font-size:16px;color:${NAVY};">${greeting}</p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${GRAY_700};">
      <strong>${escapeHtml(client_name)}</strong> rechazó la cotización
      <strong style="color:${NAVY};font-family:monospace;">${escapeHtml(quote_number)}</strong>${title ? ` <span style="font-style:italic;color:${NAVY};">(${escapeHtml(title)})</span>` : ""}.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GRAY_50};border:1px solid ${GRAY_200};border-radius:6px;margin:18px 0;">
      <tr>
        <td style="padding:14px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:${GRAY_500};font-weight:600;padding-bottom:8px;">Rechazada</td>
              <td align="right" style="font-size:12px;color:${NAVY};padding-bottom:8px;">${escapeHtml(rejected_at_panama)}</td>
            </tr>
            <tr>
              <td colspan="2" style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:${GRAY_500};font-weight:600;padding-bottom:4px;">Motivo del cliente</td>
            </tr>
            <tr>
              <td colspan="2" style="font-size:13px;color:${NAVY};line-height:1.5;background-color:#FFFFFF;border:1px solid ${GRAY_200};border-radius:4px;padding:10px;">
                ${escapeHtml(reason).replace(/\n/g, "<br />")}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

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
  `;

  return wrapHtml({
    preheader: `${client_name} rechazó la cotización ${quote_number}`,
    bodyHtml: body,
  });
}

export function renderLawyerRejectionText(
  props: LawyerRejectionEmailProps
): string {
  const greeting = props.recipient_first_name
    ? `Hola, ${props.recipient_first_name}:`
    : "Hola:";

  return [
    greeting,
    "",
    `${props.client_name} rechazó la cotización ${props.quote_number}.`,
    props.title ? `Referencia: ${props.title}` : null,
    "",
    `Rechazada: ${props.rejected_at_panama}`,
    "",
    "Motivo del cliente:",
    props.reason,
    "",
    `Ver en el CRM: ${props.crm_link}`,
    "",
    "— CRM Integra Legal",
  ]
    .filter((l) => l !== null)
    .join("\n");
}
