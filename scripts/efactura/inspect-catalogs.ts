/**
 * Script utilitario dev — analisis post-Fase-3 primera pieza.
 *
 * Sondea:
 *   (a) Que CPBS (segmentos + familias) corresponden a servicios
 *       profesionales/legales/asesoria juridica, para alimentar
 *       EmisorConfig.cpbsServiciosLegalesHon / cpbsServiciosLegalesRei.
 *   (b) Si el PAC expone un catalogo de formaPago / metodoPago /
 *       tipoDocumento / tipoOperacion / tipoReceptor / tipoITBMS.
 *
 * Read-only. No requiere certificado de firma.
 *
 * Uso:
 *   $env:NODE_OPTIONS = "--use-system-ca"; npx tsx scripts/efactura/inspect-catalogs.ts
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../../.env.local") });

import { get } from "../../src/lib/finanzas/efactura/transport/efactura-client";

interface CpbsSeg {
  id: string;
  codigo: string;
  nombre: string;
}
interface CpbsFam {
  id: string;
  codigoFam: string;
  codigoSeg: string;
  nombreSeg: string;
  nombreFam: string;
}

const LEGAL_KEYWORDS = [
  "legal",
  "juridic",
  "juridi",
  "abog",
  "asesor",
  "profesional",
  "consultor",
  "notari",
];

function matchesAny(s: string, keywords: string[]): boolean {
  const lc = s.toLowerCase();
  return keywords.some((k) => lc.includes(k));
}

// Candidatos a probar para descubrir mas catalogos.
const CANDIDATE_PATHS = [
  "/api/v1/Catalogs/formaPago",
  "/api/v1/Catalogs/formasPago",
  "/api/v1/Catalogs/paymentTerms",
  "/api/v1/Catalogs/metodoPago",
  "/api/v1/Catalogs/metodosPago",
  "/api/v1/Catalogs/paymentMethods",
  "/api/v1/Catalogs/tipoDocumento",
  "/api/v1/Catalogs/tipoOperacion",
  "/api/v1/Catalogs/tipoReceptor",
  "/api/v1/Catalogs/tipoITBMS",
  "/api/v1/Catalogs/tipoEmisor",
  "/api/v1/Catalogs/destinoOperacion",
  "/api/v1/Catalogs/units",
  "/api/v1/Catalogs/unitsMeasure",
] as const;

async function main(): Promise<void> {
  // --- (a) CPBS de servicios legales ---
  console.log("=== (a) CPBS — segmentos relevantes ===");
  const segs = (await get("/api/v1/Catalogs/CPBSsegs")) as CpbsSeg[];
  const segMatches = segs.filter((s) => matchesAny(s.nombre, LEGAL_KEYWORDS));
  console.log(`Segmentos con keyword (${LEGAL_KEYWORDS.join(", ")}): ${segMatches.length}`);
  console.log(JSON.stringify(segMatches, null, 2));

  console.log("\n=== Lista completa de segmentos (resumen codigo+nombre) ===");
  console.log(
    segs
      .map((s) => `  ${s.codigo}  ${s.nombre}`)
      .sort()
      .join("\n"),
  );

  console.log("\n=== (a) CPBS — familias relevantes ===");
  const fams = (await get("/api/v1/Catalogs/CPBSfams")) as CpbsFam[];
  const famMatches = fams.filter(
    (f) => matchesAny(f.nombreFam, LEGAL_KEYWORDS) || matchesAny(f.nombreSeg, LEGAL_KEYWORDS),
  );
  console.log(`Familias con keyword: ${famMatches.length}`);
  console.log(JSON.stringify(famMatches, null, 2));

  // --- (b) Sondear paths candidatos ---
  console.log("\n\n=== (b) Sondeo de catalogos adicionales ===");
  const found: Array<{ path: string; status: "OK" | "404" | "ERR"; preview?: string }> = [];
  for (const path of CANDIDATE_PATHS) {
    try {
      const data = await get(path);
      const note = Array.isArray(data)
        ? `${data.length} filas — ej: ${JSON.stringify(data[0] ?? null).slice(0, 200)}`
        : JSON.stringify(data).slice(0, 200);
      found.push({ path, status: "OK", preview: note });
      console.log(`  OK   ${path}  — ${note}`);
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes("404") ? "404" : "ERR";
      found.push({ path, status, preview: msg.slice(0, 200) });
      console.log(`  ${status.padEnd(4)} ${path}  — ${msg.slice(0, 120)}`);
    }
  }

  console.log("\n=== Resumen sondeo ===");
  console.log(`OK : ${found.filter((f) => f.status === "OK").length}`);
  console.log(`404: ${found.filter((f) => f.status === "404").length}`);
  console.log(`ERR: ${found.filter((f) => f.status === "ERR").length}`);

  // --- (c) Locations muestra ---
  console.log("\n=== (c) Locations — muestra 3 filas no-Bocas para variedad ===");
  const locs = (await get("/api/v1/Catalogs/locations")) as Array<Record<string, unknown>>;
  // Filtrar para mostrar variedad de provincias (Panama, Chiriqui, etc).
  const interesting = locs.filter(
    (l) =>
      typeof l.provincia === "string" &&
      ["PANAMA", "CHIRIQUI", "COLON"].some((p) => (l.provincia as string).includes(p)),
  );
  console.log(JSON.stringify(interesting.slice(0, 5), null, 2));
  console.log(`Total locations: ${locs.length}`);
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
