/**
 * Tests de la decisión de CONTRAPARTIDA (Fase 2).
 *
 * Estos tests existen sobre todo para que, cuando Josuar responda la consulta 3
 * (qué poner cuando el asiento tiene más de dos líneas), quede claro de un
 * vistazo QUÉ casos cambian y cuáles no. Los de dos líneas y los de "varias
 * líneas pero una sola cuenta del otro lado" NO deberían cambiar con ninguna de
 * las tres respuestas posibles: son casos sin ambigüedad.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/contabilidad/__tests__/contrapartida.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  contrapartidaDe,
  contrapartidaEsAmbigua,
  lineasOpuestas,
  ETIQUETA_VARIOS,
  ETIQUETA_SIN_CONTRAPARTIDA,
  type LineaParaContrapartida,
} from "@/lib/finanzas/contabilidad/contrapartida";

function deb(code: string, name: string, monto: number): LineaParaContrapartida {
  return { code, name, debit: monto, credit: 0 };
}
function cre(code: string, name: string, monto: number): LineaParaContrapartida {
  return { code, name, debit: 0, credit: monto };
}

// ---------------------------------------------------------------------------
// Casos SIN ambigüedad — no deberían cambiar con la respuesta de Josuar
// ---------------------------------------------------------------------------

test("asiento simple: la contrapartida es la cuenta del otro lado", () => {
  const banco = deb("100001", "Banco General Operativa", 1000);
  const ingreso = cre("400001", "Derecho Corporativo", 1000);
  const asiento = [banco, ingreso];

  assert.equal(contrapartidaDe(banco, asiento), "Derecho Corporativo");
  assert.equal(contrapartidaDe(ingreso, asiento), "Banco General Operativa");
  assert.equal(contrapartidaEsAmbigua(banco, asiento), false);
});

test("varias líneas pero UNA sola cuenta del otro lado: sigue sin ser ambiguo", () => {
  // Caso frecuente: varias facturas contra la misma cuenta por pagar.
  const f1 = deb("610001", "Alquiler", 100);
  const f2 = deb("610002", "Honorarios Profesionales", 200);
  const pago = cre("200001", "Cuentas por pagar", 300);
  const asiento = [f1, f2, pago];

  assert.equal(contrapartidaDe(f1, asiento), "Cuentas por pagar");
  assert.equal(contrapartidaDe(f2, asiento), "Cuentas por pagar");
  assert.equal(contrapartidaEsAmbigua(f1, asiento), false, "no es ambiguo: una sola cuenta");

  // Y desde el lado del pago SÍ es ambiguo: tiene dos gastos enfrente.
  assert.equal(contrapartidaEsAmbigua(pago, asiento), true);
});

test("la misma cuenta dos veces del mismo lado no se toma como contrapartida de sí misma", () => {
  // Se excluye la propia línea por IDENTIDAD, no por código: si se filtrara por
  // código, la segunda línea de la misma cuenta desaparecería del cálculo.
  const a1 = deb("610001", "Alquiler", 100);
  const a2 = deb("610001", "Alquiler", 50);
  const banco = cre("100001", "Banco General Operativa", 150);
  const asiento = [a1, a2, banco];

  assert.equal(contrapartidaDe(a1, asiento), "Banco General Operativa");
  assert.equal(contrapartidaDe(a2, asiento), "Banco General Operativa");
  assert.equal(lineasOpuestas(banco, asiento).length, 2, "el banco tiene 2 líneas enfrente");
});

// ---------------------------------------------------------------------------
// El caso AMBIGUO — es el que cambia cuando Josuar responda
// ---------------------------------------------------------------------------

test("más de una cuenta del otro lado: hoy 'Varios' (PENDIENTE consulta 3)", () => {
  const banco = cre("100001", "Banco General Operativa", 300);
  const g1 = deb("610001", "Alquiler", 100);
  const g2 = deb("610009", "Combustible", 200);
  const asiento = [banco, g1, g2];

  assert.equal(contrapartidaDe(banco, asiento), ETIQUETA_VARIOS);
  assert.equal(contrapartidaEsAmbigua(banco, asiento), true);

  // Desde cada gasto NO es ambiguo: solo tienen al banco enfrente.
  assert.equal(contrapartidaDe(g1, asiento), "Banco General Operativa");
  assert.equal(contrapartidaDe(g2, asiento), "Banco General Operativa");
});

test("la ambigüedad se consulta con una función, no comparando contra la etiqueta", () => {
  // Si la UI comparara `texto === "Varios"`, cambiar la etiqueta con la
  // respuesta de Josuar rompería la UI en silencio. Por eso existe
  // contrapartidaEsAmbigua().
  const banco = cre("100001", "Banco", 300);
  const asiento = [banco, deb("610001", "Alquiler", 100), deb("610009", "Combustible", 200)];

  assert.equal(contrapartidaEsAmbigua(banco, asiento), true);
  assert.notEqual(
    contrapartidaEsAmbigua(banco, asiento),
    contrapartidaDe(banco, asiento) === "otra etiqueta cualquiera",
    "la ambigüedad no se deduce del texto"
  );
});

// ---------------------------------------------------------------------------
// Bordes
// ---------------------------------------------------------------------------

test("sin líneas del lado opuesto: se marca, no se inventa", () => {
  // Un asiento así no debería existir (el motor exige partida doble), pero el
  // módulo de presentación no debe romperse ni mentir si llega uno.
  const a = deb("610001", "Alquiler", 100);
  const b = deb("610009", "Combustible", 100);
  assert.equal(contrapartidaDe(a, [a, b]), ETIQUETA_SIN_CONTRAPARTIDA);
  assert.equal(contrapartidaEsAmbigua(a, [a, b]), false);
});

test("una línea sola: sin contrapartida", () => {
  const a = deb("610001", "Alquiler", 100);
  assert.equal(contrapartidaDe(a, [a]), ETIQUETA_SIN_CONTRAPARTIDA);
});
