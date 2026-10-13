/**
 * 🔒 E6 (migración 079): subcategorías del plan de cuentas.
 *
 *   1. Obligatoria en los SEIS tipos.
 *   2. Las listas nuevas: sin `depreciacion_acumulada`, patrimonio en tres.
 *   3. El valor por defecto (`subcategoriaPorDefecto`) es el MISMO que aplica la
 *      079 en SQL, y siempre es válido para su tipo.
 *   4. El CHECK de la 079 espeja SUBCATEGORIAS_POR_TIPO: si alguien agrega una
 *      subcategoría en TS y no en la base (o al revés), falla.
 *   5. El Balance agrupa el patrimonio en tres y la depreciación resta en PPE.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ACCOUNT_TYPES,
  SUBCATEGORIAS,
  SUBCATEGORIAS_POR_TIPO,
  isSubcategoriaValidaParaTipo,
  requiereSubcategoria,
  subcategoriaPorDefecto,
} from "@/lib/finanzas/types/chart-of-account";
import { buildBalanceGeneral, type ReportAccount } from "@/lib/finanzas/reports/accounting-reports";

const RAIZ = path.resolve(__dirname, "../../../../..");

test("obligatoria en los seis tipos", () => {
  for (const t of ACCOUNT_TYPES) assert.equal(requiereSubcategoria(t), true, t);
});

test("listas nuevas: sin depreciación acumulada ni patrimonio; patrimonio en tres", () => {
  assert.ok(!(SUBCATEGORIAS as string[]).includes("depreciacion_acumulada"));
  assert.ok(!(SUBCATEGORIAS as string[]).includes("patrimonio"));
  assert.deepEqual(SUBCATEGORIAS_POR_TIPO.equity, ["capital_social", "resultados_acumulados", "otras_reservas"]);
});

test("el valor por defecto: la regla de la 079, y siempre válido para su tipo", () => {
  const casos: [Parameters<typeof subcategoriaPorDefecto>, string][] = [
    [["asset", "100001", "Banco General"], "activo_corriente"],
    [["asset", "112001", "Depr. de Mobiliario y equipo"], "propiedad_planta_equipo"],
    [["asset", "120009", "Amortización acumulada"], "propiedad_planta_equipo"],
    [["liability", "200001", "Cuentas por pagar"], "pasivo_corriente"],
    [["equity", "300001", "Capital Social"], "capital_social"],
    [["equity", "300002", "Perdida Retenidas"], "resultados_acumulados"],
    [["equity", "300003", "Utilidad del Ejercicio"], "resultados_acumulados"],
    [["equity", "310000", "Pérdida acumulada 2025"], "resultados_acumulados"],
    [["equity", "300004", "Distribución a Socias"], "otras_reservas"],
    [["income", "400009", "Derecho de Familia"], "ingresos_operativos"],
    [["cost", "500001", "Costo"], "costos_operativos"],
    [["expense", "600001", "Alquiler"], "gastos_operativos"],
  ];
  for (const [args, esperada] of casos) {
    const sub = subcategoriaPorDefecto(...args);
    assert.equal(sub, esperada, `${args[1]} ${args[2]}`);
    assert.ok(isSubcategoriaValidaParaTipo(args[0], sub));
  }
});

test("🔒 el CHECK de la 079 espeja SUBCATEGORIAS_POR_TIPO", () => {
  const sql = readFileSync(path.join(RAIZ, "sql/pending/079_subcategorias_y_cuentas_nuevas.sql"), "utf8");
  const check = sql.slice(sql.indexOf("ADD CONSTRAINT coa_subcategoria_por_tipo"));
  for (const tipo of ACCOUNT_TYPES) {
    const m = new RegExp(`account_type = '${tipo}'\\s+AND subcategoria IN \\(([^)]*)\\)`).exec(check);
    assert.ok(m, `falta el tipo ${tipo} en el CHECK`);
    const enSql = m![1].split(",").map((x) => x.trim().replace(/'/g, ""));
    assert.deepEqual(enSql, SUBCATEGORIAS_POR_TIPO[tipo], `el CHECK de ${tipo} no coincide con TS`);
  }
});

function acc(code: string, account_type: ReportAccount["account_type"], subcategoria: string, saldo: number): ReportAccount {
  return { code, name: code, account_type, subcategoria, saldo } as ReportAccount;
}

test("Balance: patrimonio en tres grupos y la depreciación resta dentro de PPE", () => {
  const bg = buildBalanceGeneral(
    [
      acc("110001", "asset", "propiedad_planta_equipo", 1000),
      acc("112001", "asset", "propiedad_planta_equipo", -300),
      acc("300001", "equity", "capital_social", -500),
      acc("300002", "equity", "resultados_acumulados", -150),
      acc("300004", "equity", "otras_reservas", -50),
    ],
    { utilidadDelEjercicio: 0 }
  );
  const ppe = bg.activos.groups.find((g) => g.label === "Propiedad, planta y equipo");
  assert.equal(ppe?.subtotal, 700, "el subtotal de PPE ya es el neto");
  assert.deepEqual(
    bg.patrimonio.groups.map((g) => g.label),
    ["Capital social", "Resultados acumulados", "Otras reservas"]
  );
  assert.ok(!bg.patrimonio.groups.some((g) => g.isUnclassified), "nada cae en sin clasificar");
});
