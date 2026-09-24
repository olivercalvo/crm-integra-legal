/**
 * EL CUFE QUE SE CARGA A MANO (caso B del Bloque 9C).
 *
 *   npm test
 *
 * El criterio es el del RUC: se valida la FORMA MÍNIMA, no un patrón cerrado.
 * Las facturas que hay que cargar son de otro punto de facturación y de otro
 * año, así que un patrón calcado sobre los CUFE que ya tenemos rechazaría
 * exactamente los que hacen falta.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validarCufe, CUFE_LARGO_TIPICO } from "../cufe";

/** Uno real de staging, medido el 24/09/2026: 66 caracteres. */
const REAL = "FE0920000025046169-3-2021-4000002026092400000000240010129902781442";

test("el CUFE real de staging pasa", () => {
  const r = validarCufe(REAL);
  assert.equal(r.ok, true, r.mensaje ?? "");
  assert.equal(r.valor, REAL);
  assert.deepEqual(r.avisos, [], "un CUFE del largo típico no necesita avisos");
  assert.equal(REAL.length, CUFE_LARGO_TIPICO);
});

/**
 * 🔴 EL CASO QUE MOTIVA TODO ESTO.
 *
 * El portal muestra el CUFE partido en varias líneas. Al copiarlo vienen
 * saltos de línea ADENTRO del valor. Rechazarlo por eso sería castigar a la
 * persona por algo que el CRM puede arreglar solo — y es lo que va a pasar la
 * primera vez que alguien cargue una factura de junio.
 */
test("🔴 los saltos de línea y espacios del copiar-pegar se limpian, no se rechazan", () => {
  const pegado = "FE0920000025046169-3-2021-40000\n0202609240000000024001\r\n0129902781442  ";
  const r = validarCufe(pegado);
  assert.equal(r.ok, true, r.mensaje ?? "");
  assert.equal(r.valor, REAL);
});

test("se normaliza a mayúsculas", () => {
  const r = validarCufe(REAL.toLowerCase());
  assert.equal(r.ok, true);
  assert.equal(r.valor, REAL);
});

test("vacío: lo dice sin ruido", () => {
  for (const v of ["", "   ", null, undefined]) {
    const r = validarCufe(v);
    assert.equal(r.ok, false);
    assert.equal(r.problema, "vacio");
  }
});

test("un pegado cortado se detecta por el largo", () => {
  const r = validarCufe(REAL.slice(0, 20));
  assert.equal(r.ok, false);
  assert.equal(r.problema, "muy_corto");
  // El mensaje tiene que nombrar la causa probable, no sólo el síntoma.
  assert.match(r.mensaje ?? "", /protocolo/);
});

test("el número de protocolo en vez del CUFE se detecta por el prefijo", () => {
  // Mismo alfabeto y largo plausible, pero no empieza con FE.
  const r = validarCufe("01202609240000000024001012990278144200000255-3-2021-40");
  assert.equal(r.ok, false);
  assert.equal(r.problema, "sin_prefijo_fe");
});

test("caracteres que no son del alfabeto: se rechaza y se explica", () => {
  const r = validarCufe(REAL.replace("FE09", "FE09_"));
  assert.equal(r.ok, false);
  assert.equal(r.problema, "caracteres_invalidos");
});

/**
 * 🔴 LA REGLA QUE NO SE PUEDE ROMPER: NO SE IMPONE EL PATRÓN OBSERVADO.
 *
 * Este test es el equivalente del de los RUC panameños. Un CUFE del punto
 * `050`, de 2026 o de otro tipo de documento, tiene otros dígitos en el medio
 * y puede tener otro largo. Todos estos son plausibles y NINGUNO puede rebotar.
 */
test("🔴 un CUFE de otro punto, otro año u otro tipo NO se rechaza", () => {
  const plausibles = [
    // Otro punto de facturación (050 en vez de 001).
    "FE0120000025046169-3-2021-4000002026060100000000240050129902781442",
    // Otro tipo de documento (04, la nota de crédito).
    "FE0420000025046169-3-2021-4000002026092400000000240010129902781442",
    // Más corto, por si el largo varía con algo que todavía no vimos.
    "FE01200000250461693202140000020260601000000002400501299027",
    // Más largo, por lo mismo.
    "FE0120000025046169-3-2021-40000020260601000000002400501299027814420099",
  ];
  for (const c of plausibles) {
    const r = validarCufe(c);
    assert.equal(r.ok, true, `rechazó un CUFE plausible (${c.length} caracteres): ${r.mensaje}`);
  }
});

test("un largo distinto del típico AVISA, no bloquea", () => {
  const r = validarCufe("FE01200000250461693202140000020260601000000002400501299027");
  assert.equal(r.ok, true);
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /otro punto de facturación/);
});
