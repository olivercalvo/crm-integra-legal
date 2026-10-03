/**
 * 🔒 NOTAS DE CRÉDITO COMO MÓDULO PROPIO (E8, migración `076`).
 *
 *   1. Con factura, sus líneas son el valor INICIAL y todo es editable: la
 *      cantidad (hasta lo que queda), el precio (hasta el de la factura, P-4b),
 *      la descripción y el impuesto (del catálogo, nunca del body).
 *   2. Se pueden agregar líneas nuevas: servicio, descripción, precio e
 *      impuesto obligatorios.
 *   3. La NC de VENTA sin factura está apagada detrás de UNA constante (P-4a).
 *   4. La NC de COMPRA sin compra sí se permite: sin tope, saldo a favor.
 *   5. Permisos: venta admin y abogada; compra también el contador.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  MENSAJE_NC_VENTA_SIN_FACTURA,
  PERMITIR_NC_VENTA_SIN_FACTURA,
  validateCreateCreditNoteInput,
  validarLineasDeNotaDeCredito,
  type LineaFacturada,
  type TasaDelCatalogo,
} from "@/lib/finanzas/validators/credit-note";
import {
  calcularNcDeCompra,
  construirAsientoDeNotaDeCompra,
  type LineaDeCompraParaNc,
} from "@/lib/finanzas/contabilidad/asiento-nota-credito-compra";
import { puedeAccederA } from "@/lib/auth/route-access";

const RAIZ = path.resolve(__dirname, "../../../../..");
const INV = "11111111-1111-1111-1111-111111111111";
const L1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SVC = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const T7 = "77777777-7777-7777-7777-777777777777";
const T0 = "00000000-0000-0000-0000-000000000000";

const FACTURADAS: LineaFacturada[] = [
  { id: L1, line_order: 1, service_id: SVC, description: "Honorarios asesoría", quantity: 10, unit_price: 100, tax_code: "ITBMS_7", tax_rate: 0.07, tax_code_id: T7 },
];
const FACTURA = { invoice_number: "FAC-HON-000099", status: "emitida", balance_due: 1070 };
const TASAS = new Map<string, TasaDelCatalogo>([
  [T7, { code: "ITBMS_7", rate: 0.07, active: true }],
  [T0, { code: "EXENTO", rate: 0, active: true }],
]);

test("con factura: el precio baja y la línea pasa a exenta, con la tasa del catálogo", () => {
  const r = validarLineasDeNotaDeCredito({
    factura: FACTURA,
    facturadas: FACTURADAS,
    acreditadoPorLinea: new Map(),
    pedido: [{ invoice_line_id: L1, quantity: 2, unit_price: 80, tax_code_id: T0, description: "Descuento acordado" }],
    tasas: TASAS,
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.total, 160, "2 × 80 exento");
  assert.equal(r.lineas[0].tax_code, "EXENTO");
  assert.equal(r.lineas[0].tax_rate, 0);
  assert.equal(r.lineas[0].description, "Descuento acordado");
  assert.equal(r.lineas[0].invoice_line_id, L1);
});

test("🔴 P-4b (valor por defecto): el precio no sube sobre el de la factura", () => {
  const r = validarLineasDeNotaDeCredito({
    factura: FACTURA,
    facturadas: FACTURADAS,
    acreditadoPorLinea: new Map(),
    pedido: [{ invoice_line_id: L1, quantity: 1, unit_price: 120 }],
    tasas: TASAS,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(String(r.fieldErrors?.["lineas.0.unit_price"]), /no puede ser mayor que el de la factura \(B\/\. 100\.00\)/);
});

test("una tasa que no es del catálogo (o inactiva) se rechaza: la tasa nunca sale del body", () => {
  const r = validarLineasDeNotaDeCredito({
    factura: FACTURA,
    facturadas: FACTURADAS,
    acreditadoPorLinea: new Map(),
    pedido: [{ invoice_line_id: L1, quantity: 1, tax_code_id: "99999999-9999-9999-9999-999999999999" }],
    tasas: TASAS,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.fieldErrors?.["lineas.0.tax_code_id"]);
});

test("se puede agregar una línea nueva; sin servicio no, porque de él sale la cuenta de ingreso", () => {
  const ok = validarLineasDeNotaDeCredito({
    factura: FACTURA,
    facturadas: FACTURADAS,
    acreditadoPorLinea: new Map(),
    pedido: [{ invoice_line_id: null, quantity: 1, service_id: SVC, description: "Ajuste", unit_price: 50, tax_code_id: T7 }],
    tasas: TASAS,
  });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.total, 53.5);
  const forma = validateCreateCreditNoteInput({ invoice_id: INV, reason: "Ajuste", lineas: [{ quantity: 1, description: "x" }] });
  assert.equal(forma.ok, false);
  assert.ok(forma.errors?.["lineas.0.service"]);
  assert.ok(forma.errors?.["lineas.0.unit_price"]);
  assert.ok(forma.errors?.["lineas.0.tax_code_id"]);
});

test("🟢 P-4a: la NC de venta sin factura está encendida (Josuarth, 02/10), con UNA constante", () => {
  assert.equal(PERMITIR_NC_VENTA_SIN_FACTURA, true);
  const r = validateCreateCreditNoteInput({
    invoice_id: null,
    client_id: "22222222-2222-2222-2222-222222222222",
    reason: "Descuento",
    lineas: [{ quantity: 1, service_id: SVC, description: "Descuento", unit_price: 10, tax_code_id: T7 }],
  });
  assert.notEqual(r.errors?.invoice_id, MENSAJE_NC_VENTA_SIN_FACTURA);
  // Una sola constante: nadie más decide si la venta sin factura va o no.
  const usos = ["src/lib/finanzas/api/credit-notes.ts", "src/app/finanzas/notas-credito/_components/nota-de-credito-form.tsx"]
    .map((f) => readFileSync(path.join(RAIZ, f), "utf8"));
  for (const u of usos) {
    assert.match(u, /PERMITIR_NC_VENTA_SIN_FACTURA/);
    assert.doesNotMatch(u, /const PERMITIR_NC_VENTA_SIN_FACTURA/, "no se redeclara");
  }
});

test("🟢 03/10: una NC sin factura va como 06 genérica; con factura, 04 y el gate del CUFE antes del correlativo", () => {
  const src = readFileSync(path.join(RAIZ, "src/lib/finanzas/efactura/orchestration/emit-credit-note-to-efactura.ts"), "utf8");
  assert.doesNotMatch(src, /if \(!nc\.invoice_id\)/, "ya no se corta por no tener factura");
  assert.match(src, /tipoDocumento: tipoDocumentoDeNota\("credito", factura !== null\)/);
  const gate = src.indexOf("if (factura && !factura.dgi_cufe)");
  const correlativo = src.indexOf("allocateFeNumero(db, { tenantId, puntoFacturacion })");
  assert.ok(gate > 0 && gate < correlativo, "sin CUFE (con factura) se corta antes de quemar número");
});

// ── Compra ────────────────────────────────────────────────────────────────────

const lineaCompra = (over: Partial<LineaDeCompraParaNc> = {}): LineaDeCompraParaNc => ({
  id: "l1",
  line_order: 1,
  description: "Papelería",
  chart_account_code: "600001",
  amount: 100,
  tax_rate: 0.07,
  tax_amount: 7,
  tax_code_id: T7,
  tax_account: "200003",
  tax_code: "ITBMS_7",
  acreditado_base: 0,
  acreditado_itbms: 0,
  cuenta_valida: true,
  ...over,
});
const CATALOGOS = {
  tasas: new Map([
    [T7, { code: "ITBMS_7", rate: 0.07, account_code: "200003", active: true }],
    [T0, { code: "EXENTO", rate: 0, account_code: "200003", active: true }],
  ]),
  cuentasValidas: new Set(["600001", "600002"]),
};

test("compra SIN compra asociada: líneas libres, sin tope, el asiento con el proveedor en 200001", () => {
  const calc = calcularNcDeCompra(
    [],
    [{ expense_line_id: null, amount: 500, chart_account_code: "600002", description: "Descuento comercial", tax_code_id: T7, tax_amount: 35 }],
    null,
    CATALOGOS
  );
  assert.ok(calc.ok);
  if (!calc.ok) return;
  assert.equal(calc.total, 535);
  const r = construirAsientoDeNotaDeCompra(
    { id: null, description: "sin compra asociada", supplier_name: "Proveedor S.A.", supplier_id: "p1" },
    "2026-10-01",
    calc
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  const cxp = r.asiento.lines.find((l) => l.account_code === "200001");
  assert.deepEqual([cxp?.debit, cxp?.supplier_id], [535, "p1"]);
  assert.equal(r.asiento.lines.find((l) => l.account_code === "600002")?.credit, 500);
  assert.equal(r.asiento.lines.find((l) => l.account_code === "200003")?.credit, 35);
});

test("compra: el ITBMS escrito se acepta con la tolerancia de la compra (±0,02), no más", () => {
  const bien = calcularNcDeCompra([lineaCompra()], [{ expense_line_id: "l1", amount: 40, tax_amount: 2.81 }], 107, CATALOGOS);
  assert.ok(bien.ok);
  const mal = calcularNcDeCompra([lineaCompra()], [{ expense_line_id: "l1", amount: 40, tax_amount: 3.5 }], 107, CATALOGOS);
  assert.equal(mal.ok, false);
  if (!mal.ok) assert.match(mal.mensaje, /no corresponde a su tasa/);
});

test("compra: cambiar la línea a exenta usa el catálogo; una cuenta fuera del plan válido no entra al libro", () => {
  const exenta = calcularNcDeCompra([lineaCompra()], [{ expense_line_id: "l1", amount: 40, tax_code_id: T0, tax_amount: 0 }], 107, CATALOGOS);
  assert.ok(exenta.ok);
  if (exenta.ok) assert.equal(exenta.total, 40);
  const otraCuenta = calcularNcDeCompra(
    [],
    [{ expense_line_id: null, amount: 10, chart_account_code: "999999", description: "Cuenta inexistente", tax_code_id: null }],
    null,
    CATALOGOS
  );
  assert.ok(otraCuenta.ok);
  if (!otraCuenta.ok) return;
  const r = construirAsientoDeNotaDeCompra({ id: null, description: "x", supplier_name: "P", supplier_id: "p1" }, "2026-10-01", otraCuenta);
  assert.equal(r.ok, false, "la cuenta inválida la rechaza el armado del asiento, como en la compra");
});

test("compra con compra: el tope sigue siendo lo que falta pagar, y el mensaje dice cómo registrarla sin compra", () => {
  const r = calcularNcDeCompra([lineaCompra()], [{ expense_line_id: "l1", amount: 100 }], 50, CATALOGOS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /Regístrala sin asociarla a la compra/);
});

// ── Permisos ──────────────────────────────────────────────────────────────────

test("permisos: venta admin y abogada (el contador sólo el detalle); compra también el contador", () => {
  assert.equal(puedeAccederA("contador", "/finanzas/notas-credito"), false);
  assert.equal(puedeAccederA("contador", "/finanzas/notas-credito/nueva"), false);
  assert.equal(puedeAccederA("contador", "/finanzas/notas-credito/abc-123"), true);
  assert.equal(puedeAccederA("abogada", "/finanzas/notas-credito/nueva"), true);
  assert.equal(puedeAccederA("contador", "/finanzas/notas-credito-proveedor"), true);
  assert.equal(puedeAccederA("contador", "/finanzas/notas-credito-proveedor/nueva"), true);
  assert.equal(puedeAccederA("asistente", "/finanzas/notas-credito-proveedor"), false);
  // La API repite la lista de cada pantalla.
  const venta = readFileSync(path.join(RAIZ, "src/app/api/finanzas/credit-notes/route.ts"), "utf8");
  const compra = readFileSync(path.join(RAIZ, "src/app/api/finanzas/supplier-credit-notes/route.ts"), "utf8");
  assert.match(venta, /const MUTATING_ROLES = \["admin", "abogada"\] as const;/);
  assert.match(compra, /const MUTATING_ROLES = \["admin", "abogada", "contador"\] as const;/);
});

test("🔒 aplicar el saldo de una NC va por el RPC con el cliente de servicio y el tenant del perfil", () => {
  for (const f of [
    "src/app/api/finanzas/credit-notes/[id]/apply/route.ts",
    "src/app/api/finanzas/supplier-credit-notes/[id]/apply/route.ts",
  ]) {
    const src = readFileSync(path.join(RAIZ, f), "utf8");
    assert.match(src, /createAdminClient\(\), ctx\.tenantId, ctx\.userId/);
    assert.doesNotMatch(src, /body\??\.tenant_id/, "el tenant nunca sale del body");
  }
});
