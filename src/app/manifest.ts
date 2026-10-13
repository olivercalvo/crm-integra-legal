import type { MetadataRoute } from "next";

/**
 * El CRM instalable desde el navegador (requerimiento 48, 07/10/2026): Chrome y
 * Edge ofrecen «Instalar» y queda un acceso directo en el escritorio que abre
 * el CRM en su propia ventana. Next lo sirve en /manifest.webmanifest, que el
 * middleware deja pasar sin sesión (es público: no tiene datos).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CRM Integra Legal",
    short_name: "Integra Legal",
    description: "Gestión legal y finanzas de Integra Legal",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#1B2A4A",
    lang: "es",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
