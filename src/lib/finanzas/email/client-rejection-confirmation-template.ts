/**
 * Email al cliente confirmando que registramos su rechazo (Sprint 2E.4, D9).
 *
 * Tono empático pero profesional. NO adjunta nada — solo confirma que el
 * rechazo quedó registrado e invita a futuras consultas.
 */

import {
  escapeHtml,
  wrapHtml,
  GRAY_500,
  GRAY_700,
  NAVY,
} from "@/lib/finanzas/email/notification-shared";

export interface ClientRejectionEmailProps {
  client_name: string;
  quote_number: string;
  title: string;
}

export function renderClientRejectionHtml(
  props: ClientRejectionEmailProps
): string {
  const { client_name, quote_number, title } = props;
  const safeClient = escapeHtml(client_name);
  const safeNumber = escapeHtml(quote_number);
  const safeTitle = title ? escapeHtml(title) : "";

  const body = `
    <p style="margin:0 0 16px;font-size:16px;color:${NAVY};">
      Hola, <strong>${safeClient}</strong>:
    </p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${GRAY_700};">
      Registramos tu decisión de no proceder con la cotización
      <strong style="color:${NAVY};font-family:monospace;">${safeNumber}</strong>${safeTitle ? ` <span style="font-style:italic;color:${NAVY};">(${safeTitle})</span>` : ""}.
    </p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${GRAY_700};">
      Agradecemos el tiempo que dedicaste a revisarla. Si en el futuro tu
      situación cambia o necesitas otra propuesta, quedamos a tu
      disposición — responder a este correo es la vía más rápida para
      retomar el contacto.
    </p>
    <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:${GRAY_500};">
      Esta cotización quedó cerrada en nuestros registros y no se generarán
      facturas a partir de ella.
    </p>
  `;

  return wrapHtml({
    preheader: `Rechazo registrado: cotización ${quote_number}`,
    bodyHtml: body,
    signature: "Cordialmente,",
  });
}

export function renderClientRejectionText(
  props: ClientRejectionEmailProps
): string {
  return [
    `Hola, ${props.client_name}:`,
    "",
    `Registramos tu decisión de no proceder con la cotización ${props.quote_number}.`,
    props.title ? `Referencia: ${props.title}` : null,
    "",
    "Agradecemos el tiempo que dedicaste a revisarla. Si en el futuro",
    "necesitas otra propuesta, responder a este correo es la vía más rápida",
    "para retomar el contacto.",
    "",
    "Esta cotización quedó cerrada en nuestros registros y no se generarán",
    "facturas a partir de ella.",
    "",
    "Cordialmente,",
    "Integra Legal · Panamá",
  ]
    .filter((l) => l !== null)
    .join("\n");
}
