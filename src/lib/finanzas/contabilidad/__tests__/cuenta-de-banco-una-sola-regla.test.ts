/**
 * 🔒 «Qué es un banco» se escribe dos veces: en TypeScript
 * (`PATRON_CUENTA_DE_BANCO`, que arma el selector del banco de un cobro o un
 * pago y saca los bancos de las líneas de compra) y en SQL
 * (`finanzas_es_cuenta_de_banco`, `082`, que rechaza un banco en una línea de
 * NC de compra). Si una cambia y la otra no, la pantalla ofrece una cuenta que la
 * base rechaza, o al revés. Este test lee los dos y exige el mismo patrón.
 *
 * Ejecución:  npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PATRON_CUENTA_DE_BANCO,
  esCuentaDeBancoPorNombre,
} from "@/lib/finanzas/contabilidad/asiento-tesoreria";

const SQL = "sql/pending/082_otros_servicios_y_nc_sin_bancos.sql";

test("🔒 el patrón de banco es el mismo en TypeScript y en la 082", () => {
  const sql = readFileSync(SQL, "utf8");
  const m = sql.match(/~\*\s*'\(([^)]+)\)'/);
  assert.ok(m, "la 082 define finanzas_es_cuenta_de_banco con ~* '(…)'");
  assert.equal(m![1], PATRON_CUENTA_DE_BANCO.source);
  assert.ok(PATRON_CUENTA_DE_BANCO.flags.includes("i"), "sin mayúsculas, como ~*");
  assert.match(sql, /p_account_type = 'asset'/, "sólo activos, como esCuentaDeBancoPorNombre");
});

test("banco: activo que lo dice en el nombre; «Gastos Bancarios» no es un banco", () => {
  assert.equal(esCuentaDeBancoPorNombre({ account_type: "asset", name: "Banco General Operativa" }), true);
  assert.equal(esCuentaDeBancoPorNombre({ account_type: "asset", name: "Caja menuda" }), true);
  assert.equal(esCuentaDeBancoPorNombre({ account_type: "expense", name: "Gastos Bancarios" }), false);
  assert.equal(esCuentaDeBancoPorNombre({ account_type: "asset", name: "Mobiliario y equipo" }), false);
});
