/**
 * Sprint QUOTES-POLISH — fixture sintético D8.
 *
 * Genera dos PDFs de cotización con 7 líneas típicas + observaciones:
 *   1. quote-fixture-core.pdf — SIN T&C. Debe caber en 1 página.
 *      Esto valida que la compactación D4 funciona para el caso común.
 *   2. quote-fixture-full.pdf — CON T&C estándar panameño (7 cláusulas).
 *      Esperable 2 páginas. La spec dice "paginación natural si excede".
 *
 * Pensado como smoke-test local para que Oliver inspeccione visualmente
 * antes del merge. NO se ejecuta en CI.
 *
 * Uso:
 *   npx tsx scripts/verify-quote-pdf-fixture.mjs
 *
 * Sale con código 0 si el caso "core" cabe en 1 página. Imprime los paths
 * de los PDFs generados.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Importamos vía pathToFileURL para que Node ESM funcione con paths absolutos.
const { renderToBuffer } = await import("@react-pdf/renderer");
const { QuoteDocument } = await import(
  pathToFileURL(path.join(repoRoot, "src/lib/finanzas/pdf/QuoteDocument.tsx")).href
);

const fixture = {
  quote_number: "COT-001269",
  title: "Naturalización Adrian Fu — 1ra cotización (fixture D8)",
  status: "enviada",
  status_label: "Enviada",
  issue_date: "2026-05-16",
  valid_until: "2026-06-15",
  client: {
    name: "Adrian Fu Wong",
    client_number: "CLI-042",
    tax_id: "8-1234-5678",
    tax_id_type: "cedula",
    email: "adrian.fu@example.com",
    phone: "+507 6123-4567",
    address: "Calle 50, Edificio Plaza Norte, piso 12, Ciudad de Panamá",
  },
  case: { code: "CIV-099", description: "Naturalización por matrimonio" },
  lines: [
    { line_order: 1, description: "Honorarios civiles", invoice_kind: "HON", qty: 1, unit_price: 850, tax_code: "ITBMS_7", tax_rate: 0.07, line_total: 909.5 },
    { line_order: 2, description: "Honorarios corporativos — sesión 1", invoice_kind: "HON", qty: 1, unit_price: 1200, tax_code: "ITBMS_7", tax_rate: 0.07, line_total: 1284 },
    { line_order: 3, description: "Honorarios corporativos — sesión 2", invoice_kind: "HON", qty: 1, unit_price: 1200, tax_code: "ITBMS_7", tax_rate: 0.07, line_total: 1284 },
    { line_order: 4, description: "Reembolso de gastos notariales", invoice_kind: "REI", qty: 1, unit_price: 175, tax_code: "EXENTO", tax_rate: 0, line_total: 175 },
    { line_order: 5, description: "Reembolso de timbres fiscales", invoice_kind: "REI", qty: 1, unit_price: 95, tax_code: "EXENTO", tax_rate: 0, line_total: 95 },
    { line_order: 6, description: "Reembolso de gastos Registro Público", invoice_kind: "REI", qty: 1, unit_price: 120, tax_code: "EXENTO", tax_rate: 0, line_total: 120 },
    { line_order: 7, description: "Reembolso de gastos administrativos", invoice_kind: "REI", qty: 1, unit_price: 60, tax_code: "EXENTO", tax_rate: 0, line_total: 60 },
  ],
  subtotal_hon: 3250,
  subtotal_rei: 450,
  tax_total: 227.5,
  grand_total: 3927.5,
  notes: null,
  observations: "Los honorarios se pagan 50% al firmar el contrato y 50% al entregar el resultado final.",
  terms_and_conditions: `TÉRMINOS Y CONDICIONES

1. ALCANCE DEL SERVICIO
   Los servicios profesionales descritos en esta cotización serán prestados por Integra Legal en estricto cumplimiento de las normas éticas y profesionales aplicables al ejercicio de la abogacía en la República de Panamá.

2. HONORARIOS
   Los honorarios profesionales detallados en esta cotización están expresados en dólares de los Estados Unidos de América (USD), incluyen el Impuesto sobre la Transferencia de Bienes Corporales Muebles y la Prestación de Servicios (ITBMS) cuando aplica, y NO incluyen reembolsos de gastos administrativos, judiciales, registrales, notariales ni tributarios, los cuales serán facturados por separado.

3. FORMA DE PAGO
   Salvo acuerdo escrito en contrario, los honorarios se facturarán al inicio de la prestación del servicio.

4. VALIDEZ DE LA OFERTA
   Esta cotización es válida hasta la fecha indicada en el campo "Válida hasta".

5. CONFIDENCIALIDAD
   Toda información intercambiada está protegida por el secreto profesional.

6. ACEPTACIÓN
   La aceptación expresa constituye un acuerdo vinculante.

7. JURISDICCIÓN
   Cualquier controversia será sometida a la jurisdicción de los tribunales de la República de Panamá.`,
  generated_at_label: "16/05/2026 11:55",
  generated_by_label: "Milena Batista (fixture)",
};

function countPdfPages(buffer) {
  const txt = buffer.toString("latin1");
  // /Type /Page  (excluye /Pages que es la colección parent).
  const matches = txt.match(/\/Type\s*\/Page(?![sA-Za-z])/g) ?? [];
  return matches.length;
}

const outDir = path.join(repoRoot, "scripts", "fixture-output");
await fs.mkdir(outDir, { recursive: true });

// ---- Test 1: SIN T&C — debe caber en 1 página -----------------------------
const coreFixture = { ...fixture, terms_and_conditions: null };
const coreBuffer = await renderToBuffer(React.createElement(QuoteDocument, coreFixture));
const corePath = path.join(outDir, "quote-fixture-core.pdf");
await fs.writeFile(corePath, coreBuffer);
const corePages = countPdfPages(coreBuffer);

console.log(`[1] Core (sin T&C) → ${corePath}`);
console.log(`    Bytes: ${coreBuffer.length.toLocaleString()} · Pages: ${corePages}`);

// ---- Test 2: CON T&C — paginación natural ---------------------------------
const fullBuffer = await renderToBuffer(React.createElement(QuoteDocument, fixture));
const fullPath = path.join(outDir, "quote-fixture-full.pdf");
await fs.writeFile(fullPath, fullBuffer);
const fullPages = countPdfPages(fullBuffer);

console.log(`[2] Full (con T&C panameño) → ${fullPath}`);
console.log(`    Bytes: ${fullBuffer.length.toLocaleString()} · Pages: ${fullPages}`);

console.log("");
if (corePages === 1) {
  console.log("✓ PASS — el contenido core (header, líneas, totales, observaciones)");
  console.log("         cabe en 1 página tras las compactaciones D4.");
  if (fullPages > 1) {
    console.log(
      `  Nota: la versión completa con T&C estándar usa ${fullPages} páginas —`
    );
    console.log("        paginación natural permitida por spec D4.");
  }
  process.exit(0);
} else {
  console.log(`✗ FAIL — el contenido core se extiende a ${corePages} páginas (objetivo: 1).`);
  console.log("         Revisar compactaciones D4 antes de seguir.");
  process.exit(1);
}
