/**
 * Lo que la DGI rechaza, verificado antes de mandarlo.
 *
 * Ejecución:  npm test
 *
 * Los dos casos que estos tests existen para prevenir son reales y ya pasaron:
 *
 *   · una descripción de línea de **545 caracteres** (DGI `10105`, el tope son
 *     500), que el CRM aceptó sin decir nada;
 *   · un RUC/DV que la DGI rechazó (`1601`/`1602`) sobre un cliente que después
 *     se corrigió y cuya factura nunca se reenvió.
 *
 * Los dos tienen la misma forma: el error existía antes de enviar y nadie lo
 * miró.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DESCRIPCION_LINEA_MAX,
  DESCRIPCION_LINEA_MIN,
  validarDescripcionDeLinea,
  contadorDeDescripcion,
  validarRucDeReceptor,
  validarDvDeReceptor,
  receptorNecesitaRuc,
  problemasDelReceptor,
  motivoParaNoEmitir,
} from "@/lib/finanzas/validators/controles-dgi";

// ---------------------------------------------------------------------------
// DESCRIPCIÓN — DGI 10105
// ---------------------------------------------------------------------------

test("el tope es 500, que es el de la DGI", () => {
  assert.equal(DESCRIPCION_LINEA_MAX, 500);
  assert.equal(DESCRIPCION_LINEA_MIN, 2);
});

test("🔴 el caso real: 545 caracteres REBOTAN, y el mensaje dice cuántos sobran", () => {
  const r = validarDescripcionDeLinea("a".repeat(545));
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.match(r.mensaje, /545/, "dice cuántos tiene");
  assert.match(r.mensaje, /500/, "dice cuántos acepta la DGI");
  assert.match(r.mensaje, /Sobran 45/, "y cuántos sacar, que es lo accionable");
});

test("el borde: 500 justos entran, 501 no", () => {
  assert.ok(validarDescripcionDeLinea("a".repeat(500)).ok);
  assert.ok(!validarDescripcionDeLinea("a".repeat(501)).ok);
});

test("con uno solo sobrando, el mensaje va en singular", () => {
  const r = validarDescripcionDeLinea("a".repeat(501));
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.match(r.mensaje, /Sobra 1 carácter/);
});

test("una descripción vacía o de un carácter no pasa", () => {
  assert.ok(!validarDescripcionDeLinea("").ok);
  assert.ok(!validarDescripcionDeLinea("   ").ok);
  assert.ok(!validarDescripcionDeLinea("x").ok);
  assert.ok(validarDescripcionDeLinea("ok").ok);
});

test("🔴 se mide TRIMEADO, que es como se guarda", () => {
  // 500 caracteres con espacios alrededor entran: los espacios no se guardan.
  assert.ok(validarDescripcionDeLinea("  " + "a".repeat(500) + "  ").ok);
});

test("🔒 el contador y el validador cuentan IGUAL", () => {
  // Si contaran distinto, el campo diría 501 y el error 499 — y la persona
  // borraría caracteres sin entender por qué no alcanza.
  for (const texto of ["", "  hola  ", "a".repeat(499), "a".repeat(500), "a".repeat(545)]) {
    const c = contadorDeDescripcion(texto);
    const v = validarDescripcionDeLinea(texto);
    if (c.excedido) {
      assert.ok(!v.ok, `"${c.texto}" excedido pero el validador lo aceptó`);
      if (!v.ok) assert.match(v.mensaje, new RegExp(String(c.usados)));
    }
  }
});

test("el contador arma el texto del campo", () => {
  assert.equal(contadorDeDescripcion("a".repeat(312)).texto, "312/500");
  assert.equal(contadorDeDescripcion("").texto, "0/500");
  assert.equal(contadorDeDescripcion("a".repeat(545)).excedido, true);
  assert.equal(contadorDeDescripcion("a".repeat(500)).excedido, false);
});

// ---------------------------------------------------------------------------
// RUC Y DV — DGI 1601 / 1602
// ---------------------------------------------------------------------------

test("sólo los receptores 01 y 03 necesitan RUC", () => {
  assert.equal(receptorNecesitaRuc("01"), true, "contribuyente");
  assert.equal(receptorNecesitaRuc("03"), true, "gobierno");
  assert.equal(receptorNecesitaRuc("02"), false, "consumidor final");
  assert.equal(receptorNecesitaRuc("04"), false, "extranjero: lleva id_extranjero");
  assert.equal(receptorNecesitaRuc(null), false);
});

test("🔴 los formatos de RUC panameños que conviven, todos pasan", () => {
  // Un validador estricto los rechazaría y dejaría a alguien sin poder
  // facturar — un daño peor que un rechazo de la DGI, porque no tiene mensaje.
  for (const ruc of [
    "8-123-456", // cédula
    "PE-123-456", // prefijo
    "E-8-98765",
    "N-20-1234",
    "155123456-2-2015", // jurídico
    "1499876-1-690042", // el de staging
    "8-NT-2-12345",
  ]) {
    assert.ok(validarRucDeReceptor(ruc).ok, `${ruc} debería pasar`);
  }
});

test("lo que no puede ser un RUC, rebota con un mensaje que dice por qué", () => {
  assert.match(String((validarRucDeReceptor("") as { mensaje: string }).mensaje), /Falta el RUC/);
  assert.match(String((validarRucDeReceptor("abc") as { mensaje: string }).mensaje), /corto/);
  assert.match(
    String((validarRucDeReceptor("abcdef") as { mensaje: string }).mensaje),
    /número/,
    "largo suficiente pero sin un solo dígito: no es un RUC"
  );
  assert.match(String((validarRucDeReceptor("8-1@3") as { mensaje: string }).mensaje), /caracteres/);
  assert.ok(!validarRucDeReceptor("1".repeat(41)).ok, "41 caracteres: algo se pegó");
});

test("🔴 el DV es obligatorio y son uno o dos dígitos", () => {
  assert.ok(validarDvDeReceptor("0").ok);
  assert.ok(validarDvDeReceptor("00").ok);
  assert.ok(validarDvDeReceptor("42").ok);
  assert.ok(!validarDvDeReceptor("").ok, "faltante: es el rechazo 1601");
  assert.ok(!validarDvDeReceptor("123").ok);
  assert.ok(!validarDvDeReceptor("4a").ok);
  assert.ok(!validarDvDeReceptor("-1").ok);
});

test("el mensaje del DV faltante explica qué es, no sólo que falta", () => {
  const r = validarDvDeReceptor("");
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.match(r.mensaje, /despu[eé]s del RUC/, "dice dónde encontrarlo");
});

// ---------------------------------------------------------------------------
// EL RECEPTOR COMPLETO
// ---------------------------------------------------------------------------

const RECEPTOR_OK = {
  tipo_receptor_fe: "01",
  tax_id: "1499876-1-690042",
  digito_verificador: "00",
  client_type: "persona_juridica",
};

test("un receptor completo no tiene problemas", () => {
  assert.deepEqual(problemasDelReceptor(RECEPTOR_OK), []);
});

test("🔴 devuelve TODOS los problemas, no el primero", () => {
  // Si devolviera uno, la persona lo arregla, vuelve a guardar, y le falla por
  // el siguiente. El formulario la estaría haciendo adivinar.
  const p = problemasDelReceptor({
    tipo_receptor_fe: "01",
    tax_id: null,
    digito_verificador: null,
    client_type: null,
  });
  assert.equal(p.length, 3, `problemas: ${p.map((x) => x.campo).join(", ")}`);
  assert.deepEqual(
    p.map((x) => x.campo),
    ["tax_id", "digito_verificador", "client_type"]
  );
});

test("cada problema nombra el CAMPO que hay que tocar", () => {
  const p = problemasDelReceptor({ ...RECEPTOR_OK, digito_verificador: "" });
  assert.equal(p.length, 1);
  assert.equal(p[0].campo, "digito_verificador");
  assert.equal(p[0].etiqueta, "Dígito verificador (DV)");
});

test("un consumidor final sin RUC no es un problema", () => {
  assert.deepEqual(
    problemasDelReceptor({ tipo_receptor_fe: "02", tax_id: null, digito_verificador: null }),
    []
  );
});

test("un extranjero tampoco: lo identifican otros campos", () => {
  assert.deepEqual(
    problemasDelReceptor({ tipo_receptor_fe: "04", tax_id: null, digito_verificador: null }),
    []
  );
});

test("🔒 se verifica el RUC que REALMENTE viaja (`tax_id ?? ruc`)", () => {
  // `map-receptor.ts` lee `tax_id ?? ruc`. Verificar sólo `ruc` fue lo que ya
  // costó un intento de emisión perdido.
  const soloRucLegacy = problemasDelReceptor({
    tipo_receptor_fe: "01",
    tax_id: null,
    ruc: "8-123-456",
    digito_verificador: "12",
    client_type: "persona_natural",
  });
  assert.deepEqual(soloRucLegacy, [], "si `ruc` tiene el dato y `tax_id` no, igual viaja");

  const taxIdManda = problemasDelReceptor({
    tipo_receptor_fe: "01",
    tax_id: "@@@",
    ruc: "8-123-456",
    digito_verificador: "12",
    client_type: "persona_natural",
  });
  assert.equal(taxIdManda.length, 1, "un `tax_id` inválido no lo tapa un `ruc` bueno");
});

test("el motivo junta todo en un párrafo con el campo nombrado", () => {
  const p = problemasDelReceptor({ tipo_receptor_fe: "01" });
  const m = motivoParaNoEmitir(p);
  assert.ok(m);
  assert.match(String(m), /RUC/);
  assert.match(String(m), /D[ií]gito verificador/);
  assert.equal(motivoParaNoEmitir([]), null, "sin problemas, no hay mensaje");
});
