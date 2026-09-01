/**
 * Tests del filtro "solo cuentas con saldo" en el Estado de Resultado.
 *
 * POR QUÉ IMPORTA ACÁ MÁS QUE EN EL BALANCE
 *   El plan de Integra tiene 45 cuentas de resultado y **22 están en cero**. Sin
 *   filtro, lo que el contador abre son treinta y pico de renglones en 0.00 con
 *   los números reales perdidos en el medio — y el modelo que él mandó
 *   (`Temas Contables/image005.png`) no se parece en nada a eso. Un renglón sin
 *   saldo en un estado financiero se lee como error, y contablemente no se
 *   presenta.
 *
 * LA GARANTÍA QUE SE VERIFICA
 *   Ocultar filas NO puede mover un total. Una cuenta en 0 no aporta, así que
 *   las dos vistas tienen que dar exactamente lo mismo. Si algún día hiciera
 *   falta recalcular al filtrar, el filtro dejó de ser presentación.
 *
 * Ejecución:
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildEstadoResultadoNiif18 } from "@/lib/finanzas/reports/estado-resultado-niif18";
import {
  countZeroFilasER,
  filterFilasER,
} from "@/lib/finanzas/reports/report-visibility";
import { JOSUAR_ACCOUNTS } from "./josuar-accounts.fixture";

const er = () => buildEstadoResultadoNiif18(JOSUAR_ACCOUNTS);

test("con 'todas', el filtro devuelve exactamente lo mismo", () => {
  const filas = er().filas;
  assert.deepEqual(filterFilasER(filas, "all"), filas);
});

test("el plan de Josuar tiene cuentas en cero, y son las que se esconden", () => {
  const filas = er().filas;
  const ceros = countZeroFilasER(filas);
  assert.ok(ceros > 15, `esperaba muchas cuentas en 0, encontré ${ceros}`);

  const visibles = filterFilasER(filas, "with-balance");
  const cuentasAntes = filas.filter((f) => f.kind === "cuenta").length;
  const cuentasDespues = visibles.filter((f) => f.kind === "cuenta").length;
  assert.equal(cuentasDespues, cuentasAntes - ceros, "se esconden exactamente las que están en 0");
});

test("ninguna cuenta visible queda en cero", () => {
  const visibles = filterFilasER(er().filas, "with-balance");
  for (const f of visibles) {
    if (f.kind !== "cuenta" || f.estructural) continue;
    assert.ok(
      Math.abs(f.valor.balanza) >= 0.005,
      `${f.code} ${f.name} quedó visible con saldo ${f.valor.balanza}`
    );
  }
});

test("LA GARANTÍA: los cuatro subtotales son idénticos en las dos vistas", () => {
  const filas = er().filas;
  const resultados = (fs: typeof filas) =>
    fs
      .filter((f) => f.kind === "resultado" || f.kind === "impuesto")
      .map((f) => `${(f as { label: string }).label}=${(f as { valor: { balanza: number } }).valor.balanza}`);

  assert.deepEqual(
    resultados(filterFilasER(filas, "with-balance")),
    resultados(filterFilasER(filas, "all")),
    "filtrar no puede mover un subtotal"
  );
});

test("la estructura sobrevive al filtro: bloques, resultados e impuesto se conservan", () => {
  const filas = er().filas;
  const conteo = (fs: typeof filas, kind: string) => fs.filter((f) => f.kind === kind).length;
  const visibles = filterFilasER(filas, "with-balance");

  for (const kind of ["bloque", "resultado", "impuesto"]) {
    assert.equal(
      conteo(visibles, kind),
      conteo(filas, kind),
      `no se puede perder ninguna fila de tipo "${kind}"`
    );
  }
});

test("la distribución a socias NO se esconde aunque diera cero", () => {
  // Es `estructural`: sin ese renglón la sección queda con encabezado y nada
  // debajo, que es peor que un cero.
  const sinUtilidad = JOSUAR_ACCOUNTS.map((a) => ({ ...a, saldo: 0 }));
  const filas = buildEstadoResultadoNiif18(sinUtilidad).filas;
  const visibles = filterFilasER(filas, "with-balance");
  const dist = visibles.find((f) => f.kind === "cuenta" && f.estructural);
  assert.ok(dist, "la distribución a socias tiene que seguir visible");
});

test("un grupo sin ninguna cuenta con saldo desaparece entero, con su subtotal", () => {
  // Se fuerza el caso: todos los costos en cero, el resto intacto.
  const cuentas = JOSUAR_ACCOUNTS.map((a) =>
    a.account_type === "cost" ? { ...a, saldo: 0 } : a
  );
  const visibles = filterFilasER(buildEstadoResultadoNiif18(cuentas).filas, "with-balance");

  const grupos = visibles.filter((f) => f.kind === "grupo").map((f) => (f as { label: string }).label);
  assert.ok(
    !grupos.some((l) => l.toLowerCase().includes("costos")),
    `el grupo de costos debía desaparecer, quedó: ${grupos.join(" | ")}`
  );
  const subtotales = visibles
    .filter((f) => f.kind === "subtotal")
    .map((f) => (f as { label: string }).label);
  assert.ok(
    !subtotales.some((l) => l.toLowerCase().includes("costos")),
    "su subtotal se va con él"
  );

  // Pero la Utilidad Bruta operativa SIGUE, porque es estructura del estado.
  const resultados = visibles
    .filter((f) => f.kind === "resultado")
    .map((f) => (f as { label: string }).label);
  assert.ok(resultados.some((l) => l.includes("Utilidad Bruta operativa")));
});
