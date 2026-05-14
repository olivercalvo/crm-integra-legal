/**
 * Plantilla HTML del email de envío de cotización (Sprint 2E.3, D2 + D6).
 *
 * Convenciones:
 *   - HTML compatible con clientes de email mainstream (Gmail, Outlook,
 *     iOS Mail). Layout en tablas, inline styles, sin <style> global.
 *   - Tuteo neutro panameño (CLAUDE.md): "Te adjuntamos…", no "Te
 *     adjuntamos / Os adjuntamos / Le adjuntamos".
 *   - Paleta Integra: navy #1B2A4A, gold #C5A55A.
 *   - Sin imágenes externas (logo es text-only para evitar bloqueo de
 *     imágenes que muchos clientes hacen por default).
 *   - Texto plano disponible vía renderQuoteEmailText() para clientes
 *     que no renderizan HTML.
 */

export interface QuoteEmailProps {
  client_name: string;
  quote_number: string;
  valid_until: string;     // YYYY-MM-DD
  grand_total: number;
  currency: string;        // 'USD'
  public_link: string;
  sent_by_name: string;
  /** Línea de resumen (1-2 servicios principales). Opcional. */
  summary_line?: string | null;
}

const NAVY = "#1B2A4A";
const GOLD = "#C5A55A";
const GRAY_500 = "#6B7280";
const GRAY_700 = "#374151";
const GRAY_200 = "#E5E7EB";
const GRAY_50 = "#F9FAFB";
const BG = "#F3F4F6";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateEs(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatMoney(n: number, currency: string): string {
  const sign = currency === "USD" ? "$" : "";
  return `${sign}${(Math.round(n * 100) / 100).toFixed(2)} ${currency}`;
}

export function renderQuoteEmailHtml(props: QuoteEmailProps): string {
  const {
    client_name,
    quote_number,
    valid_until,
    grand_total,
    currency,
    public_link,
    sent_by_name,
    summary_line,
  } = props;

  const safeClient = escapeHtml(client_name);
  const safeNumber = escapeHtml(quote_number);
  const safeValidUntil = escapeHtml(formatDateEs(valid_until));
  const safeTotal = escapeHtml(formatMoney(grand_total, currency));
  const safeLink = escapeHtml(public_link);
  const safeSender = escapeHtml(sent_by_name);
  const safeSummary = summary_line ? escapeHtml(summary_line) : "";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>Cotización ${safeNumber} · Integra Legal</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BG};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:${NAVY};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border-radius:6px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
            <!-- Header (brand) -->
            <tr>
              <td style="background-color:${NAVY};padding:24px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="font-size:24px;font-weight:700;color:#FFFFFF;letter-spacing:2px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;">
                      INTEGRA
                    </td>
                    <td align="right" style="font-size:10px;font-weight:700;color:${GOLD};letter-spacing:3px;">
                      LEGAL · PANAMÁ
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;color:${NAVY};">
                  Estimado/a <strong>${safeClient}</strong>:
                </p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${GRAY_700};">
                  Te adjuntamos la cotización <strong style="color:${NAVY};font-family:monospace;">${safeNumber}</strong>
                  para los servicios solicitados. La oferta tiene vigencia hasta el
                  <strong style="color:${NAVY};">${safeValidUntil}</strong>.
                </p>

                <!-- Resumen monto -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GRAY_50};border:1px solid ${GRAY_200};border-radius:6px;margin:18px 0;">
                  <tr>
                    <td style="padding:14px 18px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:${GRAY_500};font-weight:600;">
                            Total cotizado
                          </td>
                          <td align="right" style="font-size:22px;font-weight:700;color:${NAVY};font-family:-apple-system,monospace;">
                            ${safeTotal}
                          </td>
                        </tr>
                        ${
                          safeSummary
                            ? `<tr><td colspan="2" style="padding-top:8px;font-size:12px;color:${GRAY_500};line-height:1.5;">${safeSummary}</td></tr>`
                            : ""
                        }
                      </table>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:${GRAY_700};">
                  Adjuntamos a este correo el PDF con el detalle completo, las líneas de servicio
                  y los Términos y Condiciones aplicables.
                </p>

                <!-- CTA -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
                  <tr>
                    <td style="border-radius:6px;background-color:${GOLD};">
                      <a href="${safeLink}" target="_blank" rel="noopener noreferrer"
                         style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:${NAVY};text-decoration:none;letter-spacing:0.5px;">
                        Ver y aceptar cotización →
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${GRAY_500};">
                  Si tenés cualquier consulta sobre esta cotización, responde directamente
                  a este correo y atenderemos tu consulta a la brevedad.
                </p>

                <p style="margin:24px 0 4px;font-size:14px;color:${GRAY_700};">Cordialmente,</p>
                <p style="margin:0;font-size:14px;font-weight:600;color:${NAVY};">${safeSender}</p>
                <p style="margin:0;font-size:13px;color:${GRAY_500};">Integra Legal · Panamá</p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background-color:${GRAY_50};padding:18px 28px;border-top:1px solid ${GRAY_200};">
                <p style="margin:0;font-size:11px;line-height:1.6;color:${GRAY_500};">
                  Este correo fue enviado desde el sistema de gestión de cotizaciones de Integra Legal.
                  La información contenida es confidencial y está protegida por el secreto profesional
                  conforme a las leyes de la República de Panamá.
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:16px 0 0;font-size:11px;color:${GRAY_500};">
            Integra Legal · Panamá
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Versión texto plano para clientes que no renderizan HTML. */
export function renderQuoteEmailText(props: QuoteEmailProps): string {
  const {
    client_name,
    quote_number,
    valid_until,
    grand_total,
    currency,
    public_link,
    sent_by_name,
    summary_line,
  } = props;

  const lines = [
    `Estimado/a ${client_name}:`,
    "",
    `Te adjuntamos la cotización ${quote_number} para los servicios solicitados.`,
    `La oferta tiene vigencia hasta el ${formatDateEs(valid_until)}.`,
    "",
    `Total cotizado: ${formatMoney(grand_total, currency)}`,
  ];

  if (summary_line) {
    lines.push(summary_line);
  }

  lines.push(
    "",
    "Adjuntamos el PDF con el detalle completo, las líneas de servicio y los",
    "Términos y Condiciones aplicables.",
    "",
    `Ver y aceptar la cotización: ${public_link}`,
    "",
    "Si tenés cualquier consulta sobre esta cotización, responde directamente a",
    "este correo.",
    "",
    "Cordialmente,",
    sent_by_name,
    "Integra Legal · Panamá"
  );

  return lines.join("\n");
}
