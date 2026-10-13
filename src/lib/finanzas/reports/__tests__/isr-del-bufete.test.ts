/**
 * 🔒 E10: la tasa de ISR es del BUFETE (078) y el Balance lleva la utilidad NETA.
 *
 *   1. El validador recibe FRACCIÓN: 0.25 entra, 25 (un porcentaje) no.
 *   2. Con tasa 0 el Balance es el de siempre.
 *   3. Con tasa distinta de 0 el impuesto calculado va al pasivo y el Balance
 *      SIGUE cuadrando: la neta del patrimonio + el pasivo calculado = antes.
 *   4. El Estado de Resultado y el Balance leen la tasa con la MISMA función.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { validarParametros } from "@/lib/finanzas/validators/parametros";
import { buildAccountingReports, type ReportAccount } from "@/lib/finanzas/reports/accounting-reports";

const RAIZ = path.resolve(__dirname, "../../../../..");

function acc(code: string, account_type: ReportAccount["account_type"], subcategoria: string | null, saldo: number): ReportAccount {
  return { code, name: code, account_type, subcategoria, saldo } as ReportAccount;
}

test("la tasa llega en fracción: 0.25 entra, 25 se rechaza", () => {
  assert.deepEqual(validarParametros({ isr_rate: 0.25 }), { ok: true, data: { isr_rate: 0.25 } });
  assert.equal(validarParametros({ isr_rate: 25 }).ok, false);
  assert.equal(validarParametros({ isr_rate: -0.1 }).ok, false);
  assert.equal(validarParametros({}).ok, false);
  assert.deepEqual(validarParametros({ isr_rate: 0 }), { ok: true, data: { isr_rate: 0 } });
});

// Banco 1000 = capital 200 + ingreso 800 (balanza: activo +, pasivo/patrimonio/ingreso −).
const CUENTAS = [
  acc("100001", "asset", "activo_corriente", 1000),
  acc("300001", "equity", "capital_social", -200),
  acc("400001", "income", "ingresos_operativos", -800),
];

test("tasa 0: el patrimonio lleva la utilidad neta (= antes de impuesto) y cuadra", () => {
  const { balanceGeneral: bg } = buildAccountingReports(CUENTAS);
  assert.equal(bg.utilidadDelEjercicio, -800);
  assert.equal(bg.isrPorPagarCalculado, 0);
  assert.equal(bg.cuadra, true);
});

test("tasa 25 %: el ISR calculado va al pasivo y el Balance sigue cuadrando", () => {
  const { estadoResultado: er, balanceGeneral: bg } = buildAccountingReports(CUENTAS, { isrRate: 0.25 });
  assert.equal(er.isr.amount, 200);
  assert.equal(bg.utilidadDelEjercicio, -600, "la NETA, no la operativa");
  assert.equal(bg.isrPorPagarCalculado, -200, "pasivo calculado, negativo en balanza");
  assert.equal(bg.pasivos.total, -200);
  assert.equal(bg.cuadra, true);
});

test("el Estado de Resultado y el Balance leen la tasa con getTasaIsr", () => {
  for (const archivo of ["src/app/finanzas/reportes/pyl/page.tsx", "src/app/finanzas/reportes/balance/page.tsx"]) {
    const src = readFileSync(path.join(RAIZ, archivo), "utf8");
    assert.match(src, /getTasaIsr\(ctx\.db, ctx\.tenantId\)/, `${archivo} no lee la tasa del bufete`);
    assert.match(src, /isrRate/, `${archivo} no le pasa la tasa al builder`);
  }
});
