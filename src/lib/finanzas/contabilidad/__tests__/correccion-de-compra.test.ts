/**
 * 🔒 CORREGIR UNA COMPRA CONTABILIZADA (103).
 *
 * Fija: por qué no se corrige (pagos, NC, mes cerrado, en ese orden y con los
 * textos de la base), qué cambió en cada versión, y que la corrección va por UNA
 * función de la base que reversa y postea en la misma transacción, con el
 * asiento de `construirAsientoDeCompra` (el del alta) y el espejo de
 * `construirAsientoDeReversion`: nada reimplementado.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { cambiosDeLaCorreccion, motivoParaNoCorregir } from "../correccion-de-compra";

const leer = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("sin pagos, sin NC y con el mes abierto, se corrige", () => {
  assert.equal(motivoParaNoCorregir({ pagos: [], notasDeCredito: [], mesCerrado: null }), null);
});

test("🔴 con pagos dice cuáles reversar primero; después NC; después mes cerrado", () => {
  const conTodo = motivoParaNoCorregir({ pagos: ["PA-000003", "saldo heredado"], notasDeCredito: ["NC-CO-000001"], mesCerrado: "09/2026" });
  assert.match(conTodo!, /2 pago\(s\) registrado\(s\) \(PA-000003, saldo heredado\)/);
  assert.match(conTodo!, /Primero reversa los pagos/);
  const nc = motivoParaNoCorregir({ pagos: [], notasDeCredito: ["NC-CO-000001"], mesCerrado: "09/2026" });
  assert.match(nc!, /nota\(s\) de crédito del proveedor \(NC-CO-000001\)/);
  const mes = motivoParaNoCorregir({ pagos: [], notasDeCredito: [], mesCerrado: "09/2026" });
  assert.match(mes!, /El mes del asiento de la compra \(09\/2026\) está cerrado/);
  assert.match(mes!, /reabre el mes en Períodos contables/);
});

test("🔴 los textos de bloqueo son los mismos que devuelve la base", () => {
  const sql = leer("sql/pending/103_corregir_compra.sql");
  for (const frase of [
    "pago(s) registrado(s)",
    "Primero reversa los pagos con asiento o elimina los que no lo tienen; después se corrige la compra.",
    "nota(s) de crédito del proveedor",
    "Primero se reversan; después se corrige la compra.",
    "está cerrado: la compra no se corrige. El ajuste va con un asiento de diario en un mes abierto, o el contador reabre el mes en Períodos contables.",
  ]) assert.ok(sql.includes(frase), `la base no dice: ${frase}`);
});

test("qué cambió: fecha de registro, cuenta y monto de una línea, total", () => {
  const antes = {
    accounting_date: "2026-10-14", expense_date: "2026-10-14", supplier_id: "p1", total: "107.00",
    lineas: [{ description: "Internet", chart_account_code: "610005", amount: "100.00", tax_code_id: "t7", tax_amount: "7.00" }],
  };
  const despues = {
    ...antes, accounting_date: "2026-10-13", total: "128.40",
    lineas: [{ description: "Internet", chart_account_code: "600001", amount: "120.00", tax_code_id: "t7", tax_amount: "8.40" }],
  };
  const c = cambiosDeLaCorreccion(antes, despues);
  assert.deepEqual(c, [
    "Fecha de registro: 14/10/2026 → 13/10/2026",
    "Línea 1, cuenta: 610005 → 600001",
    "Línea 1, base: 100.00 → 120.00",
    "Línea 1, ITBMS: 7.00 → 8.40",
    "Total: 107.00 → 128.40",
  ]);
  assert.deepEqual(cambiosDeLaCorreccion(antes, antes), []);
  assert.deepEqual(
    cambiosDeLaCorreccion({ lineas: [] }, { lineas: [{ chart_account_code: "610005", amount: 5 }] }),
    ["Línea 1 agregada: 610005 por 5.00"]
  );
});

test("🔴 una transacción en la base, con el asiento del alta y el espejo de toda reversión", () => {
  const api = leer("src/lib/finanzas/api/business-expenses.ts");
  const corregir = api.slice(api.indexOf("export async function corregirBusinessExpense"), api.indexOf("// DELETE (hard delete"));
  assert.match(corregir, /rpc\("corregir_compra"/);
  assert.doesNotMatch(corregir, /rpc\("(post_journal_entry|reverse_journal_entry)"|postJournalEntry\(/,
    "postear desde la app en dos pasos dejaría una compra a medio corregir");
  assert.doesNotMatch(corregir, /\.from\("(business_expenses|expense_lines)"\)\s*\.(update|insert|delete)/,
    "la compra se actualiza dentro de la función de la base, en la misma transacción");
  assert.match(corregir, /construirAsientoDeCompra\(/);
  assert.match(corregir, /construirAsientoDeReversion\(/);
  assert.match(corregir, /armarCompraParaAsiento\(/);
  // Las mismas validaciones que el alta, antes de tocar el libro.
  for (const v of ["validarCuentasDeLineas(", "resolverFechaDeRegistro(", "resolverLineasDeCompra(", "asegurarFechaDesdeElInicio("]) {
    assert.ok(corregir.includes(v), `falta ${v}`);
  }
  const alta = api.slice(api.indexOf("export async function createBusinessExpense"));
  assert.match(alta, /validarCuentasDeLineas\(/);

  const ruta = leer("src/app/api/finanzas/business-expenses/[id]/corregir/route.ts");
  assert.match(ruta, /createAdminClient\(ctx\.userId\)/);
  assert.match(ruta, /ctx\.tenantId/);
  assert.doesNotMatch(ruta, /body\.tenant_id|tenantId:\s*body/);

  const sql = leer("sql/pending/103_corregir_compra.sql");
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.corregir_compra\([^)]*\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.corregir_compra\([^)]*\) TO service_role/);
  // La reversión con la fecha del asiento que revierte; el nuevo con la fecha de registro nueva.
  assert.match(sql, /'reversion', p_espejo, p_compra_id, NULL, v_orig\.id/);
  assert.match(sql, /p_tenant_id, v_orig\.transaction_date,/);
});

test("🔴 la pantalla ofrece «Corregir» y dice por qué no ANTES de editar", () => {
  const acciones = leer("src/app/finanzas/gastos-bufete/_components/business-expense-actions.tsx");
  assert.match(acciones, /"Corregir"/);
  assert.match(acciones, /correccion\.bloqueo/);
  const editar = leer("src/app/finanzas/gastos-bufete/[id]/editar/page.tsx");
  assert.match(editar, /estadoDeCorreccionDeCompra\(/);
  const detalle = leer("src/app/finanzas/gastos-bufete/[id]/page.tsx");
  assert.match(detalle, /Historial de versiones/);
  // El gate del PATCH ya no promete algo que no existe.
  const api = leer("src/lib/finanzas/api/business-expenses.ts");
  assert.doesNotMatch(api, /se habilita junto con el asiento/);
});
