import type { Metadata } from "next";

/**
 * Layout dedicado del portal público de cotizaciones. Sprint 2E.3 hotfix
 * (2026-05-14).
 *
 * Difiere del layout del CRM:
 *   - NO incluye DashboardShell, sidebar ni header del CRM (es la
 *     experiencia que ve el CLIENTE — no debe ver chrome interno).
 *   - NO requiere autenticación (acceso por token único en URL).
 *   - Bloquea indexación con noindex/nofollow (cada link es único por
 *     cliente y la página queda online indefinidamente; no queremos que
 *     Google la cachee ni que el contenido aparezca en búsquedas).
 */
export const metadata: Metadata = {
  title: "Cotización — Integra Legal",
  description: "Portal de cotizaciones de Integra Legal · Panamá",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function CotizacionPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-gray-100">{children}</div>;
}
