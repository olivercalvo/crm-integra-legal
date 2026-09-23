/**
 * QUÉ CONTESTÓ EL PAC CUANDO LE PEDIMOS ANULAR — clasificación pura.
 *
 * `POST /api/v1/InvoiceEvents/CreateCancellation` devuelve **un array de
 * `{ codigo, mensaje }`** y nada más. Eso es todo lo que el swagger dice: el
 * esquema `InvoiceCancellationEventResponse` tiene esas dos propiedades, las
 * dos `nullable`, sin `enum`, sin `required` y sin una sola descripción.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE EL SANDBOX CONTESTÓ (23/09/2026) Y LO QUE SIGUE ABIERTO
 * ─────────────────────────────────────────────────────────────────────────────
 * ✅ **Repetir la anulación es ESTABLE.** Dos llamadas seguidas sobre el mismo
 *    CUFE devuelven HTTP 200 con
 *    `[{codigo:"0622", mensaje:"Ya existe un evento de anulación para esta FE"}]`.
 *    No explota, no cambia nada y no depende de cuántas veces se pida. Para un
 *    reintento eso es un **éxito**, no un rechazo, y por eso `0622` clasifica
 *    como `ya_anulada`.
 *
 * ✅ **El GET de estado NO sirve para saber si un documento está anulado.**
 *    `GET /Invoices/Authorization/{cufe}` devuelve EXACTAMENTE el mismo payload
 *    antes y después —`autorizada: true`, `deletedDate: null`, `deletedBy:
 *    null`— con el evento de anulación ya existente. Ningún campo cambia.
 *    Consecuencia de diseño: la "consulta de estado antes de reintentar" que
 *    pide D3 **no se puede hacer con la API que existe**. Lo único que informa
 *    la anulación es el propio `0622`. Detalle en `anulacion-en-pac.ts`.
 *
 * ❌ **Sigue sin saberse cómo se ve un ÉXITO** (prueba 5). El único documento
 *    autorizado que había en staging ya tenía un evento de anulación encima, y
 *    emitir uno nuevo se frenó en los RUC ficticios del seed, que la DGI
 *    rechaza (`1601`/`1602`). Anotado en `task_plan.md`.
 *
 * 🔴 Mientras eso siga abierto, la tentación es suponer —"HTTP 200 y array
 * vacío debe ser que salió bien"— y esa suposición tiene una consecuencia
 * concreta: si es falsa, el orquestador marca la factura como anulada, revierte
 * el asiento, y el documento sigue **vivo ante la DGI**. Un descuadre entre
 * nuestros libros y los de la DGI que nadie ve hasta la próxima declaración.
 *
 * Así que existe una cuarta respuesta, `indeterminada`, y **no es un error**:
 * es "el PAC contestó algo que no reconozco". El orquestador la trata como la
 * orden de NO tocar el libro y escalar el caso. Un array vacío cae ahí a
 * propósito. Cuando la prueba 5 diga qué devuelve de verdad, esto se ajusta
 * **en su propio commit**, con la respuesta real citada. No antes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LAS HEURÍSTICAS DE TEXTO SON LA RED, EL CÓDIGO NUMÉRICO ES EL DATO
 * ─────────────────────────────────────────────────────────────────────────────
 * Los patrones de abajo vienen del **otro** endpoint —el de emisión, cuyos
 * `gResProc` sí vimos— y de cómo escribe ideati en español. Sirven para no
 * quedarse ciego si el PAC cambia un código, no para decidir sin red:
 * cualquier cosa que no matchee cae en `indeterminada`, nunca en "anulada".
 *
 * La precedencia es la misma lección de `classify-pac-error.ts`: **un código de
 * rechazo gana sobre cualquier señal optimista**. Ahí el bug fue que
 * "RUC inEXISTENTE" matcheaba `includes("existente")` y un rechazo por RUC se
 * mostraba como "el documento ya existe, posiblemente ya autorizado" — la
 * licenciada leyó eso y creyó que tenía que anular.
 *
 * Módulo PURO, sin I/O.
 */

/** Un elemento del array que devuelve `CreateCancellation`. */
export interface EventoDeAnulacion {
  codigo?: string;
  mensaje?: string;
}

export type ResultadoDeAnulacionEnPac =
  /** El PAC confirmó la anulación. */
  | { clase: "anulada"; eventos: EventoDeAnulacion[]; mensaje: string }
  /** El PAC dice que ese documento ya estaba anulado. Para el reintento, es un éxito. */
  | { clase: "ya_anulada"; eventos: EventoDeAnulacion[]; mensaje: string }
  /** El PAC rechazó la anulación (fuera de plazo, CUFE inexistente, motivo corto…). */
  | { clase: "rechazada"; eventos: EventoDeAnulacion[]; mensaje: string; pista: string | null }
  /** 🔴 No se pudo determinar. NO es un error: es "preguntale al documento". */
  | { clase: "indeterminada"; eventos: EventoDeAnulacion[]; mensaje: string; crudo: unknown };

/**
 * Códigos que el PAC usa para "salió bien" en el endpoint de emisión. `0260` es
 * "Autorizado el uso de la FE" (Ficha Técnica DGI v1.00 §8, Tabla 7); los ceros
 * cubren las variantes de OK. **No está confirmado que este endpoint use los
 * mismos** — prueba de sandbox 5.
 */
const CODIGOS_DE_EXITO = new Set(["0260", "0", "00", "000", "0000"]);

/** Negaciones que invalidan cualquier señal optimista. La lección del 1602. */
const NEGACIONES =
  /\bno\s+se\s+(pudo|puede)\b|\bno\s+fue\b|\bno\s+existe\b|\binexistente\b|\bno\s+se\s+encuentra\b|\brechaz/;

const SENIAL_DE_ANULADA = /\banulad[ao]\b|\bcancelad[ao]\b|\banulaci[oó]n\s+(exitosa|procesada|registrada)\b/;
/**
 * 🔴 `0622` — CONFIRMADO EN SANDBOX EL 23/09/2026.
 *
 * Llamando dos veces a `CreateCancellation` sobre el mismo CUFE, el PAC
 * devuelve HTTP 200 con:
 *
 *     [{ "codigo": "0622", "mensaje": "Ya existe un evento de anulación para esta FE" }]
 *
 * O sea: **es estable**. Repetir la anulación no explota ni cambia nada; avisa
 * que el evento ya existe. Para un reintento eso es un ÉXITO, no un rechazo.
 *
 * Y es la ÚNICA forma que tenemos de saberlo, porque
 * `GET /Invoices/Authorization/{cufe}` **no refleja la anulación**: devuelve
 * exactamente el mismo payload antes y después, con `autorizada: true` y
 * `deletedDate: null`. Ver `anulacion-en-pac.ts`.
 *
 * La heurística de texto se conserva como red por si el PAC cambiara el código,
 * pero manda el código numérico: es dato medido, no inferencia.
 */
const CODIGO_YA_ANULADA = "0622";
const SENIAL_YA_ANULADA_TEXTO =
  /\bya\s+(fue|est[aá]|se\s+encuentra)\s+(anulad|cancelad)|\bya\s+existe\s+un\s+evento\s+de\s+anulaci[oó]n/;

/**
 * Pistas accionables para los rechazos que sabemos anticipar. El detalle
 * técnico (código + mensaje del PAC) se sigue mostrando aparte.
 */
const PISTAS: Array<{ patron: RegExp; pista: string }> = [
  {
    patron: /\bplazo\b|\bvenc/,
    pista:
      "La DGI ya no acepta anular este documento por el plazo. La corrección es una nota " +
      "de crédito con fecha de hoy que referencie su CUFE.",
  },
  {
    patron: /\bcufe\b.*\b(inexistente|no\s+existe|no\s+se\s+encuentra)\b/,
    pista:
      "La DGI no reconoce ese CUFE. Verifique que sea el de esta factura y no el de otro " +
      "documento antes de reintentar.",
  },
  {
    patron: /\bmotivo\b|\brazon\b|\brazón\b/,
    pista:
      "El motivo de anulación no le sirvió a la DGI. Escriba una frase completa que explique " +
      "por qué se anula el documento.",
  },
];

/** Normaliza el array crudo del PAC a `EventoDeAnulacion[]`. */
export function leerEventos(crudo: unknown): EventoDeAnulacion[] {
  if (!Array.isArray(crudo)) return [];
  const out: EventoDeAnulacion[] = [];
  for (const item of crudo) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    out.push({
      codigo: typeof o.codigo === "string" ? o.codigo : undefined,
      mensaje: typeof o.mensaje === "string" ? o.mensaje : undefined,
    });
  }
  return out;
}

/** "[0260] Documento anulado · [0] OK" */
export function resumirEventos(eventos: EventoDeAnulacion[]): string | null {
  if (eventos.length === 0) return null;
  return eventos
    .map((e) => `${e.codigo ? `[${e.codigo}] ` : ""}${e.mensaje ?? "(sin mensaje)"}`)
    .join(" · ");
}

function texto(e: EventoDeAnulacion): string {
  return (e.mensaje ?? "").toLowerCase();
}

function esExito(e: EventoDeAnulacion): boolean {
  if (NEGACIONES.test(texto(e))) return false;
  if (e.codigo && CODIGOS_DE_EXITO.has(e.codigo.trim())) return true;
  return SENIAL_DE_ANULADA.test(texto(e));
}

function esYaAnulada(e: EventoDeAnulacion): boolean {
  if (e.codigo?.trim() === CODIGO_YA_ANULADA) return true;
  return SENIAL_YA_ANULADA_TEXTO.test(texto(e));
}

function esRechazo(e: EventoDeAnulacion): boolean {
  if (esYaAnulada(e)) return false;
  if (NEGACIONES.test(texto(e))) return true;
  // Un código que no es de éxito y viene con mensaje: rechazo.
  if (e.codigo && !CODIGOS_DE_EXITO.has(e.codigo.trim()) && !SENIAL_DE_ANULADA.test(texto(e))) {
    return true;
  }
  return false;
}

function pistaPara(eventos: EventoDeAnulacion[]): string | null {
  const todo = eventos.map(texto).join(" ");
  for (const { patron, pista } of PISTAS) {
    if (patron.test(todo)) return pista;
  }
  return null;
}

/**
 * Clasifica la respuesta de `CreateCancellation`.
 *
 * PRECEDENCIA, de más fuerte a más débil:
 *   1. rechazo   — cualquier código o mensaje de rechazo gana sobre todo lo demás;
 *   2. ya anulada;
 *   3. anulada;
 *   4. **indeterminada** — todo lo que no encaje, incluido el array vacío.
 */
export function clasificarRespuestaDeAnulacion(crudo: unknown): ResultadoDeAnulacionEnPac {
  const eventos = leerEventos(crudo);

  const rechazos = eventos.filter(esRechazo);
  if (rechazos.length > 0) {
    return {
      clase: "rechazada",
      eventos,
      mensaje: resumirEventos(rechazos) ?? "La DGI rechazó la anulación.",
      pista: pistaPara(rechazos),
    };
  }

  if (eventos.some(esYaAnulada)) {
    return {
      clase: "ya_anulada",
      eventos,
      mensaje:
        "La DGI informa que este documento ya tiene un evento de anulación. " +
        (resumirEventos(eventos) ?? ""),
    };
  }

  if (eventos.length > 0 && eventos.every(esExito)) {
    return {
      clase: "anulada",
      eventos,
      mensaje: resumirEventos(eventos) ?? "Documento anulado ante la DGI.",
    };
  }

  // 🔴 Todo lo demás. Incluye el array vacío, que es el caso más probable de un
  //    éxito silencioso — y justamente por eso no se da por bueno sin mirar el
  //    documento. Ver el encabezado.
  return {
    clase: "indeterminada",
    eventos,
    mensaje:
      eventos.length === 0
        ? "El PAC respondió sin códigos. No se puede saber desde acá si la anulación se " +
          "aplicó: hay que consultar el estado del documento antes de tocar el libro."
        : "El PAC respondió algo que no se pudo clasificar: " +
          (resumirEventos(eventos) ?? "(vacío)") +
          ". Hay que consultar el estado del documento antes de tocar el libro.",
    crudo,
  };
}
