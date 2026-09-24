/**
 * 🔒 LA FORMA DE `documentosFiscalesReferenciados`, DECIDIDA POR LA DGI.
 *
 * Ejecución:  npm test
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE ARCHIVO EXISTE ANTES QUE EL CÓDIGO QUE CONGELA
 * ─────────────────────────────────────────────────────────────────────────────
 * El swagger decía que el bloque está **doblemente anidado** y las notas del
 * repo lo tenían **plano**. Las dos no pueden ser ciertas, y el swagger de
 * ideati ya había demostrado que no alcanza para decidir: no tiene un solo
 * `required`, ni un `enum`, ni descripciones.
 *
 * Así que no se decidió leyendo. El 24/09/2026 se mandó **la misma nota de
 * crédito con las dos formas** al sandbox (`i_amb = 2`):
 *
 *   FORMA A — anidada, la del swagger → ✅ `0260 Autorizado el uso de la FE`
 *   FORMA B — plana, la de las notas  → ❌ `0100 The element 'gDFRefNum' …
 *                                          has incomplete content. List of
 *                                          possible elements expected:
 *                                          'gDFRefFE, gDFRefFacPap, gDFRefFacIE'`
 *
 * El propio rechazo nombra los tres hermanos que el wrapper espera. O sea que
 * el anidado no es una rareza del swagger: **es lo que el XSD de la DGI pide.**
 *
 * Este golden se escribe **antes** de que el mapper arme el bloque, que es la
 * regla de 9A: el refactor y el JSON dorado nunca van en el mismo commit, y
 * para escribir el golden hay que saber primero cuál es la forma correcta.
 * Cuando exista `construirReferenciaFiscal()`, su salida se compara contra
 * `referencia-fiscal-esperada.json` y nada más cambia acá.
 *
 * Evidencia completa: `docs/efactura/prueba9c-referencia.txt`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const leer = (n: string) =>
  JSON.parse(readFileSync(path.resolve(__dirname, n), "utf8")) as Record<string, unknown>;

const AUTORIZADA = leer("referencia-fiscal-esperada.json");
const RECHAZADA = leer("referencia-fiscal-rechazada.json");

type Bloque = {
  rucEmisorDocumentoReferenciado: { tipoRuc: number; ruc: string; digitoVerificador: string };
  nombreRazonSocialEmisor: string;
  fechaEmisionDocumentoReferenciado: string;
  informacionReferencia: Record<string, unknown>;
};

const bloqueOk = (AUTORIZADA.documentosFiscalesReferenciados as Bloque[])[0];
const bloqueMal = (RECHAZADA.documentosFiscalesReferenciados as Bloque[])[0];

test("🔒 el bloque que AUTORIZÓ tiene `informacionReferencia` DOS veces, una dentro de otra", () => {
  const externo = bloqueOk.informacionReferencia;
  assert.ok(externo, "falta el wrapper");
  assert.ok(
    "informacionReferencia" in externo,
    "el wrapper `gDFRefNumRequest` tiene que contener otro `informacionReferencia`. " +
      "Si esto se aplana, la DGI responde 0100 y la nota de crédito no sale."
  );
  const interno = externo.informacionReferencia as Record<string, unknown>;
  assert.ok(
    typeof interno.cufeReferenciado === "string" && interno.cufeReferenciado.length > 0,
    "el CUFE va en el nivel de adentro"
  );
});

test("🔴 el bloque PLANO es el que la DGI rechazó — no se vuelve a esa forma", () => {
  // Está guardado a propósito: un contra-ejemplo con su código de rechazo vale
  // más que un comentario que diga "no lo hagas plano".
  assert.equal(RECHAZADA._codigo, "0100");
  assert.match(String(RECHAZADA._mensaje), /gDFRefNum.*incomplete content/);
  assert.ok(
    !("informacionReferencia" in (bloqueMal.informacionReferencia as object)),
    "el contra-ejemplo tiene que seguir siendo el plano"
  );
});

test("🔴 el mensaje del rechazo nombra los TRES hermanos del wrapper", () => {
  // `gDFRefFE` (electrónico), `gDFRefFacPap` (papel) y `gDFRefFacIE` (impresora
  // fiscal). Es la lista de formas de referenciar un documento, y la que 9C
  // necesita para el caso de las facturas en papel.
  for (const hermano of ["gDFRefFE", "gDFRefFacPap", "gDFRefFacIE"]) {
    assert.match(String(RECHAZADA._mensaje), new RegExp(hermano), `falta ${hermano}`);
  }
});

test("🔴 la fecha del documento referenciado lleva ZONA HORARIA", () => {
  // El primer intento mandó `2026-09-24T00:00:00` pelado y la DGI lo rechazó
  // con `0100`: "dFechaDFRef ... is invalid according to its datatype fechaTZ".
  // Es el mismo formato que `fechaEmision`, y `toPanamaIso` ya lo produce.
  assert.match(
    bloqueOk.fechaEmisionDocumentoReferenciado,
    /T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    "sin offset, la DGI rechaza con 0100 (datatype fechaTZ)"
  );
  assert.ok(
    bloqueOk.fechaEmisionDocumentoReferenciado.endsWith("-05:00"),
    "Panamá es UTC-5 todo el año"
  );
});

test("el RUC del emisor referenciado va en tres campos separados", () => {
  const r = bloqueOk.rucEmisorDocumentoReferenciado;
  assert.equal(typeof r.tipoRuc, "number", "tipoRuc es numérico (1 natural / 2 jurídica)");
  assert.ok(r.ruc.length > 0);
  assert.ok(/^\d{1,2}$/.test(r.digitoVerificador), "el DV son uno o dos dígitos");
  // Misma regla que en proveedores: el RUC y el DV NUNCA se concatenan.
  assert.ok(!r.ruc.includes(r.digitoVerificador + "$"), "no se pegan");
});

/**
 * ⚠️ ESTO AUTORIZÓ CON LA RAZÓN SOCIAL EQUIVOCADA, y hay que saberlo.
 *
 * En la prueba se mandó el nombre del CLIENTE donde va el del EMISOR del
 * documento referenciado — que somos nosotros, porque la nota de crédito
 * referencia una factura nuestra. La DGI lo autorizó igual: **no cruza ese
 * campo contra el RUC**.
 *
 * O sea que un error ahí no lo va a atrapar el PAC. Lo tiene que atrapar el
 * código, y por eso queda escrito acá.
 */
test("⚠️ la DGI NO valida `nombreRazonSocialEmisor` contra el RUC", () => {
  assert.equal(
    bloqueOk.nombreRazonSocialEmisor,
    "CONSTRUCTORA CHIRIQUÍ ANTIGUO, S.A.",
    "el fixture conserva el valor equivocado con el que autorizó: es la evidencia"
  );
  assert.notEqual(
    bloqueOk.nombreRazonSocialEmisor,
    bloqueOk.rucEmisorDocumentoReferenciado.ruc,
    "y no coincide con el emisor, que es el bufete"
  );
  // Cuando el mapper lo construya, tiene que poner la razón social del EMISOR
  // (`EFACTURA_EMISOR_RAZON_SOCIAL`), no la del cliente.
});

// ═══════════════════════════════════════════════════════════════════════════
// Y AHORA, LA FUNCIÓN CONTRA EL GOLDEN (Bloque 9C)
// ═══════════════════════════════════════════════════════════════════════════
// El golden se congeló en `3f190a9`, ANTES de que existiera
// `construirReferenciaFiscal`. Esto es la otra mitad: la comparación. Van en
// commits distintos a propósito (SOP-039) — si el mismo commit hubiera traído
// la referencia y el código que la produce, el test habría pasado
// comparándose consigo mismo.

import { construirReferenciaFiscal } from "../mapper/map-referencia-fiscal";

/**
 * El emisor de la prueba. Los tres primeros campos son los que realmente
 * viajaron al sandbox; `nombreORazonSocial` es el CORRECTO, que es justamente
 * el que la prueba NO mandó (ver el test de abajo).
 */
const EMISOR = {
  tipoContribuyente: 2 as const,
  ruc: "25046169-3-2021",
  digitoVerificador: "40",
  nombreORazonSocial: "INTEGRA LEGAL, S.A.",
};

const CUFE = "FE0920000025046169-3-2021-4000002026092400000000240010129902781442";

test("🔒 `construirReferenciaFiscal` produce EXACTAMENTE el bloque que autorizó", () => {
  const [bloque] = construirReferenciaFiscal(
    { cufe: CUFE, fechaEmision: "2026-09-24" },
    EMISOR
  );

  // Todo menos la razón social, que el golden guarda equivocada a propósito.
  const sinElNombre = <T extends { nombreRazonSocialEmisor: string }>(b: T) => {
    const copia: Partial<T> = { ...b };
    delete copia.nombreRazonSocialEmisor;
    return copia;
  };
  const restoEsperado = sinElNombre(bloqueOk);
  const restoNuestro = sinElNombre(bloque);
  assert.deepEqual(
    restoNuestro,
    restoEsperado,
    "el bloque dejó de ser idéntico al que la DGI autorizó el 24/09/2026"
  );
});

test("🔴 y corrige lo único que la prueba mandó mal: la razón social es la del EMISOR", () => {
  const [bloque] = construirReferenciaFiscal(
    { cufe: CUFE, fechaEmision: "2026-09-24" },
    EMISOR
  );
  assert.equal(bloque.nombreRazonSocialEmisor, EMISOR.nombreORazonSocial);
  assert.notEqual(
    bloque.nombreRazonSocialEmisor,
    bloqueOk.nombreRazonSocialEmisor,
    "el golden tiene el nombre del CLIENTE ahí, y la función NO debe reproducirlo: " +
      "la DGI no valida ese campo, así que el único control es este"
  );
});

test("🔴 el anidado sobrevive al round-trip por JSON", () => {
  // Un `informacionReferencia` de más o de menos no se ve leyendo el objeto:
  // se ve en el cuerpo que sale por la red.
  const json = JSON.parse(
    JSON.stringify(construirReferenciaFiscal({ cufe: CUFE, fechaEmision: "2026-09-24" }, EMISOR))
  ) as Bloque[];
  assert.equal(
    (json[0].informacionReferencia as { informacionReferencia?: unknown }).informacionReferencia !==
      undefined,
    true,
    "el wrapper se aplanó en la serialización"
  );
});

test("sin CUFE no arma nada: lanza y dice qué hacer", () => {
  assert.throws(
    () => construirReferenciaFiscal({ cufe: "   ", fechaEmision: "2026-09-24" }, EMISOR),
    /cargar su CUFE/,
    "tiene que explicar el caso B, no fallar con un genérico"
  );
});

test("la fecha del documento referenciado sale con el huso de Panamá", () => {
  const [bloque] = construirReferenciaFiscal(
    { cufe: CUFE, fechaEmision: "2026-07-01" },
    EMISOR
  );
  assert.equal(bloque.fechaEmisionDocumentoReferenciado, "2026-07-01T00:00:00-05:00");
});
