/**
 * 🔒 E9: el FILTRO POR MÓDULO del Mayor y del Diario.
 *
 *   1. `?modulo=` se lee con tolerancia: códigos desconocidos se descartan.
 *   2. Una reversión entra con el módulo de lo que revierte.
 *   3. En el Mayor el saldo corrido NO se recalcula: sigue siendo el de la
 *      cuenta completa. El pie sí suma solo lo que se ve.
 *   4. En el Diario se filtra antes de armar y los totales son los de lo visible.
 *   5. La pantalla y el Excel del Mayor usan la MISMA función.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  entraEnElFiltro,
  modulosDesdeParametro,
  moduloDelAsiento,
} from "@/lib/finanzas/contabilidad/modulo-del-asiento";
import {
  buildMayorDeCuenta,
  filtrarMayorPorModulos,
  type CuentaDelMayor,
  type MovimientoCrudo,
} from "@/lib/finanzas/reports/libro-mayor";
import {
  buildDiarioGeneral,
  filtrarAsientosPorModulos,
  type AsientoCrudo,
} from "@/lib/finanzas/reports/diario-general";

const RAIZ = path.resolve(__dirname, "../../../../..");

test("?modulo= se lee en el orden de MODULOS y descarta lo desconocido", () => {
  assert.deepEqual(modulosDesdeParametro("ad, co,XYZ,co"), ["CO", "AD"]);
  assert.deepEqual(modulosDesdeParametro(""), []);
  assert.deepEqual(modulosDesdeParametro(undefined), []);
});

test("sin módulos elegidos entra todo; una reversión entra con el módulo de su original", () => {
  assert.equal(entraEnElFiltro(moduloDelAsiento("pago"), []), true);
  assert.equal(entraEnElFiltro(moduloDelAsiento("reversion", "pago"), ["CO"]), true);
  assert.equal(entraEnElFiltro(moduloDelAsiento("reversion", "factura"), ["CO"]), false);
  // Una reversión sin su original no tiene módulo: sólo entra sin filtro.
  assert.equal(entraEnElFiltro(moduloDelAsiento("reversion", null), ["CO"]), false);
});

const BANCO: CuentaDelMayor = {
  code: "100001",
  name: "Banco",
  account_type: "asset",
  saldo_inicial: 1000,
  saldo_inicial_fecha: "2026-01-01",
};

function mov(n: number, source_type: string, debit: number, credit: number, extra: Partial<MovimientoCrudo> = {}): MovimientoCrudo {
  return {
    entry_id: `e-${n}`,
    entry_number: n,
    transaction_date: `2026-09-0${n}`,
    source_type,
    source_id: `s-${n}`,
    entry_description: `Asiento ${n}`,
    line_description: null,
    line_order: 1,
    debit,
    credit,
    account_code: BANCO.code,
    account_name: BANCO.name,
    account_type: "asset",
    hermanas: [{ code: BANCO.code, name: BANCO.name, debit, credit, line_order: 1, descripcion: null }],
    ...extra,
  };
}

test("Mayor filtrado: el saldo corrido es el de la cuenta completa y el pie suma lo visible", () => {
  const completo = buildMayorDeCuenta(BANCO, [
    mov(1, "pago", 500, 0), // CO: saldo 1500
    mov(2, "pago_proveedor", 0, 200), // PA: saldo 1300
    mov(3, "reversion", 0, 500, { reverses_source_type: "pago" }), // CO · Reversión: saldo 800
    mov(4, "manual", 50, 0), // AD: saldo 850
  ]);
  const co = filtrarMayorPorModulos(completo, ["CO"]);

  assert.deepEqual(
    co.filas.map((f) => f.kind === "saldo-inicial" ? "SI" : f.modulo),
    ["SI", "CO", "CO · Reversión"]
  );
  // La columna Saldo NO se recalcula: 1500 y 800, no 1500 y 1000.
  assert.deepEqual(co.filas.map((f) => f.saldo), [1000, 1500, 800]);
  assert.equal(co.totales.totalDebitos, 500);
  assert.equal(co.totales.totalCreditos, 500);
  assert.equal(co.totales.netoDelPeriodo, 0);
  // El saldo final sigue siendo el de la cuenta.
  assert.equal(co.totales.saldoFinal, completo.totales.saldoFinal);
  assert.equal(co.cantidadMovimientos, 2);
  assert.deepEqual(co.filtroModulos, ["CO"]);

  // Sin filtro, el mismo objeto.
  assert.equal(filtrarMayorPorModulos(completo, []), completo);
});

function asiento(n: number, source_type: string, monto: number, extra: Partial<AsientoCrudo> = {}): AsientoCrudo {
  return {
    entry_id: `e${n}`,
    entry_number: n,
    transaction_date: "2026-09-01",
    description: `Asiento ${n}`,
    source_type,
    source_id: null,
    documento: null,
    lineas: [
      { line_order: 0, account_code: "100001", account_name: "Banco", line_description: null, debit: monto, credit: 0 },
      { line_order: 1, account_code: "100004", account_name: "CxC", line_description: null, debit: 0, credit: monto },
    ],
    ...extra,
  };
}

test("Diario filtrado: sólo los asientos del módulo (con sus reversiones) y totales de lo visible", () => {
  const crudos = [
    asiento(1, "factura", 1000),
    asiento(2, "pago", 300),
    asiento(3, "reversion", 300, { reverses_source_type: "pago" }),
    asiento(4, "manual", 40),
  ];
  const d = buildDiarioGeneral(filtrarAsientosPorModulos(crudos, ["CO", "AD"]));
  assert.deepEqual(d.asientos.map((a) => a.numero), [2, 3, 4]);
  assert.equal(d.totalDebito, 640);
  assert.equal(filtrarAsientosPorModulos(crudos, []), crudos);
});

test("la pantalla y el Excel del Mayor filtran con la MISMA función y el mismo parámetro", () => {
  for (const archivo of [
    "src/app/finanzas/reportes/mayor/page.tsx",
    "src/app/api/finanzas/reportes/mayor/export/route.ts",
  ]) {
    const src = readFileSync(path.join(RAIZ, archivo), "utf8");
    assert.match(src, /filtrarMayorPorModulos\(/, `${archivo} no usa filtrarMayorPorModulos`);
    assert.match(src, /modulosDesdeParametro\(/, `${archivo} no lee ?modulo= con modulosDesdeParametro`);
  }
  const pantalla = readFileSync(path.join(RAIZ, "src/app/finanzas/reportes/mayor/page.tsx"), "utf8");
  assert.match(pantalla, /&modulo=/, "el botón de exportar no pasa el filtro de módulos");
});
