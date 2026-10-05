/**
 * LOS DOCUMENTOS DE PRUEBA NO SALEN EN NINGÚN REPORTE (05/10/2026).
 *
 * La marca (094) vive en el documento. Que una consulta se olvide del filtro no
 * da un error: da una antigüedad, un ITBMS o una lista de Pendientes DGI con
 * una factura de prueba adentro. Este test recorre las fuentes de reportes,
 * avisos y selectores y exige `.eq(DE_PRUEBA, false)` en cada consulta a una
 * tabla que lleva la marca, como `nav-guard` con las rutas.
 *
 * Una consulta que ve las de prueba a propósito (el detalle de un documento, un
 * listado con su badge, la metadata de un asiento) se declara arriba con
 * `// de-prueba-ok: <motivo>`.
 *
 * Y el otro lado (punto 2 del pedido): la marca del CLIENTE no filtra nada. Una
 * factura real de un cliente de prueba (FAC-HON-000463) tiene que seguir
 * contando: ningún reporte filtra por `es_de_prueba`.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(__dirname, "../../../..");
const leer = (ruta: string) => readFileSync(resolve(ROOT, ruta), "utf8").replace(/\r\n/g, "\n");

const TABLAS_MARCADAS = ["invoices", "credit_notes", "payments", "client_payments", "expenses"];

/** Todas las fuentes de reportes, más las consultas de avisos, Pendientes DGI y selectores. */
const FUENTES = [
  ...readdirSync(resolve(ROOT, "src/lib/finanzas/reports"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join("src/lib/finanzas/reports", f)),
  "src/lib/finanzas/queries/pendientes-dgi.ts",
  "src/lib/finanzas/queries/fe-emisiones.ts",
  "src/lib/finanzas/queries/invoices.ts",
  "src/lib/finanzas/queries/payments.ts",
  "src/lib/finanzas/queries/notas-credito.ts",
  "src/lib/finanzas/api/saldo-a-favor.ts",
];

type Consulta = { archivo: string; linea: number; tabla: string; texto: string; declarada: boolean };

function consultas(archivo: string): Consulta[] {
  const src = leer(archivo);
  const out: Consulta[] = [];
  // Literal (`.from("invoices")`) o con una variable (`.from(tabla)`): la
  // variable puede ser una tabla marcada y el test no lo sabe, así que también
  // pide el filtro o la declaración. Así se escapó el contador de Pendientes
  // DGI la primera vez. (`Array.from(` no cuenta.)
  const re = new RegExp(`(?<!Array)\\.from\\(\\s*(?:"(${TABLAS_MARCADAS.join("|")})"|([a-zA-Z_]\\w*))\\s*\\)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const desde = m.index;
    // La sentencia: hasta el `;` o la próxima `.from(` (consultas en paralelo).
    const finPunto = src.indexOf(";", desde);
    const proximo = src.indexOf(".from(", desde + 6);
    const fin = Math.min(finPunto === -1 ? src.length : finPunto, proximo === -1 ? src.length : proximo);
    const linea = src.slice(0, desde).split("\n").length;
    const previas = src.split("\n").slice(Math.max(0, linea - 5), linea).join("\n");
    out.push({
      archivo,
      linea,
      tabla: m[1] ?? `variable ${m[2]}`,
      texto: src.slice(desde, fin),
      declarada: /de-prueba-ok:\s*\S/.test(previas),
    });
  }
  return out;
}

const TODAS = FUENTES.flatMap(consultas);

test("hay consultas que revisar (si da 0, el test dejó de mirar)", () => {
  assert.ok(TODAS.length >= 20, `sólo ${TODAS.length} consultas`);
});

test("🔴 toda consulta de un reporte a una tabla marcada filtra las de prueba, o declara por qué no", () => {
  const sinFiltro = TODAS.filter((c) => !c.declarada && !c.texto.includes(".eq(DE_PRUEBA, false)"));
  assert.deepEqual(
    sinFiltro.map((c) => `${c.archivo}:${c.linea} (${c.tabla})`),
    [],
    "agregar .eq(DE_PRUEBA, false) o un comentario `de-prueba-ok: <motivo>`"
  );
});

test("las que filtran importan la constante (no un texto suelto que el test no vería)", () => {
  for (const archivo of FUENTES) {
    const src = leer(archivo);
    if (src.includes(".eq(DE_PRUEBA, false)")) {
      assert.match(src, /import \{[^}]*\bDE_PRUEBA\b[^}]*\} from "@\/lib\/finanzas\/documentos-de-prueba"/, archivo);
    }
    assert.doesNotMatch(src, /\.eq\("de_prueba"/, `${archivo}: usar DE_PRUEBA`);
  }
});

test("los reportes del pedido filtran: antigüedad, estado de cuenta, ITBMS, Pendientes DGI, avisos", () => {
  const filtradas = (archivo: string, tabla: string) =>
    TODAS.filter((c) => c.archivo.replace(/\\/g, "/") === archivo && c.tabla === tabla && c.texto.includes(".eq(DE_PRUEBA, false)")).length;
  assert.ok(filtradas("src/lib/finanzas/reports/antiguedad-source.ts", "invoices") >= 2, "antigüedad: facturas y cuadre");
  assert.ok(filtradas("src/lib/finanzas/reports/antiguedad-source.ts", "payments") >= 1, "antigüedad: saldos a favor");
  assert.ok(filtradas("src/lib/finanzas/reports/antiguedad-source.ts", "credit_notes") >= 1, "antigüedad: NC sin factura");
  assert.ok(filtradas("src/lib/finanzas/reports/estado-cuenta-source.ts", "invoices") >= 2, "estado de cuenta");
  assert.ok(filtradas("src/lib/finanzas/reports/vat-summary.ts", "invoices") >= 2, "ITBMS: débito");
  assert.ok(filtradas("src/lib/finanzas/reports/vat-summary.ts", "credit_notes") >= 2, "ITBMS: NC");
  assert.ok(filtradas("src/lib/finanzas/queries/pendientes-dgi.ts", "invoices") >= 1, "Pendientes DGI");
  assert.ok(filtradas("src/lib/finanzas/queries/pendientes-dgi.ts", "credit_notes") >= 1, "Pendientes DGI: NC");
  assert.ok(filtradas("src/lib/finanzas/queries/fe-emisiones.ts", "invoices") >= 1, "aviso de facturas con error");
});

test("🔴 caso FAC-HON-000463: ningún reporte filtra por la marca del CLIENTE", () => {
  for (const archivo of FUENTES) {
    assert.doesNotMatch(leer(archivo), /es_de_prueba/, `${archivo} filtra por el cliente: la 463 dejaría de contar`);
  }
});

test("las exportaciones usan los mismos loaders que la pantalla (heredan el filtro)", () => {
  const aging = leer("src/app/api/finanzas/reportes/aging/export/route.ts");
  assert.match(aging, /loadAntiguedad/);
  assert.doesNotMatch(aging, /\.from\("invoices"\)/);
  const vat = leer("src/lib/finanzas/reports/vat-summary-xlsx.ts");
  assert.doesNotMatch(vat, /\.from\("(invoices|credit_notes)"\)/);
});

test("antes del número: emitir, cobrar, NC y gasto de trámite cortan lo de prueba", () => {
  const emitir = leer("src/lib/finanzas/api/invoices.ts");
  const cuerpo = emitir.slice(emitir.indexOf("export async function emitInvoice"));
  assert.ok(cuerpo.indexOf("de_prueba === true") > -1 && cuerpo.indexOf("de_prueba === true") < cuerpo.indexOf("get_next_sequence_number"));
  const cobro = leer("src/lib/finanzas/api/payments.ts");
  assert.ok(cobro.indexOf("clienteDePrueba(db, tenantId, clientId)") > -1);
  assert.ok(cobro.indexOf("clienteDePrueba(db, tenantId, clientId)") < cobro.indexOf("allocateReceiptNumber(db, tenantId)"));
  const nc = leer("src/lib/finanzas/api/credit-notes.ts");
  assert.ok(nc.indexOf("clienteDePrueba(db, tenantId, clientId)") > -1);
  assert.ok(nc.indexOf("clienteDePrueba(db, tenantId, clientId)") < nc.indexOf('rpc("get_next_sequence_number"'));
  const gasto = leer("src/lib/finanzas/api/expense-tramite.ts");
  assert.ok(gasto.indexOf("de_prueba === true") > -1 && gasto.indexOf("de_prueba === true") < gasto.indexOf("allocatePurchaseNumber(db, tenantId)"));
});

test("🔴 un documento de prueba nunca va a la DGI: es lo PRIMERO que mira el envío", () => {
  const src = leer("src/lib/finanzas/efactura/orchestration/enviar-a-la-dgi.ts");
  const cuerpo = src.slice(src.indexOf("async function antesDeEnviar"));
  const i = cuerpo.indexOf("meta.dePrueba");
  assert.ok(i > 0, "antesDeEnviar no mira la marca");
  assert.ok(i < cuerpo.indexOf("ENVIABLE.has"), "antes que el estado fiscal");
  assert.match(src, /dgi_cufe_origen, de_prueba"/);
});

test("anular, cobrar y acreditar una factura de prueba: 409 en el servidor, y la pantalla no lo ofrece", () => {
  const anular = leer("src/lib/finanzas/efactura/orchestration/anular-factura-ante-dgi.ts");
  // La marca se mira al cargar el estado, que es lo primero, antes de la matriz y del PAC.
  const c = anular.slice(anular.indexOf("export async function anularFacturaAnteDgi"));
  assert.ok(c.indexOf("cargarEstadoDeFactura(") < c.indexOf("decidirAccionFiscal("));
  const carga = anular.slice(anular.indexOf("async function cargarEstadoDeFactura"));
  assert.ok(carga.indexOf("de_prueba === true") > -1 && carga.indexOf("de_prueba === true") < carga.indexOf("return "));
  const cancel = leer("src/lib/finanzas/api/invoices.ts");
  assert.match(cancel.slice(cancel.indexOf("export async function cancelInvoice")), /de_prueba === true/);
  assert.match(leer("src/lib/finanzas/api/payments.ts"), /facturaDePrueba/);
  const nc = leer("src/lib/finanzas/api/credit-notes.ts");
  assert.match(nc, /invoice_number, status, balance_due, issue_date, accounting_date, dgi_cufe, de_prueba"/);
  const det = leer("src/app/finanzas/facturas/[id]/page.tsx");
  assert.match(det, /const canMutate = puedeAccionar && !esDePrueba;/);
  assert.match(det, /canEmitToPac=\{canEmitToPac && !emitidaFuera && !esDePrueba\}/);
  assert.match(det, /<DePruebaBanda/);
});

