/**
 * ¿QUÉ SE PUEDE HACER ANTE LA DGI CON ESTA FACTURA? — decisión pura.
 *
 * La matriz vivía en prosa, en `claude.md`, bajo "Estado futuro (Camino 2)".
 * Una tabla en un archivo .md no se puede probar, no falla cuando alguien la
 * contradice en una pantalla, y se copia mal. Acá está la misma matriz como una
 * función sin I/O, sin reloj propio y sin base de datos, que es la única forma
 * de que la pantalla, la ruta de API y el orquestador respondan lo mismo.
 *
 * ESTO DECIDE LO FISCAL, NO LO INTERNO. Si la factura se puede anular en el CRM
 * —que no tenga cobros aplicados, que el mes de `issue_date` esté abierto, que
 * no tenga ya una nota de crédito en el libro— lo sigue decidiendo
 * `cancelInvoice`. Las dos preguntas son distintas y se responden por separado:
 * una factura puede estar perfectamente anulable de nuestro lado y aun así
 * llevar 200 horas autorizada ante la DGI, que es justo el caso que obliga a
 * emitir una nota de crédito en vez de anular.
 *
 * ── LAS TRES DECISIONES QUE HAY DETRÁS ────────────────────────────────────
 *
 * 1. LA VENTANA SE CUENTA DESDE LA FECHA DE EMISIÓN, NO DESDE LA AUTORIZACIÓN.
 *    ideati (22/09/2026) confirmó el plazo —182 horas— pero NO dijo desde
 *    cuándo se cuenta. Hay dos candidatos, `issue_date` y
 *    `dgi_fecha_autorizacion`, y se toma el que cierra la ventana ANTES. Si la
 *    ventana real resultara más larga, lo peor que pasa es que ofrecemos una
 *    nota de crédito donde todavía se podía anular; al revés, ofreceríamos un
 *    botón que la DGI va a rechazar. El rechazo del PAC queda como respaldo.
 *    Cuando ideati lo precise, se cambia `INSTANTE_DE_INICIO` y nada más.
 *
 * 2. 🔴 "SIN CUFE" NO SIGNIFICA "NUNCA LLEGÓ A LA DGI", Y ESTA FUNCIÓN NO LO
 *    ADIVINA. Las facturas del bufete anteriores al 8 de julio de 2026 se
 *    emitieron a mano en el portal de ideati, por el punto de facturación
 *    `050`: tienen CUFE ante la DGI, pero el CRM nunca lo guardó. En la base se
 *    ven EXACTAMENTE igual que una que jamás se envió —`fe_estado`
 *    `'no_emitida'`, `dgi_cufe` nulo, `punto_facturacion` nulo— porque el
 *    portal es un camino que el CRM no registra.
 *
 *    Así que para ese caso la respuesta es `nc_04_requiere_cufe`: una acción
 *    que PIDE el CUFE en lugar de inventarlo. No se usa una fecha de corte para
 *    decidirlo. Una fecha hardcodeada resolviendo una acción fiscal es
 *    exactamente el tipo de supuesto que seis meses después nadie recuerda que
 *    era un supuesto, y el error no se ve: sale una nota de crédito genérica
 *    donde iba una `04` con referencia, y eso se descubre en una auditoría.
 *
 * 3. `'pending'` NO ES "TODAVÍA NO SE MANDÓ": es "se mandó y no sabemos cómo
 *    terminó". Decidir cualquier cosa ahí es apostar. Se espera al
 *    reconciliador.
 *
 * El plazo de 90 días no es un límite del PAC —ideati fue explícito en que no
 * hay validación técnica entre factura y NC— sino de la declaración jurada de
 * ITBMS. Por eso viaja como ADVERTENCIA junto a la acción, nunca como un
 * bloqueo: quien decide si igual la emite es el contador.
 *
 * Referencias: `task_plan.md` (respuestas de ideati del 22/09/2026 y la
 * corrección del 23/09), `sop.md` SOP-038, `claude.md` §"Estado futuro".
 */

/** Ventana de anulación ante la DGI. ideati, 22/09/2026. */
export const HORAS_PARA_ANULAR = 182;

/**
 * Desde cuándo se cuentan esas horas. `emision` es el supuesto conservador
 * descrito arriba; `autorizacion` queda escrito para el día que ideati precise
 * el dato. Cambiar esta constante mueve la matriz entera y ningún llamador.
 */
const INSTANTE_DE_INICIO: "emision" | "autorizacion" = "emision";

/**
 * Tope de la declaración jurada de ITBMS. NO bloquea: advierte.
 * ideati, 22/09/2026: entre factura y NC no hay validación técnica de plazo.
 */
export const DIAS_PARA_NC_SIN_OBSERVACION = 90;

/** Panamá no tiene horario de verano: el desfase es fijo. */
const HUSO_PANAMA = "-05:00";

const MS_POR_HORA = 3_600_000;

export type FeEstado = "no_emitida" | "pending" | "authorized" | "canceled" | "error";

/** Lo que la base sabe de la factura. Nada más que esto entra a la decisión. */
export interface EstadoFiscalDeFactura {
  /** `invoices.fe_estado`. */
  feEstado: FeEstado;
  /** `invoices.dgi_cufe`. Presente ⇒ el documento existe ante la DGI. */
  dgiCufe: string | null;
  /** `invoices.issue_date`, `YYYY-MM-DD`. */
  issueDate: string | null;
  /** `invoices.dgi_fecha_autorizacion`, ISO con huso. */
  dgiFechaAutorizacion: string | null;
}

export interface Ventana {
  /** Instante desde el que se cuentan las horas, ISO. */
  desde: string;
  /** Cuál de los dos candidatos se usó, y por qué. */
  contadaDesde: "emision" | "autorizacion";
  horasTranscurridas: number;
  /** 0 cuando ya venció. */
  horasRestantes: number;
  vencida: boolean;
}

export type AccionFiscal =
  /** Hay CUFE y la ventana sigue abierta → POST /InvoiceEvents/CreateCancellation. */
  | { accion: "anular_en_dgi"; cufe: string; ventana: Ventana; mensaje: string }
  /** Hay CUFE y la ventana venció → nota de crédito `04` referenciando ese CUFE. */
  | {
      accion: "nc_04";
      cufe: string;
      ventana: Ventana;
      mensaje: string;
      /** Aviso del plazo de ITBMS. No bloquea. */
      advertencia: string | null;
    }
  /** No hay CUFE guardado, y la base no alcanza para saber si existe uno. */
  | { accion: "nc_04_requiere_cufe"; mensaje: string }
  /** Hay un envío en curso: no se sabe si el documento llegó. */
  | { accion: "esperar_confirmacion"; mensaje: string }
  /** Ya está anulada ante la DGI: no queda nada que mandar. */
  | { accion: "ya_anulada_en_dgi"; mensaje: string }
  /** Los datos se contradicen. Nadie debería actuar sobre esto sin mirarlo. */
  | { accion: "inconsistente"; mensaje: string };

export type ClaveDeAccionFiscal = AccionFiscal["accion"];

/**
 * @param estado  Lo que la base sabe de la factura.
 * @param ahora   El instante contra el que se mide la ventana. **Se pasa
 *                siempre**: una función que lee el reloj por su cuenta no se
 *                puede probar y devuelve algo distinto cada día.
 */
export function decidirAccionFiscal(
  estado: EstadoFiscalDeFactura,
  ahora: Date
): AccionFiscal {
  // 1. Ya anulada ante la DGI: no hay segunda anulación.
  if (estado.feEstado === "canceled") {
    return {
      accion: "ya_anulada_en_dgi",
      mensaje: "Esta factura ya fue anulada ante la DGI. No queda nada por enviar.",
    };
  }

  // 2. Envío en curso. NO es "todavía no se mandó": es "se mandó y no sabemos
  //    cómo terminó". Anular acá puede anular un documento que no existe, o
  //    dejar vivo uno que sí.
  if (estado.feEstado === "pending") {
    return {
      accion: "esperar_confirmacion",
      mensaje:
        "Hay un envío a la DGI sin resolver. Hasta saber si el documento quedó autorizado " +
        "no se puede decidir si corresponde anularlo o emitir una nota de crédito.",
    };
  }

  const cufe = normalizar(estado.dgiCufe);

  // 3. Contradicción: autorizada pero sin CUFE. El CUFE es lo que devuelve la
  //    autorización; si falta, alguien escribió el estado a mano o un envío
  //    quedó a medias. No se adivina.
  if (estado.feEstado === "authorized" && !cufe) {
    return {
      accion: "inconsistente",
      mensaje:
        "La factura figura autorizada por la DGI pero no tiene CUFE guardado. " +
        "Revise el registro de envíos antes de anular o acreditar.",
    };
  }

  // 4. Sin CUFE. Acá está el punto 2 del encabezado: puede ser una factura que
  //    nunca llegó a la DGI, o una emitida a mano en el portal de ideati (punto
  //    050) cuyo CUFE el CRM no guardó. Se ven igual. Se pide el dato.
  if (!cufe) {
    return {
      accion: "nc_04_requiere_cufe",
      mensaje:
        "Esta factura no tiene CUFE guardado en el CRM. Si se emitió a mano en el portal " +
        "de ideati (punto 050), el CUFE existe y hay que traerlo de ahí para emitir la nota " +
        "de crédito referenciándolo. Si nunca se envió a la DGI, indíquelo para seguir por " +
        "el camino de nota de crédito genérica.",
    };
  }

  // 5. Hay CUFE ⇒ el documento existe ante la DGI. Manda la ventana.
  const ventana = calcularVentana(estado, ahora);
  if (!ventana) {
    return {
      accion: "inconsistente",
      mensaje:
        "No se pudo determinar desde cuándo contar el plazo de anulación: la factura no " +
        "tiene una fecha válida. Revise la factura antes de actuar.",
    };
  }

  if (!ventana.vencida) {
    return {
      accion: "anular_en_dgi",
      cufe,
      ventana,
      mensaje:
        `Se puede anular ante la DGI. Quedan ${formatearHoras(ventana.horasRestantes)} ` +
        `de las ${HORAS_PARA_ANULAR} horas del plazo.`,
    };
  }

  return {
    accion: "nc_04",
    cufe,
    ventana,
    mensaje:
      `El plazo de ${HORAS_PARA_ANULAR} horas para anular ante la DGI venció ` +
      `(pasaron ${formatearHoras(ventana.horasTranscurridas)}). La corrección es una nota ` +
      `de crédito que referencia el CUFE de esta factura.`,
    advertencia: advertenciaDePlazoItbms(ventana),
  };
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

function calcularVentana(estado: EstadoFiscalDeFactura, ahora: Date): Ventana | null {
  const preferida = INSTANTE_DE_INICIO;

  const desdeEmision = instanteDeEmision(estado.issueDate);
  const desdeAutorizacion = instanteISO(estado.dgiFechaAutorizacion);

  // Se usa el candidato elegido; si falta, se cae al otro antes de rendirse.
  const elegido =
    preferida === "emision"
      ? (desdeEmision ?? desdeAutorizacion)
      : (desdeAutorizacion ?? desdeEmision);
  if (elegido === null) return null;

  const contadaDesde: "emision" | "autorizacion" =
    elegido === desdeEmision ? "emision" : "autorizacion";

  const transcurridas = (ahora.getTime() - elegido) / MS_POR_HORA;
  const horasTranscurridas = redondear(Math.max(0, transcurridas));
  const restantes = HORAS_PARA_ANULAR - transcurridas;

  return {
    desde: new Date(elegido).toISOString(),
    contadaDesde,
    horasTranscurridas,
    horasRestantes: redondear(Math.max(0, restantes)),
    // Estrictamente mayor: a las 182 horas exactas todavía no venció.
    vencida: transcurridas > HORAS_PARA_ANULAR,
  };
}

/**
 * `issue_date` es una fecha sin hora. Se toma el ARRANQUE del día en hora de
 * Panamá, que es el instante que hace vencer la ventana lo antes posible —
 * mismo criterio conservador del punto 1 del encabezado.
 */
function instanteDeEmision(issueDate: string | null): number | null {
  const s = normalizar(issueDate);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00${HUSO_PANAMA}`);
  return Number.isNaN(t) ? null : t;
}

function instanteISO(iso: string | null): number | null {
  const s = normalizar(iso);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function advertenciaDePlazoItbms(ventana: Ventana): string | null {
  const dias = ventana.horasTranscurridas / 24;
  if (dias <= DIAS_PARA_NC_SIN_OBSERVACION) return null;
  return (
    `Pasaron ${Math.floor(dias)} días desde la factura. La DGI no rechaza una nota de ` +
    `crédito por el plazo, pero para la declaración jurada de ITBMS el límite práctico son ` +
    `${DIAS_PARA_NC_SIN_OBSERVACION} días: confírmelo con el contador antes de emitirla.`
  );
}

function normalizar(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function redondear(h: number): number {
  return Math.round(h * 10) / 10;
}

function formatearHoras(h: number): string {
  if (h < 1) return "menos de 1 hora";
  const entero = Math.floor(h);
  return entero === 1 ? "1 hora" : `${entero} horas`;
}
