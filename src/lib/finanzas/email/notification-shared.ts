/**
 * Helpers compartidos entre los 4 templates de notificación del Sprint 2E.4.
 *
 * Mantiene la paleta y los wrappers HTML consistentes con quote-email-template.ts
 * (header navy con logo + cuerpo + footer) — DRY para reducir mantenimiento.
 */

import { getEmailLogoUrl } from "@/lib/utils/public-url";

export const NAVY = "#1B2A4A";
export const GOLD = "#C5A55A";
export const GRAY_500 = "#6B7280";
export const GRAY_700 = "#374151";
export const GRAY_200 = "#E5E7EB";
export const GRAY_50 = "#F9FAFB";
export const BG = "#F3F4F6";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDateEs(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function formatMoney(n: number, currency: string): string {
  const sign = currency === "USD" ? "$" : "";
  return `${sign}${(Math.round(n * 100) / 100).toFixed(2)} ${currency}`;
}

/** Wrapper HTML compartido — header navy con logo, footer estándar. */
export function wrapHtml(opts: {
  preheader: string;
  bodyHtml: string;
  signature?: string;
}): string {
  const sig = opts.signature
    ? `<p style="margin:24px 0 4px;font-size:14px;color:${GRAY_700};">${escapeHtml(opts.signature)}</p>
       <p style="margin:0;font-size:13px;color:${GRAY_500};">Integra Legal · Panamá</p>`
    : `<p style="margin:24px 0 4px;font-size:14px;color:${GRAY_700};">El equipo de Integra Legal</p>
       <p style="margin:0;font-size:13px;color:${GRAY_500};">Panamá</p>`;

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
  </head>
  <body style="margin:0;padding:0;background-color:${BG};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:${NAVY};">
    <!-- Preheader oculto (preview en bandeja de entrada) -->
    <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${BG};">
      ${escapeHtml(opts.preheader)}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border-radius:6px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
            <tr>
              <td style="background-color:${NAVY};padding:20px 28px;" align="left">
                <img src="${getEmailLogoUrl()}" width="120" alt="Integra Legal" style="display:block;height:auto;max-width:120px;" />
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                ${opts.bodyHtml}
                ${sig}
              </td>
            </tr>
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
