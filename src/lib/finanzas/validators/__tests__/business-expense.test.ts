import test from "node:test";
import assert from "node:assert/strict";

import { motivoParaNoGuardar } from "@/lib/finanzas/validators/business-expense";

// ===========================================================================
// motivoParaNoGuardar — POR QUÉ NO SE GUARDÓ, EN UNA FRASE
// ===========================================================================
//
// El 10/09/2026, en el smoke test: guardar una compra con una línea sin cuenta
// no guardaba y NO DECÍA NADA. El validador producía el error
// (`lineas.0.chart_account_code`) y el editor de líneas sabe pintarlo; lo que
// faltaba era que el formulario de compras le pasara `errors` al editor.
// Gastos de trámite sí se lo pasaba, y por eso ahí sí se veía.
//
// Esta función es la segunda mitad del arreglo: resume el rechazo al lado del
// botón, porque las líneas quedan abajo y el borde rojo puede caer fuera de la
// pantalla. Mismo patrón que `estadoDelRegistro()` del asiento (SOP-027).

test("sin errores no hay motivo", () => {
  assert.equal(motivoParaNoGuardar({}), null);
});

test("🔴 nombra la línea sin cuenta, que es el caso del smoke test", () => {
  const m = motivoParaNoGuardar({
    "lineas.0.chart_account_code": "Elija la cuenta contable de esta línea",
  });
  assert.match(m ?? "", /cuenta contable/i);
  assert.match(m ?? "", /línea 1/i, "la línea se nombra en base 1, como en pantalla");
});

test("la línea se numera como la ve la persona", () => {
  const m = motivoParaNoGuardar({
    "lineas.2.chart_account_code": "Elija la cuenta contable de esta línea",
  });
  assert.match(m ?? "", /línea 3/i);
});

test("con varias líneas rotas dice cuántas faltan además de la primera", () => {
  const m = motivoParaNoGuardar({
    "lineas.0.chart_account_code": "Elija la cuenta contable de esta línea",
    "lineas.1.chart_account_code": "Elija la cuenta contable de esta línea",
  });
  assert.match(m ?? "", /línea 1/i, "apunta a la primera");
  assert.match(m ?? "", /1 línea\(s\) más/i, "y avisa que hay otra");
});

test("los errores de LÍNEA se anuncian antes que los del encabezado", () => {
  // Los del encabezado están a la vista; los de línea quedan lejos del botón.
  const m = motivoParaNoGuardar({
    description: "La descripción es obligatoria",
    "lineas.1.amount": "El monto debe ser mayor a 0",
  });
  assert.match(m ?? "", /línea 2/i);
});

test("un error que no es de línea se muestra tal cual lo redactó el validador", () => {
  const m = motivoParaNoGuardar({ description: "La descripción es obligatoria" });
  assert.equal(m, "La descripción es obligatoria");
});

test("🔒 si hay errores, SIEMPRE hay motivo", () => {
  // La garantía que evita que vuelva el rechazo mudo: ninguna combinación de
  // errores puede devolver `null`.
  const casos: Record<string, string>[] = [
    { "lineas.0.chart_account_code": "x" },
    { "lineas.0.amount": "x" },
    { lineas: "Cargá al menos una línea" },
    { expense_date: "x" },
    { loQueSea: "x" },
  ];
  for (const c of casos) {
    const m = motivoParaNoGuardar(c);
    assert.ok(m && m.length > 0, `sin motivo para ${JSON.stringify(c)}`);
  }
});
