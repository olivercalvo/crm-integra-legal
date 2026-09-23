/**
 * LO QUE DIJO LA DGI, EN CASTELLANO QUE SE ENTIENDE.
 *
 * Módulo PURO. Traduce el par `(código, mensaje)` del PAC a tres cosas:
 * **qué pasó**, **qué hay que corregir** y **dónde**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ALCANZA CON MOSTRAR EL MENSAJE DEL PAC
 * ─────────────────────────────────────────────────────────────────────────────
 * *"Regla de formación del RUC invalida"* es correcto y no le sirve a nadie: no
 * dice de quién es el RUC —¿del bufete o del cliente?— ni en qué pantalla se
 * arregla. La licenciada que lo lee tiene que adivinar dos cosas antes de poder
 * hacer algo.
 *
 * Lo que sí sirve es: *"La DGI no reconoce el RUC del cliente. Revise el RUC y
 * el DV en la ficha de CONSTRUCTORA CHIRIQUÍ ANTIGUO, S.A. y vuelva a enviar."*
 *
 * ⚠️ **El mensaje original NUNCA se tira.** Viaja junto a la traducción, con su
 * código, porque es lo único que sirve para hablar con ideati. Traducir no es
 * reemplazar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 UN CÓDIGO QUE NO ESTÁ ACÁ NO ES UN ERROR CONOCIDO
 * ─────────────────────────────────────────────────────────────────────────────
 * Es la misma regla que en los clasificadores, por el mismo motivo: el `0600`
 * del endpoint de anulación era un ÉXITO y se leyó como rechazo porque no
 * estaba en una lista. Acá, un código desconocido devuelve `null` y la pantalla
 * muestra el texto crudo del PAC sin inventarle una explicación.
 *
 * Los códigos de abajo salieron de respuestas REALES del sandbox o de rechazos
 * que le llegaron al bufete. Ninguno se copió de una tabla.
 */

export interface TraduccionDgi {
  /** Qué pasó, en una oración. */
  queePaso: string;
  /** Qué hay que hacer. Accionable, no descriptivo. */
  queHacer: string;
  /** Dónde se arregla, para que no haya que buscar. */
  donde: "ficha del cliente" | "la factura" | "el emisor" | "ningún lado";
}

/**
 * Los códigos que vimos de verdad.
 *
 * | código  | de dónde salió |
 * |---------|----------------|
 * | `1601`  | rechazo real del sandbox, 23/09/2026 |
 * | `1602`  | rechazo real del sandbox, 23/09/2026 |
 * | `1002`  | rechazo real del sandbox, 23/09/2026 |
 * | `10105` | rechazo real que recibió el bufete (descripción de 545 caracteres) |
 * | `0622`  | respuesta real del endpoint de anulación, 23/09/2026 |
 */
const CATALOGO: Record<string, TraduccionDgi> = {
  "1601": {
    queePaso: "La DGI dice que el RUC del cliente no está bien formado.",
    queHacer:
      "Revise el RUC y el dígito verificador (DV) en la ficha del cliente: que estén completos, " +
      "sin espacios de más y tal como figuran en el registro de la DGI. Después vuelva a enviar.",
    donde: "ficha del cliente",
  },
  "1602": {
    queePaso: "La DGI no encuentra el RUC del cliente en su registro de contribuyentes.",
    queHacer:
      "Verifique el RUC con el cliente — puede estar mal copiado, o el cliente puede no estar " +
      "inscrito ante la DGI. Corríjalo en la ficha del cliente y vuelva a enviar.",
    donde: "ficha del cliente",
  },
  "1002": {
    queePaso: "La DGI ya tiene un documento con este número.",
    queHacer:
      "No vuelva a enviarla todavía: puede estar autorizada. Revise en el portal de la DGI " +
      "si el documento ya existe antes de hacer nada.",
    donde: "ningún lado",
  },
  "10105": {
    queePaso:
      "La descripción de una de las líneas es más larga de lo que la DGI acepta (500 caracteres).",
    queHacer:
      "Acorte la descripción de la línea. El campo ahora muestra un contador: si está en rojo, " +
      "está pasada.",
    donde: "la factura",
  },
  "0622": {
    queePaso: "La DGI informa que este documento ya tiene un evento de anulación.",
    queHacer: "No hay nada que corregir: el documento ya está anulado ante la DGI.",
    donde: "ningún lado",
  },
};

/** Traduce un código. `null` si no lo conocemos — y eso NO es un error. */
export function traducirCodigoDgi(codigo: string | null | undefined): TraduccionDgi | null {
  const c = String(codigo ?? "").trim();
  return c ? (CATALOGO[c] ?? null) : null;
}

export interface CodigoDgi {
  codigo?: string;
  mensaje?: string;
}

export interface RechazoTraducido {
  /** El párrafo que se muestra grande. */
  resumen: string;
  /** Qué hacer, si lo sabemos. */
  queHacer: string | null;
  /** Dónde, si lo sabemos. */
  donde: TraduccionDgi["donde"] | null;
  /** 🔴 Lo que dijo el PAC, textual. NUNCA se pierde. */
  textoDelPac: string;
  /** `true` si ningún código del rechazo está en el catálogo. */
  sinTraduccion: boolean;
}

/**
 * Traduce un rechazo completo.
 *
 * Si hay varios códigos y **alguno** se conoce, se traduce el primero conocido:
 * `1601` y `1602` llegan juntos y dicen lo mismo desde dos ángulos, así que
 * mostrar las dos traducciones sería repetir. Los códigos crudos se muestran
 * todos igual, abajo.
 */
export function traducirRechazo(
  codigos: CodigoDgi[],
  nombreDelCliente?: string | null
): RechazoTraducido {
  const textoDelPac = codigos.length
    ? codigos
        .map((c) => `${c.codigo ? `[${c.codigo}] ` : ""}${c.mensaje ?? "(sin mensaje)"}`)
        .join(" · ")
    : "(el PAC no devolvió ningún detalle)";

  for (const c of codigos) {
    const t = traducirCodigoDgi(c.codigo);
    if (!t) continue;

    // El nombre del cliente entra sólo cuando el arreglo es en su ficha: sin
    // eso, "revise la ficha del cliente" obliga a acordarse de cuál.
    // El nombre reemplaza a "el cliente" genérico. Si algún texto del catálogo
    // no usa esa frase, el `includes` lo detecta y el nombre se agrega igual al
    // final en vez de perderse en silencio.
    let queHacer = t.queHacer;
    if (t.donde === "ficha del cliente" && nombreDelCliente) {
      queHacer = queHacer.includes("la ficha del cliente")
        ? queHacer.replace("la ficha del cliente", `la ficha de ${nombreDelCliente}`)
        : `${queHacer} (Cliente: ${nombreDelCliente}.)`;
    }

    return {
      resumen: t.queePaso,
      queHacer,
      donde: t.donde,
      textoDelPac,
      sinTraduccion: false,
    };
  }

  // 🔴 Ningún código conocido. No se inventa una explicación.
  return {
    resumen: "La DGI rechazó el documento, con un motivo que el sistema no tiene traducido.",
    queHacer: null,
    donde: null,
    textoDelPac,
    sinTraduccion: true,
  };
}
