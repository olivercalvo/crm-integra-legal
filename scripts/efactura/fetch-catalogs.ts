/**
 * Script utilitario dev — baja catalogos del PAC eFactura PTY (ideati) en pruebas.
 *
 * Objetivo Fase 3 primera pieza:
 *   (1) validar que EFACTURA_API_BASE_URL + EFACTURA_API_KEY funcionan (auth 200)
 *   (2) ver que catalogos existen, especialmente CPBS (servicios legales) y formaPago
 *   (3) inspeccionar formato de locations para EmisorConfig
 *
 * Uso:
 *   npx tsx scripts/efactura/fetch-catalogs.ts
 *
 * Read-only. No requiere certificado de firma.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

// Cargar .env.local ANTES de cualquier llamada al cliente.
// (El cliente lee process.env de forma lazy, asi que el orden de imports
//  no es problematico, pero por claridad lo dejamos al inicio.)
dotenv.config({ path: resolve(__dirname, "../../.env.local") });

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { get } from "../../src/lib/finanzas/efactura/transport/efactura-client";

const ENDPOINTS = [
  "/api/v1/Catalogs/CPBSfams",
  "/api/v1/Catalogs/CPBSsegs",
  "/api/v1/Catalogs/locations",
  "/api/v1/Catalogs/countries",
  "/api/v1/Catalogs/currencies",
] as const;

function preview(data: unknown, max = 5): string {
  if (Array.isArray(data)) {
    const head = data.slice(0, max);
    const tailNote = data.length > max ? `\n... [+${data.length - max} filas]` : "";
    return `Total: ${data.length} filas\nPrimeras ${head.length}:\n${JSON.stringify(head, null, 2)}${tailNote}`;
  }
  const txt = JSON.stringify(data, null, 2);
  return txt.length > 4000 ? txt.slice(0, 4000) + "\n... [truncado]" : txt;
}

async function main(): Promise<void> {
  // Sanity: confirmar que las 3 envs estan presentes (sin imprimir el key).
  const haveBase = Boolean(process.env.EFACTURA_API_BASE_URL);
  const haveKey = Boolean(process.env.EFACTURA_API_KEY);
  const ambiente = process.env.EFACTURA_I_AMB ?? "(no set)";
  console.log("=== Configuracion ===");
  console.log(`EFACTURA_API_BASE_URL : ${haveBase ? process.env.EFACTURA_API_BASE_URL : "MISSING"}`);
  console.log(`EFACTURA_API_KEY      : ${haveKey ? "PRESENT (oculto)" : "MISSING"}`);
  console.log(`EFACTURA_I_AMB        : ${ambiente}`);
  if (!haveBase || !haveKey) {
    console.error("\nFaltan variables de entorno. Abortando.");
    process.exit(1);
  }

  for (const path of ENDPOINTS) {
    console.log(`\n=== GET ${path} ===`);
    try {
      const data = await get(path);
      console.log(preview(data));
    } catch (err) {
      const e = err as Error & { cause?: { message?: string; code?: string } };
      console.error(`FALLO: ${e.message}`);
      if (e.cause) {
        console.error(`  cause: ${e.cause.message ?? "(sin mensaje)"} [${e.cause.code ?? "?"}]`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
