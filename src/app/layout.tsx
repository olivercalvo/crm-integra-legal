import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { EnvBanner } from "@/components/env-banner";
import { currentAppEnv } from "@/lib/env/app-env";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "CRM Integra Legal",
  description: "Sistema de gestión para bufetes de abogados",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // `data-env-band` prende `--env-band-h` en globals.css, que es lo que usan el
  // header y el sidebar para correrse hacia abajo. Se resuelve en el servidor
  // para que la banda no aparezca de golpe después del primer paint.
  const showBand = currentAppEnv() !== "production";

  return (
    <html lang="es" data-env-band={showBand ? "true" : undefined}>
      <body className={`${inter.variable} font-sans antialiased`}>
        <EnvBanner />
        {children}
      </body>
    </html>
  );
}
