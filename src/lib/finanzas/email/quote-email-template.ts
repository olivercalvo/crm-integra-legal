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

export interface QuoteEmailLineSummary {
  description: string;
  /** "$123.45" o "—" si no aplica. Ya pre-formateado por el caller. */
  amount_label: string;
}

export interface QuoteEmailProps {
  client_name: string;
  quote_number: string;
  /** Título descriptivo de la cotización (Sprint 2E.3.2). Va al subject y al cuerpo. */
  title: string;
  valid_until: string;     // YYYY-MM-DD
  grand_total: number;
  currency: string;        // 'USD'
  public_link: string;
  sent_by_name: string;
  /**
   * Resumen de líneas para mostrar en el cuerpo del email (Sprint 2E.4 P1).
   * Mostrar 3-5 ítems máx; si hay más, agregar texto "y X más" desde el caller
   * o pasar `extra_lines_count`.
   */
  line_summary?: QuoteEmailLineSummary[];
  /** Si line_summary fue truncada, indica cuántas líneas adicionales hay. */
  extra_lines_count?: number;
  /** URL pública para descargar el PDF directamente (sin abrir el portal). */
  pdf_download_link?: string;
  /**
   * @deprecated Antes (Sprint 2E.3) un único string. Mantenido por
   * compatibilidad con callers existentes — si llega, se muestra abajo
   * del resumen. Preferir `line_summary`.
   */
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

const LOGO_URL =
  "https://crm-integra-legal.vercel.app/email/integra-logo-email.png";

export function renderQuoteEmailHtml(props: QuoteEmailProps): string {
  const {
    client_name,
    quote_number,
    title,
    valid_until,
    grand_total,
    currency,
    public_link,
    sent_by_name,
    line_summary,
    extra_lines_count,
    pdf_download_link,
    summary_line,
  } = props;

  const safeClient = escapeHtml(client_name);
  const safeNumber = escapeHtml(quote_number);
  const safeTitle = title ? escapeHtml(title) : "";
  const safeValidUntil = escapeHtml(formatDateEs(valid_until));
  const safeTotal = escapeHtml(formatMoney(grand_total, currency));
  const safeLink = escapeHtml(public_link);
  const safeSender = escapeHtml(sent_by_name);
  const safeLegacySummary = summary_line ? escapeHtml(summary_line) : "";

  // Resumen de líneas (Sprint 2E.4 P1): tabla compacta con 3-5 ítems.
  const summaryRows =
    line_summary && line_summary.length > 0
      ? line_summary
          .slice(0, 5)
          .map(
            (ln) => `
              <tr>
                <td style="padding:6px 0;font-size:13px;color:${NAVY};line-height:1.4;border-top:1px solid ${GRAY_200};">${escapeHtml(ln.description)}</td>
                <td align="right" style="padding:6px 0;font-size:13px;color:${NAVY};font-family:-apple-system,monospace;border-top:1px solid ${GRAY_200};white-space:nowrap;padding-left:12px;">${escapeHtml(ln.amount_label)}</td>
              </tr>`
          )
          .join("")
      : "";
  const extraLinesHint =
    extra_lines_count && extra_lines_count > 0
      ? `<tr><td colspan="2" style="padding:6px 0 0;font-size:12px;color:${GRAY_500};font-style:italic;border-top:1px solid ${GRAY_200};">y ${extra_lines_count} línea${extra_lines_count === 1 ? "" : "s"} más en el PDF adjunto</td></tr>`
      : "";

  const safePdfLink = pdf_download_link ? escapeHtml(pdf_download_link) : "";

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
            <!-- Header con logo real (Sprint 2E.4 P2) -->
            <tr>
              <td style="background-color:${NAVY};padding:20px 28px;" align="left">
                <img src="${LOGO_URL}" width="120" alt="Integra Legal" style="display:block;height:auto;max-width:120px;" />
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;color:${NAVY};">
                  Hola, <strong>${safeClient}</strong>:
                </p>
                <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${GRAY_700};">
                  Te enviamos la cotización <strong style="color:${NAVY};font-family:monospace;">${safeNumber}</strong>
                  para los servicios solicitados${safeTitle ? `: <span style="font-style:italic;color:${NAVY};">${safeTitle}</span>` : ""}.
                </p>

                <!-- Card resumen: número + monto + vigencia + líneas -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GRAY_50};border:1px solid ${GRAY_200};border-radius:6px;margin:18px 0;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:${GRAY_500};font-weight:600;padding-bottom:6px;">Cotización</td>
                          <td align="right" style="font-size:13px;color:${NAVY};font-family:monospace;padding-bottom:6px;">${safeNumber}</td>
                        </tr>
                        <tr>
                          <td style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:${GRAY_500};font-weight:600;padding-bottom:6px;">Vigencia hasta</td>
                          <td align="right" style="font-size:13px;color:${NAVY};padding-bottom:6px;">${safeValidUntil}</td>
                        </tr>
                        <tr>
                          <td style="font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:${GRAY_500};font-weight:600;">Monto total</td>
                          <td align="right" style="font-size:20px;font-weight:700;color:${NAVY};font-family:-apple-system,monospace;">${safeTotal}</td>
                        </tr>
                        ${summaryRows ? `<tr><td colspan="2" style="padding-top:10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${summaryRows}${extraLinesHint}</table></td></tr>` : ""}
                        ${safeLegacySummary && !summaryRows ? `<tr><td colspan="2" style="padding-top:8px;font-size:12px;color:${GRAY_500};line-height:1.5;">${safeLegacySummary}</td></tr>` : ""}
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- CTA hero -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;">
                  <tr>
                    <td style="border-radius:6px;background-color:${GOLD};">
                      <a href="${safeLink}" target="_blank" rel="noopener noreferrer"
                         style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:${NAVY};text-decoration:none;letter-spacing:0.5px;">
                        Ver cotización online →
                      </a>
                    </td>
                  </tr>
                </table>

                ${safePdfLink ? `<p style="margin:6px 0 18px;font-size:13px;color:${GRAY_500};">
                  O <a href="${safePdfLink}" style="color:${NAVY};text-decoration:underline;">descargar el PDF directamente</a>.
                </p>` : `<p style="margin:6px 0 18px;font-size:13px;color:${GRAY_500};">
                  El PDF también va adjunto a este correo.
                </p>`}

                <p style="margin:14px 0;font-size:14px;line-height:1.6;color:${GRAY_700};">
                  Desde el portal online puedes aceptar o rechazar la cotización
                  con tu firma electrónica. Si prefieres discutir algún detalle
                  primero, basta con responder este correo.
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
                  Integra Legal · Servicios legales en la República de Panamá.
                  Esta comunicación es confidencial y está protegida por el
                  secreto profesional conforme a las leyes panameñas.
                </p>
              </td>
            </tr>
          </table>
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
    title,
    valid_until,
    grand_total,
    currency,
    public_link,
    sent_by_name,
    line_summary,
    extra_lines_count,
    pdf_download_link,
    summary_line,
  } = props;

  const lines = [`Hola, ${client_name}:`, ""];

  lines.push(
    title && title.trim().length > 0
      ? `Te enviamos la cotización ${quote_number}: ${title}.`
      : `Te enviamos la cotización ${quote_number}.`,
    "",
    `Monto total: ${formatMoney(grand_total, currency)}`,
    `Vigencia hasta: ${formatDateEs(valid_until)}`
  );

  if (line_summary && line_summary.length > 0) {
    lines.push("", "Resumen:");
    for (const ln of line_summary.slice(0, 5)) {
      lines.push(`  • ${ln.description} — ${ln.amount_label}`);
    }
    if (extra_lines_count && extra_lines_count > 0) {
      lines.push(
        `  (y ${extra_lines_count} línea${extra_lines_count === 1 ? "" : "s"} más en el PDF adjunto)`
      );
    }
  } else if (summary_line) {
    lines.push("", summary_line);
  }

  lines.push(
    "",
    `Ver cotización online: ${public_link}`,
    pdf_download_link
      ? `Descargar PDF: ${pdf_download_link}`
      : "El PDF también va adjunto a este correo.",
    "",
    "Desde el portal puedes aceptar o rechazar la cotización con tu firma",
    "electrónica. Si prefieres discutir algún detalle primero, basta con",
    "responder este correo.",
    "",
    "Cordialmente,",
    sent_by_name,
    "Integra Legal · Panamá"
  );

  return lines.join("\n");
}
