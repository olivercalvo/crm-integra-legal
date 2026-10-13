/**
 * 🔒 BLOQUE 1, E3 (01/10/2026): número de documento, referencia externa,
 * módulo, tercero obligatorio en las cuentas control y el caso cerrado.
 *
 * Lo que protege:
 *   1. Cada documento lleva su número PROPIO en `reference` y el papel de
 *      AFUERA (factura del proveedor, cheque) en `referencia_externa`. Nunca al
 *      revés: el filtro del Mayor y los anexos leen columnas distintas.
 *   2. El módulo se DERIVA del `source_type` (P-2b: el gasto de trámite es
 *      FAC-CO) y una reversión lleva el de su original.
 *   3. El formulario del asiento de diario dice "elige el cliente de la línea
 *      N" ANTES de que el motor (071) lo rechace, con el número de la pantalla.
 *   4. El caso cerrado pregunta antes de guardar, en pantalla y no con un
 *      `window.confirm`.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { construirAsientoDeCompra, type CompraParaAsiento } from "@/lib/finanzas/contabilidad/asiento-compra";
import { construirAsientoDeGastoTramite } from "@/lib/finanzas/contabilidad/asiento-gasto-tramite";
import {
  construirAsientoDeCobro,
  construirAsientoDePagoProveedor,
} from "@/lib/finanzas/contabilidad/asiento-tesoreria";
import {
  MODULOS,
  etiquetaDeModulo,
  moduloDelAsiento,
} from "@/lib/finanzas/contabilidad/modulo-del-asiento";
import {
  armarAsientoManual,
  estadoDelRegistro,
  lineaManualVacia,
  tercerosFaltantes,
  valorDeTercero,
  type CuentaControl,
  type LineaManualDraft,
} from "@/lib/finanzas/contabilidad/asiento-manual";
import { SOURCE_TYPES } from "@/lib/finanzas/contabilidad/posting";
import { esEstadoCerrado } from "@/lib/utils/status-styles";
import type { ExpenseLineRow } from "@/lib/finanzas/types/expense-line";

const RAIZ = path.resolve(__dirname, "../../../../..");
// Los archivos del repo pueden venir con CRLF: se normaliza para que los
// patrones de varias líneas no dependan del checkout.
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

// ---------------------------------------------------------------------------
// 1. reference y referencia_externa
// ---------------------------------------------------------------------------

const COMPRA: CompraParaAsiento = {
  id: "c1",
  expense_date: "2026-09-04",
  accounting_date: "2026-09-04",
  description: "Insumos",
  total: 107,
  supplier_name: "PROV",
  supplier_id: "p1",
  purchase_number: "FAC-CO-000004",
  supplier_invoice_number: "  F-123  ",
  lineas: [
    {
      line_order: 1,
      description: "Útiles",
      amount: 100,
      tax_amount: 7,
      chart_account_code: "610008",
      cuenta_valida: true,
    },
  ],
};

test("compra: FAC-CO- en reference y la factura del proveedor en referencia_externa (sin espacios)", () => {
  const r = construirAsientoDeCompra(COMPRA);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.asiento.reference, "FAC-CO-000004");
  assert.equal(r.asiento.referencia_externa, "F-123");
});

test("compra vieja, sin número ni factura: las dos van NULL, nunca cadena vacía", () => {
  const r = construirAsientoDeCompra({ ...COMPRA, purchase_number: null, supplier_invoice_number: "   " });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.asiento.reference, null);
  assert.equal(r.asiento.referencia_externa, null);
});

function lineaTramite(): ExpenseLineRow {
  return {
    id: "l1",
    line_order: 1,
    description: "Timbres",
    chart_account_code: "130003",
    chart_account_name: "Fondo Legales de Clientes",
    amount: 50,
    tax_code_id: null,
    tax_rate: 0,
    tax_amount: 0,
    line_total: 50,
  };
}

test("gasto de trámite: misma serie FAC-CO- (P-2b) y la factura del proveedor como referencia externa", () => {
  const r = construirAsientoDeGastoTramite(
    {
      id: "e1",
      date: "2026-09-04",
      accounting_date: "2026-09-04",
      concept: "Trámite",
      case_code: "CORP-001",
      supplier_legal_name: "CABLE ONDA",
      supplier_id: "p1",
      purchase_number: "FAC-CO-000005",
      supplier_invoice_number: "F-E3-1",
    },
    [lineaTramite()]
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.asiento.reference, "FAC-CO-000005");
  assert.equal(r.asiento.referencia_externa, "F-E3-1");
});

test("cobro: CO- en reference y el cheque o la transferencia en referencia_externa", () => {
  const r = construirAsientoDeCobro({
    id: "pay1",
    payment_number: "CO-000011",
    referencia_pago: "TRF-889",
    payment_date: "2026-10-01",
    amount: 100,
    client_name: "Cliente",
    client_id: "cli1",
    facturas: ["FAC-HON-000026"],
    payment_account_code: "100001",
    banco_valido: true,
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.asiento.reference, "CO-000011");
  assert.equal(r.asiento.referencia_externa, "TRF-889");
});

test("pago a proveedor: PA- en reference y el cheque en referencia_externa (la factura sigue en la descripción)", () => {
  const r = construirAsientoDePagoProveedor({
    pago_id: "sp1",
    payment_number: "PA-000008",
    referencia_pago: "CHQ-551",
    documento_kind: "compra",
    documento_id: "c1",
    documento_description: "Insumos",
    supplier_name: "PROV",
    supplier_id: "p1",
    supplier_invoice_number: "F-123",
    payment_date: "2026-10-01",
    amount: 50,
    payment_account_code: "100001",
    banco_valido: true,
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.asiento.reference, "PA-000008");
  assert.equal(r.asiento.referencia_externa, "CHQ-551");
  assert.match(r.asiento.description, /fact\. F-123/);
});

test("🔒 la compra y el gasto de trámite toman el número ANTES de postear (SOP-031)", () => {
  const compras = leer("src/lib/finanzas/api/business-expenses.ts");
  const iNumero = compras.indexOf("allocatePurchaseNumber(db, tenantId)");
  const iInsert = compras.indexOf('.from("business_expenses")\n    .insert(');
  assert.ok(iNumero > 0 && iInsert > iNumero, "el número va antes del INSERT de la compra");

  const tramite = leer("src/lib/finanzas/api/expense-tramite.ts");
  const iNum = tramite.indexOf("allocatePurchaseNumber(db, tenantId)");
  const iPost = tramite.indexOf("postJournalEntry(db, tenantId, asiento, userId)");
  assert.ok(iNum > 0 && iPost > iNum, "el número va antes del posteo del gasto");
  assert.match(tramite, /purchase_number \?\? null;\n  if \(!numero\)/, "un reintento reusa el número que ya tiene");
});

// ---------------------------------------------------------------------------
// 2. El módulo
// ---------------------------------------------------------------------------

test("cada source_type del motor tiene módulo, salvo la reversión que toma el del original", () => {
  for (const st of SOURCE_TYPES) {
    const m = moduloDelAsiento(st);
    if (st === "reversion") {
      assert.equal(m.modulo, null);
      assert.equal(m.esReversion, true);
    } else {
      assert.ok(m.modulo, `${st} sin módulo`);
    }
  }
});

test("P-2b: compra y gasto de trámite son FAC-CO; cobros CO; pagos PA; diario AD", () => {
  assert.equal(moduloDelAsiento("gasto").modulo, "FAC-CO");
  assert.equal(moduloDelAsiento("gasto_tramite").modulo, "FAC-CO");
  assert.equal(moduloDelAsiento("factura").modulo, "FAC-ING");
  assert.equal(moduloDelAsiento("pago").modulo, "CO");
  assert.equal(moduloDelAsiento("pago_proveedor").modulo, "PA");
  assert.equal(moduloDelAsiento("nota_credito").modulo, "NC-ING");
  assert.equal(moduloDelAsiento("nota_credito_proveedor").modulo, "NC-CO");
  assert.equal(moduloDelAsiento("manual").modulo, "AD");
  assert.equal(moduloDelAsiento("apertura").modulo, "AP");
  assert.equal(moduloDelAsiento("cierre").modulo, "CA");
});

test("una reversión lleva el módulo de su original con la marca, y sin original dice solo Reversión", () => {
  assert.equal(etiquetaDeModulo(moduloDelAsiento("reversion", "pago")), "CO · Reversión");
  assert.equal(etiquetaDeModulo(moduloDelAsiento("reversion", null)), "Reversión");
  assert.equal(etiquetaDeModulo(moduloDelAsiento("manual")), "AD");
});

test("ningún source_type cae en dos módulos", () => {
  const vistos = new Set<string>();
  for (const m of MODULOS) {
    for (const st of m.sourceTypes) {
      assert.ok(!vistos.has(st), `${st} está en dos módulos`);
      vistos.add(st);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. El tercero en el formulario del asiento de diario
// ---------------------------------------------------------------------------

const CONTROLES = new Map<string, CuentaControl>([
  ["100004", "clientes"],
  ["200001", "proveedores"],
]);

function l(over: Partial<LineaManualDraft>): LineaManualDraft {
  return { ...lineaManualVacia(Math.random().toString()), ...over };
}

test("tercerosFaltantes: sin tercero, o del tipo equivocado, con el número de la PANTALLA", () => {
  const lineas = [
    l({}), // vacía: no cuenta, pero sí ocupa el número 1
    l({ account_code: "100004", debit: "10", tercero: valorDeTercero("proveedor", "p1") }),
    l({ account_code: "200001", credit: "10" }),
    l({ account_code: "600001", debit: "5" }),
  ];
  assert.deepEqual(
    tercerosFaltantes(lineas, CONTROLES).map((f) => [f.numero, f.account_code, f.control]),
    [
      [2, "100004", "clientes"],
      [3, "200001", "proveedores"],
    ]
  );
});

test("el botón dice por qué está apagado: falta el cliente de la línea 1", () => {
  const lineas = [
    l({ account_code: "100004", debit: "10" }),
    l({ account_code: "400001", credit: "10" }),
  ];
  const e = estadoDelRegistro(lineas, "Ajuste de saldo", false, CONTROLES);
  assert.equal(e.puede, false);
  assert.match(e.motivo ?? "", /^Elige el cliente de la línea 1: la cuenta 100004 es de clientes/);
  // Sin el mapa de cuentas control (pantallas viejas) no se mira el tercero.
  assert.equal(estadoDelRegistro(lineas, "Ajuste de saldo").puede, true);
});

test("con el tercero puesto se puede registrar, y armar lo manda en client_id", () => {
  const lineas = [
    l({ account_code: "100004", debit: "10", tercero: valorDeTercero("cliente", "c1") }),
    l({ account_code: "400001", credit: "10" }),
  ];
  assert.equal(estadoDelRegistro(lineas, "Ajuste de saldo", false, CONTROLES).puede, true);
  const a = armarAsientoManual(lineas, CONTROLES);
  assert.ok(a.ok);
  if (a.ok) assert.equal(a.lineas[0].client_id, "c1");
  assert.equal(armarAsientoManual([lineas[0], l({ account_code: "200001", credit: "10" })], CONTROLES).ok, false);
});

test("🔒 el formulario manda la referencia como EXTERNA y le pasa las cuentas control a la regla", () => {
  const form = leer("src/app/finanzas/asientos/_components/asiento-manual-form.tsx");
  assert.match(form, /referencia_externa: referencia/);
  assert.doesNotMatch(form, /\breference: referencia/);
  assert.match(form, /estadoDelRegistro\(lineas, descripcion, enviando, controles\)/);
  assert.match(form, /Esta línea afecta la antigüedad de/);
});

// ---------------------------------------------------------------------------
// 4. El caso cerrado
// ---------------------------------------------------------------------------

test("esEstadoCerrado: la misma regla que pinta el badge gris", () => {
  assert.equal(esEstadoCerrado("Cerrado"), true);
  assert.equal(esEstadoCerrado("Archivado"), true);
  assert.equal(esEstadoCerrado("En trámite"), false);
  assert.equal(esEstadoCerrado(null), false);
});

test("🔒 el gasto en un caso cerrado pregunta EN PANTALLA antes de guardar, con el texto del bufete", () => {
  const form = leer("src/components/cases/section-expense-form.tsx");
  assert.match(form, /Este caso está cerrado\. ¿Deseas registrar el gasto igual\?/);
  assert.match(form, /if \(casoCerrado && !confirmadoCasoCerrado\)/);
  assert.doesNotMatch(form, /window\.confirm|\bconfirm\(/, "nunca un diálogo del navegador");
  const pagina = leer("src/app/legal/casos/[id]/page.tsx");
  assert.equal((pagina.match(/casoCerrado=\{esEstadoCerrado\(status\?\.name\)\}/g) ?? []).length, 2, "las dos secciones");
});
