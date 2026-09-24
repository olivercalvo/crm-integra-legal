/**
 * La UI de la nota de crédito (Bloque 5, commit 4), leída del código:
 *
 *   1. El total en vivo del diálogo sale de `totalDeLineaDeNc`, la MISMA
 *      función con la que el validador calcula lo que va a la base. Si el
 *      diálogo reimplementa el cálculo, algún día la vista previa miente
 *      (lección de `validarConsistenciaDeKind`).
 *   2. El detalle de la factura ofrece "Anular" SOLO sin NC parcial y con el
 *      mes abierto (D4 + 053); el diálogo de NC recibe el disponible por
 *      línea de `acreditadoPorLineaDeFactura`, la MISMA consulta que valida
 *      `createCreditNote`.
 *   3. `cancelInvoice` rechaza una factura con `credited_total > 0` (053).
 *   4. El detalle de la NC lo leen admin, abogada y contador, y el patrón del
 *      contador en `route-access.ts` abre el detalle y no un listado.
 *   5. El PDF lleva la marca de documento interno cuando `fe_estado` es
 *      `no_emitida` (D1), y la ruta se la pasa.
 *   6. El DV del cliente va en su propia línea en el PDF y en la pantalla,
 *      nunca pegado al RUC.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { puedeAccederA } from "@/lib/auth/route-access";
import { totalDeLineaDeNc } from "@/lib/finanzas/validators/credit-note";

const ROOT = process.cwd();
const leer = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const DIALOGO = "src/app/finanzas/facturas/_components/credit-note-dialog.tsx";
const FACTURA = "src/app/finanzas/facturas/[id]/page.tsx";
const NC_PAGE = "src/app/finanzas/notas-credito/[id]/page.tsx";
const PDF_ROUTE = "src/app/api/finanzas/credit-notes/[id]/pdf/route.ts";
const PDF_DOC = "src/lib/finanzas/pdf/CreditNoteDocument.tsx";

test("totalDeLineaDeNc redondea el subtotal y el impuesto por separado, como T8c", () => {
  // 3 × 33.33 = 99.99; 7% = 6.9993 → 7.00; total 106.99
  assert.equal(totalDeLineaDeNc(3, 33.33, 0.07), 106.99);
  assert.equal(totalDeLineaDeNc(1, 100, 0), 100);
  assert.equal(totalDeLineaDeNc(0.5, 200, 0.07), 107);
});

test("🔒 el diálogo calcula el total con totalDeLineaDeNc y no por su cuenta", () => {
  const src = leer(DIALOGO);
  assert.match(src, /import \{[^}]*totalDeLineaDeNc[^}]*\} from "@\/lib\/finanzas\/validators\/credit-note"/);
  assert.match(src, /totalDeLineaDeNc\(x\.qty, x\.linea\.unit_price, x\.linea\.tax_rate\)/);
  assert.doesNotMatch(src, /\*\s*\(1\s*\+\s*[\w.]*tax_rate/, "no aplica la tasa por su cuenta");
  assert.doesNotMatch(src, /unit_price\s*\*\s*\(1/, "no aplica la tasa por su cuenta");
  assert.match(src, /fetch\("\/api\/finanzas\/credit-notes"/);
  assert.match(src, /router\.push\(`\/finanzas\/notas-credito\/\$\{data\.id\}/, "al emitir va al detalle de la NC");
});

test("el detalle de la factura: Anular solo sin NC parcial y con el mes abierto; el disponible sale de la misma consulta que valida", () => {
  const src = leer(FACTURA);
  // 🔒 Desde el Bloque 9B (23/09/2026) el "no se anula con NC parcial ni con el
  //    mes cerrado" YA NO se arma acá con condiciones sueltas: lo decide
  //    `decidirAccionFiscal` (SOP-038), la MISMA función que usa el servidor.
  //    Verificar la expresión literal de `showCancel` sería verificar que la
  //    pantalla tiene su propia copia de la regla, que es justo lo que se sacó.
  assert.match(
    src,
    /import \{ decidirAccionFiscal \} from "@\/lib\/finanzas\/efactura\/orchestration\/decidir-accion-fiscal"/,
    "la pantalla consulta la matriz, no reimplementa las condiciones"
  );
  // Sin saltos de línea, para que el formato del archivo no sea lo que decide
  // si este test pasa.
  const compacto = src.replace(/\s+/g, " ");
  assert.ok(
    compacto.includes(
      'const showCancel = canMutate && (accionFiscal.accion === "anular_en_dgi_y_libro" || accionFiscal.accion === "anular_solo_en_el_libro");'
    ),
    "el botón sale de la acción que devolvió la matriz"
  );
  assert.ok(
    !/const showCancel =[^;]*creditedTotal/.test(compacto),
    "si vuelve a armarse con condiciones sueltas, se desincroniza del servidor"
  );
  assert.match(src, /\{showCancel && \(\s*<CancelInvoiceDialog/);
  assert.match(src, /periodoDeLaFacturaCerrado\(db, tenantId, String\(invoice\.issue_date\)\)/, "el MES de la factura (D4)");
  assert.match(src, /acreditadoPorLineaDeFactura\(db, tenantId, invoice\.id\)/);
  assert.match(src, /const acreditadaTotal = !isAnulada && grandTotal > 0 && creditedTotal >= grandTotal - 0\.005;/, "D3: derivado, no un status");
  assert.match(src, /\{acreditadaTotal && <AcreditadaTotalBadge \/>\}/);
  assert.doesNotMatch(src, /CreditNoteCard/, "la card de una sola NC se reemplazó por la sección");
  const creador = leer("src/lib/finanzas/api/credit-notes.ts");
  const fn = creador.slice(creador.indexOf("export async function createCreditNote("), creador.indexOf("export async function compensarNotaDeCredito"));
  assert.match(fn, /await acreditadoPorLineaDeFactura\(db, tenantId, input\.invoice_id\)/, "el creador valida con la misma consulta");
});

test("cancelInvoice rechaza una factura con NC parcial (053) antes de crear la NC total", () => {
  const src = leer("src/lib/finanzas/api/invoices.ts");
  const fn = src.slice(src.indexOf("export async function cancelInvoice"), src.indexOf("export function MENSAJE_YA_ACREDITADA"));
  const gate = fn.indexOf("MENSAJE_YA_ACREDITADA(creditedTotal)");
  const nc = fn.indexOf("createCreditNoteFromInvoice(");
  assert.ok(gate > 0 && nc > 0 && gate < nc, "el gate va antes de crear la NC total");
  assert.match(fn, /select\("id, status, invoice_number, amount_paid, credited_total, issue_date"\)/);
  const sql = leer("sql/pending/053_anulacion_rechaza_nc_parcial.sql");
  assert.match(sql, /je\.source_type = 'nota_credito' AND je\.source_id = cn\.id/, "el RPC mira el ASIENTO, no credited_total");
});

test("el detalle de la NC: admin, abogada y contador; el contador abre el detalle y no un listado", () => {
  const src = leer(NC_PAGE);
  assert.match(src, /const READING_ROLES = \["admin", "abogada", "contador"\];/);
  assert.match(src, /redirect\("\/finanzas"\)/);
  const id = "11111111-2222-3333-4444-555555555555";
  for (const rol of ["admin", "abogada", "contador"] as const) {
    assert.equal(puedeAccederA(rol, `/finanzas/notas-credito/${id}`), true, `${rol} abre el detalle`);
  }
  assert.equal(puedeAccederA("asistente", `/finanzas/notas-credito/${id}`), false, "el asistente no");
  assert.equal(puedeAccederA("contador", "/finanzas/notas-credito"), false, "el listado no existe y si existiera: no");
  assert.equal(puedeAccederA("contador", `/finanzas/notas-credito/${id}/editar`), false, "solo lectura");
  // 🔴 HASTA EL BLOQUE 9C ESTE TEST EXIGÍA QUE EL DETALLE NO MUTARA NADA.
  //    Era cierto: la NC era inmutable y su reversión no existía. Ahora existe
  //    —y el envío a la DGI también—, así que lo que se protege cambió: ya no
  //    es "no hay botones" sino **quién** los ve. Dejarlo como estaba habría
  //    obligado a borrar el test, que es la peor salida.
  assert.match(
    src,
    /\["admin", "abogada", "contador"\]\.includes\(userRole\)/,
    "reversar: admin, abogada y contador, la misma lista que reversar un cobro"
  );
  assert.match(
    src,
    /const puedeEnviarALaDgi =[\s\S]{0,40}puedeAccionar/,
    "emitir a la DGI cuelga de `puedeAccionar` (admin y abogada), no de la lista de reversar"
  );
  assert.match(
    src,
    /const puedeAccionar = userRole === "admin" \|\| userRole === "abogada";/,
    "y `puedeAccionar` sigue sin incluir al contador"
  );
  // La decisión de qué se puede hacer sale de la MATRIZ, no de un `if` acá.
  assert.match(
    src,
    /decidirAccionSobreNotaDeCredito\(/,
    "el plazo de 182 h lo decide la función pura, no el JSX"
  );
  assert.doesNotMatch(
    src,
    /182|HORAS_PARA_ANULAR/,
    "la pantalla NO vuelve a derivar el plazo: lo recibe en el mensaje de la matriz"
  );
  assert.match(src, /cargarAsientosPorOrigen\(db, tenantId, SOURCE_TYPE_NOTA_CREDITO, \[nc\.id\]\)/, "su asiento propio");
  assert.match(src, /cargarAsientosPorOrigen\(db, tenantId, "reversion", \[nc\.invoice\.id\]\)/, "o la reversión de la anulación (D5)");
  assert.match(src, /DOCUMENTO INTERNO|Documento interno — sin autorización de la DGI/i);
});

test("🔒 D1: el PDF marca DOCUMENTO INTERNO cuando fe_estado es no_emitida, y la ruta se lo pasa", () => {
  const doc = leer(PDF_DOC);
  assert.match(doc, /const noEmitida = fe_estado === "no_emitida";/);
  assert.match(doc, /\{noEmitida && \(\s*<View style=\{styles\.internalBand\} fixed>/);
  assert.match(doc, /DOCUMENTO INTERNO — SIN AUTORIZACIÓN DE LA DGI/);
  assert.match(doc, /fe_estado: string;/);
  assert.match(doc, /es_anulacion: boolean;/);
  const ruta = leer(PDF_ROUTE);
  assert.match(ruta, /fe_estado: cnData\.fe_estado,/);
  assert.match(ruta, /es_anulacion: cnData\.invoice\.status === "anulada",/);
  assert.match(ruta, /const ALLOWED_ROLES = \["admin", "abogada", "contador"\] as const;/);
  const q = leer("src/lib/finanzas/api/credit-notes.ts");
  assert.match(q, /fe_estado, dgi_cufe, dgi_fecha_autorizacion,\s*created_at, created_by,/, "getCreditNoteById trae fe_estado");
});

test("🔒 el DV del cliente va en su propia línea: PDF y pantalla, nunca concatenado al RUC", () => {
  const doc = leer(PDF_DOC);
  assert.match(doc, /<InfoLine label="RUC" value=\{client\.ruc\} \/>/);
  assert.match(doc, /<InfoLine label="DV" value=\{client\.digito_verificador\} \/>/);
  assert.doesNotMatch(doc, /ruc\}?\s*[-–]\s*\$?\{?client\.digito_verificador|`\$\{client\.ruc\}.*\$\{client\.digito_verificador\}/);
  const page = leer(NC_PAGE);
  assert.match(page, /<dt className="text-xs uppercase tracking-wider text-gray-500">DV<\/dt>/);
  assert.doesNotMatch(page, /`\$\{nc\.client\.ruc\}[^`]*\$\{nc\.client\.digito_verificador\}`/);
});
