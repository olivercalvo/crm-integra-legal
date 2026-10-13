/**
 * 🔒 LOS CAMBIOS CHICOS ANTES DE LA VENTANA (07/10/2026, cobertura de
 * requerimientos): 19 «Compras», 5 «Ver asiento», 13 «Facturar este caso»,
 * 48 instalable, 46 pestaña nueva, 3 instrucciones del plan, 11 «Factura» y
 * la referencia externa de los asientos importados en la antigüedad.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

import { INVOICE_KIND_LABEL, TITULO_DEL_FORMULARIO } from "@/lib/finanzas/types/invoice";
import { partidasDeDiario } from "@/lib/finanzas/reports/partidas-de-diario";
import { generateChartAccountsTemplate } from "@/lib/finanzas/import/chart-of-accounts-workbook";
import manifest from "@/app/manifest";

const leer = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("19: el menú y la pantalla dicen «Compras»", () => {
  assert.match(leer("src/lib/nav-config.ts"), /label: "Compras", href: "\/finanzas\/gastos-bufete"/);
  assert.match(leer("src/app/finanzas/gastos-bufete/page.tsx"), />Compras<\/h1>/);
  assert.doesNotMatch(leer("src/lib/nav-config.ts"), /Gastos del Bufete/);
});

test("11: ninguna factura se llama «Honorarios» y el título sigue al tipo", () => {
  for (const v of Object.values(INVOICE_KIND_LABEL)) assert.doesNotMatch(v, /honorario/i);
  assert.equal(INVOICE_KIND_LABEL.HONORARIOS, "Factura");
  assert.equal(TITULO_DEL_FORMULARIO.create.REEMBOLSO, "Nueva factura de reembolso");
  assert.equal(TITULO_DEL_FORMULARIO.edit.NOTA_DEBITO, "Editar nota de débito");
  assert.match(leer("src/app/finanzas/facturas/_components/invoice-form.tsx"), /TITULO_DEL_FORMULARIO\[props\.mode\]\[kind\]/);
});

test("5: «Ver asiento» en factura, compra y gasto de trámite, con enlace sólo para admin y contador", () => {
  for (const p of ["src/app/finanzas/facturas/[id]/page.tsx", "src/app/finanzas/gastos-bufete/[id]/page.tsx", "src/app/finanzas/gastos-tramite/[id]/page.tsx"]) {
    const s = leer(p);
    assert.match(s, /<VerAsiento asiento=\{asiento\} puedeAbrir=\{[^}]*"admin"[^}]*"contador"\s*\}/, p);
  }
});

test("13: «Facturar este caso» precarga el caso y su cliente", () => {
  const caso = leer("src/app/legal/casos/[id]/page.tsx");
  assert.match(caso, /href=\{`\/finanzas\/facturas\/nueva\?case_id=\$\{params\.id\}`\}/);
  const nueva = leer("src/app/finanzas/facturas/nueva/page.tsx");
  assert.match(nueva, /inicial=\{inicial\}/);
  assert.doesNotMatch(nueva, /&& null\}/, "el pre-fill ya no es un no-op");
});

test("48: instalable (manifest standalone con íconos 192 y 512 que existen)", () => {
  const m = manifest();
  assert.equal(m.display, "standalone");
  const tam = (m.icons ?? []).map((i) => i.sizes);
  assert.deepEqual(tam, ["192x192", "512x512"]);
  for (const i of m.icons ?? []) assert.ok(existsSync(path.join(process.cwd(), "public", i.src)), i.src);
  assert.match(leer("src/middleware.ts"), /pathname === "\/manifest\.webmanifest"/);
});

test("46: cada opción del menú se abre en una pestaña nueva", () => {
  const s = leer("src/components/layout/contextual-sidebar.tsx");
  assert.match(s, /target="_blank"/);
  assert.match(s, /en una pestaña nueva/);
});

test("3: las instrucciones del plan dicen que la subcategoría es obligatoria", () => {
  const wb = XLSX.read(Buffer.from(generateChartAccountsTemplate()), { type: "buffer" });
  const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Instrucciones"], { header: 1 });
  const sub = filas.find((f) => f[0] === "Subcategoría");
  assert.ok(sub);
  assert.equal(sub![1], "Sí");
});

test("antigüedad: la partida de un asiento importado se nombra por su referencia externa", () => {
  const base = { entryId: "e1", entryNumber: 5, sourceType: "manual", fecha: "2026-03-10", referencia: "AD-000005",
    debit: 107, credit: 0, clientId: "c1", supplierId: null, terceroNombre: "Cliente" };
  const [conRef] = partidasDeDiario([{ ...base, referenciaExterna: "QB-1001" }], "cobrar", new Set());
  assert.equal(conRef.numero, "QB-1001 (AD-000005)");
  const [sinRef] = partidasDeDiario([base], "cobrar", new Set());
  assert.equal(sinRef.numero, "AD-000005");
});
