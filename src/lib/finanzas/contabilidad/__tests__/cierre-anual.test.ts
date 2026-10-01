/**
 * 🔒 E11 (migración 080): el armado del asiento de CIERRE ANUAL.
 *
 *   1. Cada cuenta de resultado con saldo va EN CONTRA; la diferencia a 300002
 *      (utilidad al haber, pérdida al debe). El asiento cuadra.
 *   2. Las cuentas en cero no generan línea; sin saldos no hay asiento.
 *   3. Fecha 31/12 y descripción «Cierre del ejercicio AAAA».
 *   4. La aritmética de las líneas es la MISMA que la de `close_fiscal_year`
 *      (la base verifica, no recalcula de otra forma): el test lee la 080.
 *   5. `reverse_journal_entry` acepta exactamente los tipos de
 *      SOURCE_TYPES_REVERSABLES_DESDE_EL_ASIENTO.
 *   6. La ruta saca el tenant del perfil y va con el cliente de servicio, y el
 *      Estado de Resultado excluye los cierres.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  construirAsientoDeCierre,
  SOURCE_TYPES_REVERSABLES_DESDE_EL_ASIENTO,
  type SaldoDeResultado,
} from "@/lib/finanzas/contabilidad/cierre-anual";

const RAIZ = path.resolve(__dirname, "../../../../..");
const leer = (p: string) => readFileSync(path.join(RAIZ, p), "utf8");

const SALDOS: SaldoDeResultado[] = [
  { account_code: "400001", account_name: "Derecho Corporativo", account_type: "income", saldo: -1000 },
  { account_code: "430001", account_name: "Descuentos otorgados", account_type: "income", saldo: 50 },
  { account_code: "500001", account_name: "Costo", account_type: "cost", saldo: 200 },
  { account_code: "610009", account_name: "Combustible", account_type: "expense", saldo: 150.25 },
  { account_code: "620001", account_name: "Sin movimiento", account_type: "expense", saldo: 0 },
];

function sumas(lineas: { debit: number; credit: number }[]) {
  const d = lineas.reduce((s, l) => s + l.debit, 0);
  const c = lineas.reduce((s, l) => s + l.credit, 0);
  return { d: Math.round(d * 100) / 100, c: Math.round(c * 100) / 100 };
}

test("utilidad: cada cuenta en contra y la utilidad al HABER de 300002; cuadra", () => {
  const r = construirAsientoDeCierre(2026, SALDOS);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.fecha, "2026-12-31");
  assert.equal(r.descripcion, "Cierre del ejercicio 2026");
  const por = new Map(r.lineas.map((l) => [l.account_code, l]));
  assert.deepEqual([por.get("400001")!.debit, por.get("400001")!.credit], [1000, 0], "el ingreso se debita");
  assert.deepEqual([por.get("430001")!.debit, por.get("430001")!.credit], [0, 50], "el descuento se acredita");
  assert.deepEqual([por.get("610009")!.debit, por.get("610009")!.credit], [0, 150.25]);
  assert.ok(!por.has("620001"), "una cuenta en cero no genera línea");
  // 1000 − 50 − 200 − 150.25 = 599.75 de utilidad
  assert.deepEqual([por.get("300002")!.debit, por.get("300002")!.credit], [0, 599.75]);
  assert.equal(r.utilidad, 599.75);
  const t = sumas(r.lineas);
  assert.equal(t.d, t.c, "el asiento cuadra");
});

test("pérdida: la diferencia va al DEBE de 300002", () => {
  const r = construirAsientoDeCierre(2026, [
    { account_code: "400001", account_name: "Ingreso", account_type: "income", saldo: -100 },
    { account_code: "600001", account_name: "Gasto", account_type: "expense", saldo: 400 },
  ]);
  assert.ok(r.ok);
  if (!r.ok) return;
  const l300 = r.lineas.find((l) => l.account_code === "300002")!;
  assert.deepEqual([l300.debit, l300.credit], [300, 0]);
  assert.equal(r.utilidad, -300);
  const t = sumas(r.lineas);
  assert.equal(t.d, t.c);
});

test("sin saldos no hay asiento; un año inválido se rechaza", () => {
  const r = construirAsientoDeCierre(2026, [
    { account_code: "400001", account_name: "Ingreso", account_type: "income", saldo: 0 },
  ]);
  assert.equal(r.ok, false);
  assert.equal(construirAsientoDeCierre(1999, SALDOS).ok, false);
});

test("🔒 la base verifica con la MISMA aritmética (close_fiscal_year en la 080)", () => {
  const sql = leer("sql/pending/080_cierre_anual.sql");
  // saldo < 0 → debe; saldo > 0 → haber; la diferencia a 300002 con el signo del neto.
  assert.match(sql, /CASE WHEN s\.saldo < 0 THEN -s\.saldo ELSE 0 END AS debit/);
  assert.match(sql, /CASE WHEN s\.saldo > 0 THEN s\.saldo ELSE 0 END AS credit/);
  assert.match(sql, /CASE WHEN v_neto > 0 THEN v_neto ELSE 0 END/);
  assert.match(sql, /CASE WHEN v_neto < 0 THEN -v_neto ELSE 0 END/);
  assert.match(sql, /c_cuenta\s+CONSTANT text := '300002'/);
});

test("🔒 reverse_journal_entry acepta exactamente los tipos reversables desde el asiento", () => {
  const sql = leer("sql/pending/080_cierre_anual.sql");
  const m = /IF v_source_type NOT IN \(([^)]*)\)/.exec(sql);
  assert.ok(m, "falta el parche de reverse_journal_entry");
  const enSql = m![1].split(",").map((x) => x.trim().replace(/'/g, ""));
  assert.deepEqual(enSql, [...SOURCE_TYPES_REVERSABLES_DESDE_EL_ASIENTO]);
});

test("la ruta del cierre: tenant del perfil, cliente de servicio, admin y contador", () => {
  const ruta = leer("src/app/api/finanzas/periodos/cierre-anual/route.ts");
  assert.match(ruta, /ctx\.tenantId/);
  assert.ok(!/body[^;\n]*tenant/i.test(ruta), "el tenant nunca sale del body");
  assert.match(ruta, /createAdminClient\(\)/);
  assert.match(ruta, /const ROLES = \["admin", "contador"\]/);
});

test("el Estado de Resultado excluye los cierres; el Balance no", () => {
  assert.match(leer("src/app/finanzas/reportes/pyl/page.tsx"), /excluirCierre: true/);
  assert.ok(!/excluirCierre/.test(leer("src/app/finanzas/reportes/balance/page.tsx")));
});
