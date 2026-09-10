import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CUENTA_TRAMITE_DEFAULT } from "@/lib/finanzas/types/expense-line";

/**
 * LA CUENTA PRECARGADA DE CADA MÓDULO, FIJADA EN UN TEST.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUÉ PASÓ
 * ═════════════════════════════════════════════════════════════════════════════
 * `ExpenseLinesEditor` es el mismo editor para gastos de trámite y para compras
 * del bufete, y tenía `cuentaPorDefecto = CUENTA_TRAMITE_DEFAULT` como default
 * del componente. Compras no lo pasaba, así que **cada línea agregada nacía en
 * `130003 · Fondo Legales de Clientes`** — la cuenta de lo que las licenciadas
 * adelantan POR UN CLIENTE, no la de una compra del bufete.
 *
 * Se guardaba mal, con la apariencia de un dato elegido a mano, y sin error.
 * Se vio el 10/09/2026 abriendo la pantalla desplegada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE LEE EL CÓDIGO Y NO SE MONTA EL COMPONENTE
 * ─────────────────────────────────────────────────────────────────────────────
 * El proyecto no tiene jsdom ni testing-library: la suite es `node:test` sobre
 * módulos. Lo que hay que proteger es una decisión que vive en el JSX —qué
 * cuenta precarga cada módulo—, así que se lee el archivo. Es el mismo recurso
 * que `ruc-dv-separados.test.ts`, y por el mismo motivo: un tipo de TypeScript
 * no puede sostener la regla.
 */

const COMPRAS = "src/app/finanzas/gastos-bufete/_components/business-expense-form.tsx";
const TRAMITE = "src/components/cases/section-expense-form.tsx";
const EDITOR = "src/components/finanzas/expense-lines-editor.tsx";

const leer = (p: string) => readFileSync(p, "utf8");

test("🔴 compras precarga la cuenta VACÍA: no hay cuenta plausible para una compra", () => {
  const src = leer(COMPRAS);
  assert.match(
    src,
    /cuentaPorDefecto=""/,
    'business-expense-form debe pasar `cuentaPorDefecto=""` al editor de líneas'
  );
  assert.doesNotMatch(
    src,
    /cuentaPorDefecto=\{CUENTA_TRAMITE_DEFAULT\}/,
    "compras NO precarga la cuenta de gastos de trámite"
  );
});

test("gastos de trámite conserva 130003, que ahí SÍ es lo correcto", () => {
  // Decisión del acta del 25/08/2026: "Gasto de trámite al incurrirlo:
  // DEBE 130003, HABER Cuentas por Pagar".
  assert.match(leer(TRAMITE), /cuentaPorDefecto=\{CUENTA_TRAMITE_DEFAULT\}/);
  assert.equal(CUENTA_TRAMITE_DEFAULT, "130003");
});

test("🔒 el editor NO tiene default propio: cada módulo declara el suyo", () => {
  // Es lo que impide que el próximo módulo herede el default de otro por
  // descuido, que es exactamente como entró este bug.
  const src = leer(EDITOR);
  assert.doesNotMatch(
    src,
    /cuentaPorDefecto\s*=\s*CUENTA_TRAMITE_DEFAULT/,
    "`cuentaPorDefecto` no debe tener valor por defecto en el editor"
  );
  assert.match(
    src,
    /cuentaPorDefecto:\s*string;/,
    "`cuentaPorDefecto` debe ser una prop obligatoria"
  );
});

test("los dos módulos que usan el editor le pasan la cuenta por defecto", () => {
  // Si aparece un tercer llamador, este test lo obliga a decidir.
  for (const archivo of [COMPRAS, TRAMITE]) {
    const src = leer(archivo);
    assert.ok(src.includes("<ExpenseLinesEditor"), `${archivo} usa el editor`);
    assert.match(src, /cuentaPorDefecto=/, `${archivo} declara su cuenta por defecto`);
  }
});

test("🔒 los totales se dibujan UNA sola vez en compras", () => {
  // Había dos bloques con los mismos tres números y nombres distintos: el del
  // editor (Base / ITBMS / Total) y el del formulario (Subtotal / ITBMS /
  // Total a pagar).
  assert.match(
    leer(COMPRAS),
    /mostrarTotales=\{false\}/,
    "compras apaga los totales del editor y deja los suyos"
  );
  assert.doesNotMatch(
    leer(TRAMITE),
    /mostrarTotales=\{false\}/,
    "gastos de trámite los necesita: es su único lugar"
  );
});
