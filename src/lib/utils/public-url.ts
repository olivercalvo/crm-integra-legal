/**
 * Fuente única de verdad para la URL base pública de la app (Sprint 2E.4 hot-fix).
 *
 * Resuelve la URL absoluta del deploy actual en runtime, con cascada:
 *
 *   1. `NEXT_PUBLIC_APP_URL` (si está definida) — útil para producción con
 *      dominio propio o para sobrescribir manualmente en cualquier entorno.
 *   2. `https://${VERCEL_URL}` — Vercel inyecta `VERCEL_URL` automáticamente
 *      en CADA deploy (preview o prod) sin que tengamos que configurarla.
 *      Es lo que nos permite que un email mandado desde preview lleve al
 *      portal del MISMO preview en vez de saltar a prod.
 *   3. Fallback hardcoded a la URL de prod — solo aplica en local sin
 *      `NEXT_PUBLIC_APP_URL` configurada. Mejor que romper.
 *
 * Importante: este helper debe llamarse en runtime (dentro de funciones que
 * corren por request), NO evaluarse a nivel módulo. Si se asignara a una
 * constante top-level, quedaría congelada al primer import.
 */

const FALLBACK_PROD_URL = "https://crm-integra-legal.vercel.app";

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function getPublicAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit && explicit.trim().length > 0) {
    return stripTrailingSlash(explicit.trim());
  }
  const vercel = process.env.VERCEL_URL;
  if (vercel && vercel.trim().length > 0) {
    return `https://${stripTrailingSlash(vercel.trim())}`;
  }
  return FALLBACK_PROD_URL;
}

/** URL absoluta del logo de email — depende del deploy actual. */
export function getEmailLogoUrl(): string {
  return `${getPublicAppUrl()}/email/integra-logo-email.png`;
}
