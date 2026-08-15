/**
 * Tests del filtro de presentación "solo cuentas con saldo" (Balance General y
 * Estado de Resultado).
 *
 * La propiedad que importa: filtrar OCULTA FILAS y NO TOCA NÚMEROS. Los totales
 * y subtotales de la vista filtrada tienen que ser byte a byte los mismos que
 * los de la vista completa; si alguien hace que el filtro recalcule, estos tests
 * lo cazan.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/reports/__tests__/report-visibility.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAccountingReports,
  buildEstadoResultado,
  type ReportAccount,
  type ReportSection,
} from "@/lib/finanzas/reports/accounting-reports";
import {
  DEFAULT_ACCOUNT_VISIBILITY,
  countZeroRows,
  filterGroups,
  filterSection,
  hasBalance,
} from "@/lib/finanzas/reports/report-visibility";
import { JOSUAR_ACCOUNTS } from "./josuar-accounts.fixture";

/** Códigos de cuenta visibles en una sección, en orden. */
function visibleCodes(section: ReportSection): string[] {
  return section.groups.flatMap((g) => g.rows.map((r) => r.code));
}

/** Etiquetas de los grupos visibles (los sin encabezado quedan como null). */
function visibleGroupLabels(section: ReportSection): (string | null)[] {
  return section.groups.map((g) => g.label);
}

// ===========================================================================
// 1) El default y el predicado
// ===========================================================================

test("el default es 'solo cuentas con saldo' (pedido de Josuar)", () => {
  assert.equal(DEFAULT_ACCOUNT_VISIBILITY, "with-balance");
});

test("hasBalance: 0 y montos por debajo de medio centavo cuentan como cero", () => {
  assert.equal(hasBalance(0), false);
  assert.equal(hasBalance(-0), false);
  assert.equal(hasBalance(0.004), false);
  assert.equal(hasBalance(-0.004), false);

  assert.equal(hasBalance(0.005), true);
  assert.equal(hasBalance(-0.005), true);
  assert.equal(hasBalance(0.01), true);
  assert.equal(hasBalance(-1520.2), true);
});

// ===========================================================================
// 2) "Solo con saldo" oculta las cuentas en 0 y NO mueve los totales
// ===========================================================================

test("Balance General: 'solo con saldo' oculta las cuentas en 0 y deja los totales idénticos", () => {
  const { balanceGeneral: bg } = buildAccountingReports(JOSUAR_ACCOUNTS);

  for (const section of [bg.activos, bg.pasivos, bg.patrimonio]) {
    const all = filterSection(section, "all");
    const conSaldo = filterSection(section, "with-balance");

    // El total de la sección no se toca.
    assert.equal(conSaldo.total, section.total, `total de ${section.label}`);
    assert.equal(conSaldo.label, section.label);
    assert.equal(conSaldo.totalLabel, section.totalLabel);

    // Ninguna fila visible está en 0...
    for (const row of conSaldo.groups.flatMap((g) => g.rows)) {
      assert.ok(hasBalance(row.amount), `${row.code} está en 0 y quedó visible`);
    }

    // ...y las que quedan son exactamente las que tenían saldo.
    const esperadas = visibleCodes(all).filter((code) => {
      const row = all.groups.flatMap((g) => g.rows).find((r) => r.code === code)!;
      return hasBalance(row.amount);
    });
    assert.deepEqual(visibleCodes(conSaldo), esperadas, `cuentas visibles en ${section.label}`);

    // Los subtotales de los grupos que sobreviven quedan intactos.
    for (const g of conSaldo.groups) {
      const original = section.groups.find((o) => o.label === g.label)!;
      assert.equal(g.subtotal, original.subtotal, `subtotal de ${g.label ?? "(grupo plano)"}`);
      assert.equal(g.subtotalLabel, original.subtotalLabel);
    }
  }
});

test("Estado de Resultado: 'solo con saldo' no cambia ningún total ni renglón calculado", () => {
  const er = buildEstadoResultado(JOSUAR_ACCOUNTS);

  const ingresos = filterSection(er.ingresos, "with-balance");
  const costos = filterSection(er.costos, "with-balance");
  const gastos = filterSection(er.gastos, "with-balance");

  assert.equal(ingresos.total, er.ingresos.total);
  assert.equal(costos.total, er.costos.total);
  assert.equal(gastos.total, er.gastos.total);

  // Los renglones calculados no pasan por el filtro: se derivan de los totales,
  // que acabamos de verificar que no se movieron.
  assert.equal(er.gananciaBruta, -279258.68);
  assert.equal(er.utilidadOperativa, -244476.91);

  // Con el fixture real hay cuentas en 0 en las tres secciones.
  assert.ok(
    visibleCodes(ingresos).length < visibleCodes(er.ingresos).length,
    "ingresos: el filtro tiene que ocultar algo"
  );
  assert.ok(visibleCodes(costos).length < visibleCodes(er.costos).length);
  assert.ok(visibleCodes(gastos).length < visibleCodes(er.gastos).length);
});

// ===========================================================================
// 3) Un grupo entero en 0 desaparece (encabezado y subtotal incluidos)
// ===========================================================================

test("un grupo cuyas cuentas están TODAS en 0 se oculta entero", () => {
  // En el plan de Josuar, "Propiedad, planta y equipo" son 2 cuentas en 0.
  const { balanceGeneral: bg } = buildAccountingReports(JOSUAR_ACCOUNTS);

  const todas = filterSection(bg.activos, "all");
  assert.ok(
    visibleGroupLabels(todas).includes("Propiedad, planta y equipo"),
    "en la vista completa el grupo tiene que estar"
  );

  const conSaldo = filterSection(bg.activos, "with-balance");
  assert.ok(
    !visibleGroupLabels(conSaldo).includes("Propiedad, planta y equipo"),
    "el grupo entero en 0 tiene que desaparecer"
  );

  // Y el total de la sección sigue siendo el mismo.
  assert.equal(conSaldo.total, bg.activos.total);
});

test("el PATRIMONIO de Josuar (3 cuentas en 0) queda sin grupos, pero conserva su total", () => {
  const { balanceGeneral: bg } = buildAccountingReports(JOSUAR_ACCOUNTS);

  const conSaldo = filterSection(bg.patrimonio, "with-balance");
  assert.equal(conSaldo.groups.length, 0, "no queda ningún grupo visible");
  assert.equal(conSaldo.total, bg.patrimonio.total, "el total de la sección se conserva");
  assert.equal(conSaldo.total, -244476.91);
});

test("filterGroups: una sección con TODOS los grupos en 0 devuelve lista vacía", () => {
  const enCero: ReportAccount[] = [
    { code: "100001", name: "Banco", account_type: "asset", subcategoria: "activo_corriente", saldo: 0 },
    { code: "110001", name: "Mobiliario", account_type: "asset", subcategoria: "propiedad_planta_equipo", saldo: 0 },
  ];
  const { balanceGeneral: bg } = buildAccountingReports(enCero);

  assert.equal(bg.activos.groups.length, 2, "sin filtrar hay 2 grupos");
  assert.equal(filterGroups(bg.activos.groups, "with-balance").length, 0);
  assert.equal(filterGroups(bg.activos.groups, "all").length, 2);
});

// ===========================================================================
// 4) "Todas las cuentas" no toca nada
// ===========================================================================

test("'todas las cuentas' devuelve la sección tal cual, sin copiar ni perder filas", () => {
  const { balanceGeneral: bg } = buildAccountingReports(JOSUAR_ACCOUNTS);

  for (const section of [bg.activos, bg.pasivos, bg.patrimonio]) {
    const todas = filterSection(section, "all");
    assert.equal(todas, section, "la vista completa devuelve la MISMA referencia");
  }
});

test("'todas las cuentas' muestra las 62 cuentas del plan de Josuar", () => {
  const { balanceGeneral: bg, estadoResultado: er } = buildAccountingReports(JOSUAR_ACCOUNTS);

  const visibles = [bg.activos, bg.pasivos, bg.patrimonio, er.ingresos, er.costos, er.gastos]
    .map((s) => filterSection(s, "all"))
    .flatMap(visibleCodes);

  assert.equal(visibles.length, 62, "las 62 cuentas del fixture están visibles");
  assert.equal(new Set(visibles).size, 62, "sin duplicados entre secciones");
});

// ===========================================================================
// 5) El contador de cuentas ocultas
// ===========================================================================

test("countZeroRows cuenta exactamente las cuentas en 0 de las secciones dadas", () => {
  const { balanceGeneral: bg, estadoResultado: er } = buildAccountingReports(JOSUAR_ACCOUNTS);

  const secciones = [bg.activos, bg.pasivos, bg.patrimonio];
  const ocultasBg = countZeroRows(secciones);
  const visiblesBg = secciones.flatMap((s) => visibleCodes(filterSection(s, "with-balance")));
  const totalBg = secciones.flatMap(visibleCodes);

  assert.equal(ocultasBg, totalBg.length - visiblesBg.length, "ocultas = totales - visibles");
  assert.ok(ocultasBg > 0, "el plan de Josuar tiene cuentas en 0");

  const seccionesEr = [er.ingresos, er.costos, er.gastos];
  const ocultasEr = countZeroRows(seccionesEr);
  const visiblesEr = seccionesEr.flatMap((s) => visibleCodes(filterSection(s, "with-balance")));
  assert.equal(ocultasEr, seccionesEr.flatMap(visibleCodes).length - visiblesEr.length);
});

test("countZeroRows da 0 cuando todas las cuentas tienen saldo", () => {
  const conSaldo: ReportAccount[] = [
    { code: "100001", name: "Banco", account_type: "asset", subcategoria: "activo_corriente", saldo: 1500 },
    { code: "200001", name: "Por pagar", account_type: "liability", subcategoria: "pasivo_corriente", saldo: -300 },
  ];
  const { balanceGeneral: bg } = buildAccountingReports(conSaldo);

  assert.equal(countZeroRows([bg.activos, bg.pasivos]), 0);
  assert.deepEqual(visibleCodes(filterSection(bg.activos, "with-balance")), ["100001"]);
});
