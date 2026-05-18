/**
 * Email al cliente confirmando aceptación de la cotización (Sprint 2E.4).
 *
 * Va con el PDF firmado adjunto (incluye página de evidencia FES). El
 * cliente lo guarda como respaldo de la aceptación.
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

export interface ClientAcceptanceEmailProps {
  client_name: string;
  quote_number: string;
  title: string;
  accepted_at_panama: string;     // "DD/MM/YYYY HH:mm:ss · UTC-5"
  grand_total: number;
  currency: string;
  signer_name: string;
  signer_position: string;
}

export function renderClientAcceptanceHtml(
  props: ClientAcceptanceEmailProps
): string {
  const {
    client_name,
    quote_number,
    title,
    accepted_at_panama,
    grand_total,
    currency,
    signer_name,
    signer_position,
  } = props;

  const safeClient = escapeHtml(client_name);
  const safeNumber = escapeHtml(quote_number);
  const safeTitle = title ? escapeHtml(title) : "";
  const safeAcceptedAt = escapeHtml(accepted_at_panama);
  const safeTotal = escapeHtml(formatMoney(grand_total, currency));
  const safeSigner = escapeHtml(signer_name);
  const safePosition = escapeHtml(signer_position);

  const body = `
    <p style="margin:0 0 16px;font-size:16px;color:${NAVY};">
      Hola, <strong>${safeClient}</strong>:
    </p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${GRAY_700};">
      Confirmamos que registramos tu aceptación de la cotización
      <strong style="color:${NAVY};font-family:monospace;">${safeNumber}</strong>.
      ${safeTitle ? `<br /><span style="font-style:italic;color:${NAVY};">${safeTitle}</span>` : ""}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GRAY_50};border:1px solid ${GRAY_200};border-radius:6px;margin:18px 0;">
      <tr>
        <td style="padding:14px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:${GRAY_500};font-weight:600;padding-bottom:6px;">Aceptada</td>
              <td align="right" style="font-size:12px;color:${NAVY};padding-bottom:6px;">${safeAcceptedAt}</td>
            </tr>
            <tr>
              <td style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:${GRAY_500};font-weight:600;padding-bottom:6px;">Firmante</td>
              <td align="right" style="font-size:12px;color:${NAVY};padding-bottom:6px;">${safeSigner} · ${safePosition}</td>
            </tr>
            <tr>
              <td style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:${GRAY_500};font-weight:600;">Monto cotizado</td>
              <td align="right" style="font-size:18px;font-weight:700;color:${NAVY};font-family:-apple-system,monospace;">${safeTotal}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${GRAY_700};">
      Adjuntamos a este correo el PDF firmado, que incluye una página final
      con la evidencia electrónica de tu aceptación (firma electrónica simple
      conforme a la Ley 51 de 2008 de la República de Panamá).
    </p>

    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${GRAY_700};">
      Próximos pasos: nuestro equipo te contactará a la brevedad para
      coordinar el inicio de los servicios y los detalles operativos.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;">
      <tr>
        <td style="border-radius:6px;background-color:${GOLD};">
          <a href="mailto:notificaciones@integra-panama.com" target="_blank" rel="noopener noreferrer"
             style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:${NAVY};text-decoration:none;">
            Contactar al equipo
          </a>
        </td>
      </tr>
    </table>
  `;

  return wrapHtml({
    preheader: `Aceptación registrada: cotización ${quote_number}`,
    bodyHtml: body,
    signature: "Cordialmente,",
  });
}

export function renderClientAcceptanceText(
  props: ClientAcceptanceEmailProps
): string {
  return [
    `Hola, ${props.client_name}:`,
    "",
    `Confirmamos que registramos tu aceptación de la cotización ${props.quote_number}.`,
    props.title ? `Referencia: ${props.title}` : null,
    "",
    `Aceptada: ${props.accepted_at_panama}`,
    `Firmante: ${props.signer_name} (${props.signer_position})`,
    `Monto: ${formatMoney(props.grand_total, props.currency)}`,
    "",
    "Adjuntamos el PDF firmado con la evidencia electrónica de tu aceptación",
    "(firma electrónica simple conforme a la Ley 51 de 2008 de Panamá).",
    "",
    "Próximos pasos: nuestro equipo te contactará a la brevedad para",
    "coordinar el inicio de los servicios.",
    "",
    "Cordialmente,",
    "Integra Legal · Panamá",
  ]
    .filter((l) => l !== null)
    .join("\n");
}
