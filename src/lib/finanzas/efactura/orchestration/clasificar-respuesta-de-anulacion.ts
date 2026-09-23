/**
 * QUÉ CONTESTÓ EL PAC CUANDO LE PEDIMOS ANULAR — clasificación pura.
 *
 * `POST /api/v1/InvoiceEvents/CreateCancellation` devuelve **un array de
 * `{ codigo, mensaje }`** y nada más. Eso es todo lo que el swagger dice: el
 * esquema `InvoiceCancellationEventResponse` tiene esas dos propiedades, las
 * dos `nullable`, sin `enum`, sin `required` y sin una sola descripción.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 NO SABEMOS CÓMO SE VE UN ÉXITO. Y ESO ESTÁ ESCRITO EN EL CÓDIGO.
 * ─────────────────────────────────────────────────────────────────────────────
 * Ninguna respuesta real de este endpoint pasó todavía por acá. Las pruebas de
 * sandbox 5 y (a) existen justamente para eso. Hasta entonces, la tentación es
 * suponer —"HTTP 200 y array vacío debe ser que salió bien"— y esa suposición
 * tiene una consecuencia concreta: si es falsa, el orquestador marca la factura
 * como anulada, revierte el asiento, y el documento sigue **vivo ante la DGI**.
 * Un descuadre entre nuestros libros y los de la DGI que nadie ve hasta la
 * próxima declaración.
 *
 * Así que existe una cuarta respuesta, `indeterminada`, y **no es un error**:
 * es "el PAC contestó algo que no reconozco; andá a preguntarle al documento".
 * El orquestador (9B/4) la trata como la orden de consultar el estado antes de
 * tocar el libro, que es exactamente lo que pide D3. Un array vacío cae ahí a
 * propósito.
 *
 * Cuando las pruebas 5 y (a) digan qué devuelve de verdad, esto se ajusta **en
 * su propio commit**, con la respuesta real citada en el mensaje. No antes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LAS HEURÍSTICAS SON PROVISIONALES Y ESTÁN MARCADAS COMO TALES
 * ─────────────────────────────────────────────────────────────────────────────
 * Los patrones de texto de abajo vienen del **otro** endpoint —el de emisión,
 * cuyos `gResProc` sí vimos— y de cómo escribe ideati en español. Sirven para
 * no quedarse completamente ciego, no para decidir sin red: cualquier cosa que
 * no matchee cae en `indeterminada`, nunca en "anulada".
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
const SENIAL_DE_YA_ANULADA = /\bya\s+(fue|est[aá]|se\s+encuentra)\s+(anulad|cancelad)/;

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
  return SENIAL_DE_YA_ANULADA.test(texto(e));
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
        "La DGI informa que este documento ya estaba anulado. " +
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
