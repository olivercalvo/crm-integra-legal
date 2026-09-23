/**
 * La respuesta del PAC a una anulación: clasificación y lectura de estado.
 *
 * Ejecución:  npm test
 *
 * 🔴 EL TEST MÁS IMPORTANTE DE ESTE ARCHIVO ES EL QUE EXIGE QUE NO SEPAMOS.
 *
 * Ninguna respuesta real de `CreateCancellation` pasó todavía por este código:
 * las pruebas de sandbox 5 y (a) existen para eso. La tentación mientras tanto
 * es suponer que un HTTP 200 con array vacío significa "salió bien", y esa
 * suposición tiene una consecuencia concreta: si es falsa, el orquestador
 * revierte el asiento y marca la factura anulada mientras el documento sigue
 * VIVO ante la DGI. Un descuadre que nadie ve hasta la próxima declaración.
 *
 * Así que hay un test que exige que el array vacío caiga en `indeterminada`, y
 * otro que exige que el lector de estado devuelva `anulado: null`. Los dos van
 * a fallar el día que alguien "complete" esto sin la evidencia del sandbox, y
 * eso es exactamente lo que tienen que hacer.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  clasificarRespuestaDeAnulacion,
  leerEventos,
  resumirEventos,
} from "@/lib/finanzas/efactura/orchestration/clasificar-respuesta-de-anulacion";
import {
  leerEstadoDelDocumento,
  MARCADOR_DE_ANULACION_CONFIRMADO,
} from "@/lib/finanzas/efactura/transport/anulacion-en-pac";

// ---------------------------------------------------------------------------
// LO QUE NO SABEMOS, Y QUE TIENE QUE SEGUIR SIN SABERSE HASTA EL SANDBOX
// ---------------------------------------------------------------------------

test("🔴 array VACÍO → indeterminada, nunca 'anulada'", () => {
  const r = clasificarRespuestaDeAnulacion([]);
  assert.equal(
    r.clase,
    "indeterminada",
    "Un 200 con array vacío es el candidato más probable a 'éxito silencioso', y " +
      "justamente por eso no se da por bueno. Si esto se cambia a 'anulada' sin la " +
      "evidencia de la prueba de sandbox 5, el orquestador va a revertir asientos de " +
      "facturas que siguen vivas ante la DGI."
  );
  assert.match(r.mensaje, /consultar el estado/i, "el mensaje dice qué hacer");
});

test("🔴 una respuesta con forma desconocida → indeterminada, y guarda el crudo", () => {
  for (const basura of [null, undefined, {}, "ok", 200, { resultado: "ok" }]) {
    const r = clasificarRespuestaDeAnulacion(basura);
    assert.equal(r.clase, "indeterminada", JSON.stringify(basura));
    if (r.clase !== "indeterminada") return;
    assert.equal(r.crudo, basura, "el crudo se conserva: es la evidencia de la prueba (a)");
  }
});

test("🔴 el lector de estado NO afirma que un documento esté anulado", () => {
  // `deletedDate` era la hipótesis obvia, y la prueba de sandbox (b) del
  // 23/09/2026 la desmintió: el GET devuelve el MISMO payload antes y después
  // de que exista el evento de anulación — `autorizada: true`, `deletedDate:
  // null`. No hay marcador que confirmar, así que esto no es prudencia
  // provisional: es el resultado.
  assert.equal(
    MARCADOR_DE_ANULACION_CONFIRMADO,
    false,
    "El sandbox mostró que el GET no refleja la anulación. Ponerlo en true afirmaría, " +
      "sobre un documento fiscal, algo que el PAC no dice."
  );

  const e = leerEstadoDelDocumento({
    cufe: "FE01...",
    autorizada: true,
    deletedDate: "2026-09-23T10:00:00Z",
    deletedBy: "alguien",
  });
  assert.equal(e.anulado, null, "null significa 'no se pudo determinar', no 'no está anulado'");
  assert.equal(e.anuladoSegunHipotesis, true, "la hipótesis se calcula y se expone aparte");
  assert.equal(e.deletedDate, "2026-09-23T10:00:00Z", "el campo candidato viaja tal cual");
});

test("el lector guarda el payload crudo: es lo que la prueba (b) tiene que registrar", () => {
  const payload = { cufe: "X", autorizada: true, algoNuevo: 1 };
  assert.equal(leerEstadoDelDocumento(payload).crudo, payload);
});

test("el lector no revienta con una respuesta rara", () => {
  for (const basura of [null, undefined, "texto", 7, []]) {
    const e = leerEstadoDelDocumento(basura);
    assert.equal(e.anulado, null);
    assert.equal(e.autorizada, null);
    assert.equal(e.cufe, null);
  }
});

// ---------------------------------------------------------------------------
// LO QUE SÍ SE PUEDE CLASIFICAR
// ---------------------------------------------------------------------------

test("un código de éxito con mensaje de anulación → anulada", () => {
  const r = clasificarRespuestaDeAnulacion([
    { codigo: "0260", mensaje: "Documento anulado correctamente" },
  ]);
  assert.equal(r.clase, "anulada");
});

/**
 * 🔒 LA RESPUESTA REAL DEL SANDBOX, 23/09/2026.
 *
 * Pedirle dos veces la anulación al mismo CUFE devolvió HTTP 200 con este
 * array, textual. Es el único dato MEDIDO que tiene este módulo: todo lo demás
 * son heurísticas. Si alguna vez se toca el clasificador, esto es lo que no
 * puede cambiar de significado.
 */
const RESPUESTA_REAL_YA_ANULADA = [
  { codigo: "0622", mensaje: "Ya existe un evento de anulación para esta FE" },
];

test("🔒 0622 (respuesta REAL del sandbox) → ya_anulada, NO rechazada", () => {
  // Para un reintento, "ya existe un evento de anulación" es un ÉXITO: el
  // documento está muerto ante la DGI, que es lo que se quería. Clasificarlo
  // como rechazo dejaría a la factura trabada en el estado intermedio para
  // siempre, porque el reintento nunca podría avanzar al libro.
  const r = clasificarRespuestaDeAnulacion(RESPUESTA_REAL_YA_ANULADA);
  assert.equal(r.clase, "ya_anulada");
  assert.match(r.mensaje, /0622/);
});

test("🔒 el código manda aunque el mensaje cambie de redacción", () => {
  // ideati podría reescribir el texto en castellano sin avisar. El código no.
  const r = clasificarRespuestaDeAnulacion([
    { codigo: "0622", mensaje: "Evento previo registrado" },
  ]);
  assert.equal(r.clase, "ya_anulada");
});

test("y el mensaje también alcanza, si algún día cambia el código", () => {
  const r = clasificarRespuestaDeAnulacion([
    { codigo: "9999", mensaje: "Ya existe un evento de anulación para esta FE" },
  ]);
  assert.equal(r.clase, "ya_anulada");
});

test("mensaje de 'ya estaba anulada' → ya_anulada (para el reintento es un éxito)", () => {
  const r = clasificarRespuestaDeAnulacion([
    { codigo: "1900", mensaje: "El documento ya fue anulado previamente" },
  ]);
  assert.equal(r.clase, "ya_anulada");
});

test("🔴 un rechazo gana sobre cualquier señal optimista", () => {
  // La lección de classify-pac-error: ahí "RUC inEXISTENTE" matcheaba
  // `includes("existente")` y un rechazo por RUC se mostraba como "el documento
  // ya existe, posiblemente ya autorizado". La licenciada leyó eso y creyó que
  // tenía que anular.
  const r = clasificarRespuestaDeAnulacion([
    { codigo: "0260", mensaje: "Documento anulado" },
    { codigo: "1801", mensaje: "No se pudo anular: fuera del plazo permitido" },
  ]);
  assert.equal(r.clase, "rechazada");
  if (r.clase !== "rechazada") return;
  assert.match(r.mensaje, /fuera del plazo/i);
  assert.doesNotMatch(r.mensaje, /Documento anulado/, "el texto optimista no se muestra");
});

test("el rechazo por plazo trae la pista de la nota de crédito", () => {
  const r = clasificarRespuestaDeAnulacion([
    { codigo: "1801", mensaje: "Venció el plazo para anular el documento" },
  ]);
  assert.equal(r.clase, "rechazada");
  if (r.clase !== "rechazada") return;
  assert.match(String(r.pista), /nota de cr[eé]dito/i);
});

test("el rechazo por CUFE inexistente trae su propia pista", () => {
  const r = clasificarRespuestaDeAnulacion([
    { codigo: "1602", mensaje: "El CUFE indicado no existe en el sistema" },
  ]);
  assert.equal(r.clase, "rechazada");
  if (r.clase !== "rechazada") return;
  assert.match(String(r.pista), /CUFE/);
});

test("un código desconocido con mensaje → rechazada, no indeterminada", () => {
  // Un código que el PAC devuelve y no reconocemos es información: algo salió
  // mal y hay que mostrarlo. Lo indeterminado es la AUSENCIA de información.
  const r = clasificarRespuestaDeAnulacion([{ codigo: "9999", mensaje: "Algo pasó" }]);
  assert.equal(r.clase, "rechazada");
});

// ---------------------------------------------------------------------------
// LECTURA DEL ARRAY
// ---------------------------------------------------------------------------

test("leerEventos ignora lo que no tiene forma de evento", () => {
  const e = leerEventos([{ codigo: "1", mensaje: "a" }, null, "x", 3, { otra: 1 }]);
  assert.equal(e.length, 2, "entran los dos objetos; null, string y number quedan afuera");
  assert.deepEqual(e[0], { codigo: "1", mensaje: "a" });
  assert.deepEqual(
    e[1],
    { codigo: undefined, mensaje: undefined },
    "un objeto con otras claves entra vacío: que el PAC agregue un campo no puede hacer " +
      "desaparecer el evento de la lista"
  );
});

test("leerEventos con algo que no es array → vacío", () => {
  for (const basura of [null, undefined, {}, "x", 1]) {
    assert.deepEqual(leerEventos(basura), []);
  }
});

test("resumirEventos arma la línea que ve la persona", () => {
  assert.equal(
    resumirEventos([{ codigo: "1801", mensaje: "Fuera de plazo" }, { mensaje: "Detalle" }]),
    "[1801] Fuera de plazo · Detalle"
  );
  assert.equal(resumirEventos([]), null);
});
