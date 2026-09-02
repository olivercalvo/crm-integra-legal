/**
 * PAYLOAD CONGELADO DEL RECEPTOR — la red de seguridad del bloque que se le
 * manda a la DGI.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * QUÉ ES ESTO Y POR QUÉ EXISTE
 * ═════════════════════════════════════════════════════════════════════════════
 * `mapReceptor()` arma el bloque `informacionReceptor` que viaja en cada factura
 * electrónica. Si algo de ahí cambia sin querer, el resultado es un **rechazo de
 * la DGI sobre una factura real del bufete**: se entera la licenciada, delante
 * del cliente, y no hay forma de "deshacer" el intento.
 *
 * Este archivo congela la salida de `mapReceptor()` para un juego de clientes
 * representativo y la compara contra **`receptor-payload-esperado.json`**, que
 * está versionado al lado. Cualquier cambio en el mapper que altere lo que se le
 * manda a la DGI hace fallar este test y obliga a mirar el diff.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CÓMO SE LEE UN FALLO (para quien no escribió esto)
 * ─────────────────────────────────────────────────────────────────────────────
 * El test imprime el JSON esperado y el obtenido, campo por campo. Cuando falla:
 *
 *   1. Mirá QUÉ campo cambió. Si es un campo del bloque `datosRucReceptor`
 *      (`rucReceptor`, `digitoVerificador`, `tipoContribuyente`), pará: eso es
 *      lo que la DGI valida para identificar al cliente.
 *   2. Preguntate si el cambio es INTENCIONAL.
 *      · Si NO lo es → hay una regresión. Arreglá el mapper, no el JSON.
 *      · Si SÍ lo es → actualizá `receptor-payload-esperado.json` **en el mismo
 *        commit**, y explicá en el mensaje por qué el payload cambia. Un commit
 *        que solo toca el JSON esperado es una alarma.
 *   3. Antes de dar por buena una diferencia en `datosRucReceptor`, probala
 *      contra el **sandbox** de la DGI (`EFACTURA_I_AMB`). Nunca contra el
 *      ambiente real.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ CUBRE
 * ─────────────────────────────────────────────────────────────────────────────
 * Los cuatro tipos de receptor de la DGI, más dos casos SUCIOS que existen de
 * verdad en producción (ver `task_plan.md`, bloque del backfill `022`):
 *
 *   01  contribuyente con RUC      → lleva datosRucReceptor
 *   02  consumidor final           → NO lleva datosRucReceptor, y no necesita DV
 *   03  gobierno                   → misma estructura que 01
 *   04  extranjero                 → grupoIdentificacionExtranjera, sin RUC
 *   🔴  RUC con "DV NN" pegado + DV cargado  → payload INCORRECTO que hoy sale
 *   🟡  RUC con "DV NN" pegado sin DV        → el mapper corta antes
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { mapReceptor } from "@/lib/finanzas/efactura/mapper/map-receptor";
import type { EfacturaBundleClient } from "@/lib/finanzas/efactura/data/invoice-efactura-bundle";

const ESPERADO = join(
  process.cwd(),
  "src/lib/finanzas/efactura/__tests__/receptor-payload-esperado.json"
);

/**
 * Cliente base. Cada caso sobreescribe SOLO lo que lo distingue, para que al
 * leer el fixture se vea de un vistazo qué hace especial a ese caso.
 */
function cliente(over: Partial<EfacturaBundleClient>): EfacturaBundleClient {
  return {
    name: "CLIENTE DE PRUEBA, S.A.",
    client_number: "CLI-000",
    client_status: "active",
    client_type: "persona_juridica",
    tax_id: "1554821-1-741203",
    tax_id_type: "ruc",
    ruc: "1554821-1-741203",
    email: "facturacion@cliente.test",
    phone: "+507 200-0000",
    address: "Calle 50, Ciudad de Panamá",
    digito_verificador: "08",
    tipo_receptor_fe: "01",
    codigo_ubicacion: null,
    corregimiento: null,
    distrito: null,
    provincia: null,
    id_extranjero: null,
    pais_receptor: null,
    // Lo que distingue a cada caso pisa al base. Sin esta línea todos los
    // fixtures serían el mismo cliente y el congelado no probaría nada —
    // pasó en la primera versión de este archivo, y lo delató el caso que
    // tenía que cortar y no cortaba.
    ...over,
  };
}

/**
 * Los casos congelados. El `porque` viaja al JSON: es lo que le explica a quien
 * abra el archivo dentro de un año qué está mirando.
 */
const CASOS: { clave: string; porque: string; client: EfacturaBundleClient }[] = [
  {
    clave: "01-contribuyente-con-ruc",
    porque:
      "El caso normal de una persona jurídica. Lleva datosRucReceptor con el RUC y el DV EN CAMPOS SEPARADOS, que es lo que la DGI valida (códigos 1601/1602).",
    client: cliente({ client_number: "CLI-001", name: "FERRETERÍA VALLARINO, S.A." }),
  },
  {
    clave: "01-contribuyente-dv-con-cero-adelante",
    porque:
      'DV "00" es un valor real: en staging lo tienen INVERSIONES TOCUMEN REAL y CONSTRUCTORA CHIRIQUÍ. Tiene que viajar como texto de dos posiciones, no como el número 0.',
    client: cliente({
      client_number: "CLI-004",
      name: "INVERSIONES TOCUMEN REAL, S.A.",
      tax_id: "1588210-1-713366",
      ruc: "1588210-1-713366",
      digito_verificador: "00",
    }),
  },
  {
    clave: "02-consumidor-final",
    porque:
      "Una persona natural sin RUC. NO lleva datosRucReceptor, así que la ausencia de DV es correcta y no un dato faltante. Sí lleva paisReceptor PA.",
    client: cliente({
      client_number: "CLI-012",
      name: "Nidia Espinosa Caballero",
      client_type: "persona_natural",
      tax_id: "4-209-6631",
      tax_id_type: "cedula",
      ruc: "4-209-6631",
      digito_verificador: null,
      tipo_receptor_fe: "02",
    }),
  },
  {
    clave: "03-gobierno",
    porque:
      "Una entidad estatal. Usa la MISMA estructura que 01 — también exige RUC y DV — y por eso el gate fiscal los trata juntos.",
    client: cliente({
      client_number: "CLI-050",
      name: "AUTORIDAD DEL CANAL DE PANAMÁ",
      tax_id: "8-NT-1-1234",
      ruc: "8-NT-1-1234",
      digito_verificador: "45",
      tipo_receptor_fe: "03",
    }),
  },
  {
    clave: "04-extranjero",
    porque:
      "Un receptor no residente. Va con grupoIdentificacionExtranjera y su país; NO lleva datosRucReceptor ni DV, y el paisReceptor NO se fuerza a PA.",
    client: cliente({
      client_number: "CLI-070",
      name: "OVERSEAS HOLDINGS LTD.",
      tax_id: null,
      tax_id_type: "extranjero",
      ruc: null,
      digito_verificador: null,
      tipo_receptor_fe: "04",
      id_extranjero: "GB-9981772",
      pais_receptor: "GB",
    }),
  },
  {
    clave: "01-con-ubicacion-completa",
    porque:
      "Con ubicación cargada aparece el bloque ubicacionReceptor. Es OPCIONAL para la DGI (grupo B405, efecto Notificación): su ausencia no rechaza la factura, pero su PRESENCIA no puede cambiar de forma sin que nos enteremos.",
    client: cliente({
      client_number: "CLI-002",
      name: "PANAMÁ COSTA VERDE, S.A.",
      tax_id: "1602933-1-802514",
      ruc: "1602933-1-802514",
      digito_verificador: "02",
      codigo_ubicacion: "8-8-7",
      corregimiento: "Bella Vista",
      distrito: "Panamá",
      provincia: "Panamá",
    }),
  },
  {
    clave: "SUCIO-ruc-con-dv-pegado-y-columna-cargada",
    porque:
      "🔴 PAYLOAD INCORRECTO QUE EL SISTEMA HOY PRODUCE. El RUC arrastra ' DV 40' como texto y la columna digito_verificador también está cargada, así que el gate fiscal lo deja pasar y se le manda a la DGI un rucReceptor sucio, con el DV repetido adentro. Este caso NO existe hoy en producción (medido el 02/09/2026: los dos clientes con DV pegado tienen la columna vacía y quedan bloqueados por el gate), pero se congela para que quede constancia de que este payload está MAL y de qué forma exacta toma. Lo arregla el backfill 022, no el mapper.",
    client: cliente({
      client_number: "CLI-026",
      name: "INTEGRA LEGAL",
      tax_id: "25046169-3-2021  DV 40",
      ruc: "25046169-3-2021  DV 40",
      digito_verificador: "40",
    }),
  },
];

/** Un caso aparte: el mapper tiene que CORTAR, no producir un payload. */
const CASOS_QUE_CORTAN: { clave: string; porque: string; client: EfacturaBundleClient; error: RegExp }[] = [
  {
    clave: "SUCIO-ruc-con-dv-pegado-sin-columna",
    porque:
      "🟡 Es la situación REAL de CLI-026 y CLI-081 en producción al 02/09/2026: el DV quedó escrito dentro del texto del RUC y la columna está vacía. El mapper corta antes de armar nada. Es un fallo seguro: molesta, pero no le manda basura a la DGI.",
    client: cliente({
      client_number: "CLI-081",
      name: "SERVICARE",
      tax_id: "155701991-2-2021 DV 9",
      ruc: "155701991-2-2021 DV 9",
      digito_verificador: null,
    }),
    error: /digito_verificador/i,
  },
  {
    clave: "sin-client-type",
    porque:
      "Sin tipo de persona no se puede derivar el tipoContribuyente del receptor. El mapper corta y el gate fiscal lo convierte en un 400 accionable.",
    client: cliente({ client_number: "CLI-116", client_type: null }),
    error: /client_type/i,
  },
];

/**
 * Normaliza pasando por JSON, y no es un detalle.
 *
 * `mapReceptor()` devuelve claves opcionales con valor `undefined`
 * (`ubicacionReceptor`, `direccionReceptor`…). `JSON.stringify` las DESCARTA al
 * escribir el archivo, pero `deepStrictEqual` distingue "clave ausente" de
 * "clave presente valiendo undefined" — así que comparar el objeto vivo contra
 * el JSON leído fallaba SIEMPRE, incluso sin ningún cambio.
 *
 * Pasándolo por JSON los dos lados quedan en la misma forma, y además se compara
 * lo que de verdad importa: **lo que se serializa y viaja**, no lo que el objeto
 * tiene en memoria. Una clave en `undefined` no llega nunca a la DGI.
 */
function comoSeEnvia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Lo que se congela: el bloque del receptor, más el motivo del caso. */
function instantanea() {
  const salida: Record<string, unknown> = {
    _leeme:
      "Payload congelado del bloque informacionReceptor que se le manda a la DGI. " +
      "Generado por receptor-payload-congelado.test.ts. NO editar a mano salvo que " +
      "el cambio en el mapper sea intencional, y en ese caso en el mismo commit y " +
      "explicando por qué. Para regenerarlo: ACTUALIZAR_PAYLOAD=1 npm test",
  };

  for (const caso of CASOS) {
    salida[caso.clave] = {
      porque: caso.porque,
      payload: comoSeEnvia(mapReceptor(caso.client)),
    };
  }

  for (const caso of CASOS_QUE_CORTAN) {
    let mensaje = "(no cortó — esto es una regresión)";
    try {
      mapReceptor(caso.client);
    } catch (e) {
      mensaje = (e as Error).message;
    }
    salida[caso.clave] = { porque: caso.porque, cortaCon: mensaje };
  }

  return salida;
}

// ---------------------------------------------------------------------------
// EL TEST
// ---------------------------------------------------------------------------

test("el payload del receptor no cambió sin que nadie lo decida", () => {
  const actual = instantanea();

  // Escotilla explícita para regenerar. Es deliberadamente incómoda: si fuera
  // automática, el test dejaría de ser una red.
  if (process.env.ACTUALIZAR_PAYLOAD === "1") {
    writeFileSync(ESPERADO, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    console.log(`\n⚠️  receptor-payload-esperado.json REGENERADO. Revisá el diff antes de commitear.\n`);
    return;
  }

  const esperado = JSON.parse(readFileSync(ESPERADO, "utf8"));

  // Se compara caso por caso para que el fallo diga CUÁL cambió, en vez de
  // volcar el JSON entero.
  for (const clave of Object.keys(esperado)) {
    if (clave.startsWith("_")) continue;
    assert.deepEqual(
      actual[clave],
      esperado[clave],
      `\n\nEl payload del caso "${clave}" cambió.\n\n` +
        `ESPERADO:\n${JSON.stringify(esperado[clave], null, 2)}\n\n` +
        `OBTENIDO:\n${JSON.stringify(actual[clave], null, 2)}\n\n` +
        `Si el cambio NO es intencional, hay una regresión en el mapper.\n` +
        `Si SÍ lo es: ACTUALIZAR_PAYLOAD=1 npm test, revisá el diff, y commiteá el JSON\n` +
        `junto con el cambio del mapper explicando por qué el payload cambia.\n`
    );
  }

  const claves = Object.keys(actual).filter((k) => !k.startsWith("_"));
  const congeladas = Object.keys(esperado).filter((k) => !k.startsWith("_"));
  assert.deepEqual(
    claves.sort(),
    congeladas.sort(),
    "\nHay casos nuevos sin congelar (o casos congelados que ya no se generan).\n" +
      "Corré: ACTUALIZAR_PAYLOAD=1 npm test\n"
  );
});

// ---------------------------------------------------------------------------
// Lo que el congelado NO puede afirmar por sí solo
// ---------------------------------------------------------------------------
// Un snapshot dice "esto no cambió", no "esto está bien". Estas aserciones
// explícitas son las que dicen lo segundo.

test("🔴 el RUC y el DV viajan SIEMPRE en campos separados", () => {
  for (const caso of CASOS) {
    const r = mapReceptor(caso.client);
    const datos = r.datosRucReceptor;
    if (!datos) continue;
    assert.equal(typeof datos.rucReceptor, "string", `${caso.clave}: falta rucReceptor`);
    assert.equal(typeof datos.digitoVerificador, "string", `${caso.clave}: falta digitoVerificador`);
    assert.ok(
      !("rucCompleto" in datos) && !("rucConDv" in datos),
      `${caso.clave}: apareció un campo que junta RUC y DV`
    );
  }
});

test("un DV con cero adelante llega a la DGI con su cero", () => {
  const r = mapReceptor(CASOS[1].client);
  assert.equal(r.datosRucReceptor?.digitoVerificador, "00");
});

test("un consumidor final (02) no lleva bloque de RUC, y eso es correcto", () => {
  const r = mapReceptor(CASOS[2].client);
  assert.equal(r.datosRucReceptor, undefined);
  assert.equal(r.paisReceptor, "PA");
});

test("un extranjero (04) no lleva bloque de RUC y conserva su país", () => {
  const r = mapReceptor(CASOS[4].client);
  assert.equal(r.datosRucReceptor, undefined);
  assert.equal(r.paisReceptor, "GB");
  assert.equal(r.grupoIdentificacionExtranjera?.pasaportNumeroIdentificacionExtranjera, "GB-9981772");
});

test("🔴 queda constancia: con el DV pegado al RUC, se manda un rucReceptor sucio", () => {
  // No es una aspiración de diseño: es lo que el sistema hace hoy si un cliente
  // tiene el DV en el texto Y la columna cargada. El test lo AFIRMA para que
  // nadie lo descubra desde un rechazo de la DGI.
  const sucio = CASOS.find((c) => c.clave === "SUCIO-ruc-con-dv-pegado-y-columna-cargada");
  assert.ok(sucio, "desapareció el caso sucio del fixture");

  const datos = mapReceptor(sucio.client).datosRucReceptor;
  assert.ok(datos, "un receptor 01 tiene que llevar datosRucReceptor");
  // `rucReceptor` es opcional en el tipo del PAC, pero para un receptor 01 no
  // puede faltar: si falta, la DGI rechaza por el código 1601.
  assert.ok(datos.rucReceptor, "un receptor 01 sin rucReceptor es rechazo 1601");

  assert.match(
    datos.rucReceptor,
    /DV\s*40/,
    "el RUC ya no arrastra el DV — si eso se arregló, actualizá este test y el JSON"
  );
  assert.equal(datos.digitoVerificador, "40");
  // El DV termina yendo DOS veces: una dentro del RUC y otra en su campo.
  // Eso es lo que la DGI rechaza, y lo que el backfill 022 viene a limpiar.
});

test("🟡 sin DV en la columna, el mapper corta antes de armar el payload", () => {
  for (const caso of CASOS_QUE_CORTAN) {
    assert.throws(
      () => mapReceptor(caso.client),
      caso.error,
      `${caso.clave}: tenía que cortar y no cortó`
    );
  }
});
