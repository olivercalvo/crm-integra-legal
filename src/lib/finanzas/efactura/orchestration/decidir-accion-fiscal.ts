/**
 * ¿QUÉ SE PUEDE HACER CON ESTA FACTURA? — la matriz completa, como decisión pura.
 *
 * La matriz vivía en prosa, en `claude.md`, bajo "Estado futuro (Camino 2)".
 * Una tabla en un archivo .md no se puede probar, no falla cuando alguien la
 * contradice en una pantalla, y se copia mal. Acá está como una función sin
 * I/O, sin reloj propio y sin base de datos, que es la única forma de que la
 * pantalla, la ruta de API y el orquestador respondan lo mismo.
 *
 * ── DOS EJES, Y GANA SIEMPRE LA MÁS ESTRICTA (D2) ────────────────────────────
 *
 * |                        | Mes de `issue_date` ABIERTO        | Mes CERRADO |
 * |------------------------|------------------------------------|-------------|
 * | **Sin CUFE**           | 🔴 se PIDE el CUFE (ver abajo)      | se pide el CUFE |
 * | **Autorizada, < 182 h**| **anular en la DGI + en el libro** | **NC** — gana el mes cerrado |
 * | **Autorizada, ≥ 182 h**| **NC** — gana el plazo del PAC     | **NC** — coinciden |
 * | **Ya tiene NC**        | 🔴 no se anula nunca               | no se anula |
 *
 * Las dos celdas donde una regla pisa a la otra:
 *   · *< 182 h con el mes cerrado* → **gana el mes cerrado**. Es la regla del
 *     acta del 09/09 y es contable, no fiscal: anular reabriría un período que
 *     el contador ya certificó.
 *   · *≥ 182 h con el mes abierto* → **gana el plazo del PAC**. El libro
 *     dejaría; la DGI no.
 *
 * Y la fila que manda sobre todas: si la factura ya tiene una nota de crédito
 * con asiento, **no se anula nunca** (migración `053`, por el doble conteo).
 *
 * La forma de la implementación es esa misma idea: primero se resuelve el eje
 * fiscal, y después se juntan **todos** los motivos que impiden anular. Si hay
 * alguno, la acción es la nota de crédito y los motivos viajan con ella. Así
 * una factura que está fuera de plazo **y** con el mes cerrado **y** ya
 * acreditada no da tres respuestas distintas según el orden de los `if`.
 *
 * ── LAS DECISIONES QUE HAY DETRÁS ────────────────────────────────────────────
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
 * 4. EL ESTADO INTERMEDIO EXISTE Y TIENE NOMBRE (D4). Anular es PAC primero,
 *    libro después (D3): entre las dos cosas hay una ventana real en la que el
 *    documento está muerto ante la DGI y vivo en el libro. Esa combinación
 *    —`fe_estado = 'canceled'` con `status` distinto de `'anulada'`— devuelve
 *    `completar_anulacion_en_libro`, que es una acción de reintento, no un
 *    error. Se responde ANTES que cualquier bloqueo: una factura a medio anular
 *    hay que terminarla de anular aunque el mes se haya cerrado entre medio.
 *
 * El plazo de 90 días no es un límite del PAC —ideati fue explícito en que no
 * hay validación técnica entre factura y NC— sino de la declaración jurada de
 * ITBMS. Por eso viaja como ADVERTENCIA junto a la acción, nunca como un
 * bloqueo: quien decide si igual la emite es el contador.
 *
 * Referencias: `task_plan.md` (respuestas de ideati del 22/09/2026 y la
 * corrección del 23/09), `sop.md` SOP-038, `claude.md` §"Qué se puede hacer
 * ante la DGI con una factura emitida".
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
export interface EstadoDeFactura {
  /** `invoices.status`. */
  status: string;
  /** `invoices.fe_estado`. */
  feEstado: FeEstado;
  /** `invoices.dgi_cufe`. Presente ⇒ el documento existe ante la DGI. */
  dgiCufe: string | null;
  /** `invoices.issue_date`, `YYYY-MM-DD`. */
  issueDate: string | null;
  /** `invoices.dgi_fecha_autorizacion`, ISO con huso. */
  dgiFechaAutorizacion: string | null;
  /** `invoices.credited_total`. > 0 ⇒ ya tiene NC en el libro. */
  creditedTotal: number;
  /**
   * `invoices.amount_paid`. No es parte de la matriz de D2: es la regla que
   * `cancelInvoice` ya aplicaba. Viaja acá para que el diálogo no ofrezca un
   * botón que el servidor va a rechazar — ocultar la acción y devolver el 409
   * son las dos mitades de lo mismo.
   */
  amountPaid: number;
  /** ¿El período contable del mes de `issue_date` está cerrado? */
  mesCerrado: boolean;
}

export interface Ventana {
  /** Instante desde el que se cuentan las horas, ISO. */
  desde: string;
  /** Cuál de los dos candidatos se usó. */
  contadaDesde: "emision" | "autorizacion";
  horasTranscurridas: number;
  /** 0 cuando ya venció. */
  horasRestantes: number;
  vencida: boolean;
}

export type AccionSobreFactura =
  /** Dentro de plazo, mes abierto, sin NC ni cobros: PAC primero, libro después. */
  | { accion: "anular_en_dgi_y_libro"; cufe: string; ventana: Ventana; mensaje: string }
  /** No se anula: se acredita. `motivos` dice por qué, todos los que apliquen. */
  | {
      accion: "nc_04";
      cufe: string;
      ventana: Ventana;
      motivos: string[];
      mensaje: string;
      /** Aviso del plazo de ITBMS. No bloquea. */
      advertencia: string | null;
    }
  /** No hay CUFE guardado, y la base no alcanza para saber si existe uno. */
  | { accion: "nc_04_requiere_cufe"; motivos: string[]; mensaje: string }
  /** 🔴 Anulada ante la DGI, viva en el libro (D4). Acción de reintento. */
  | { accion: "completar_anulacion_en_libro"; cufe: string | null; mensaje: string }
  /** Hay cobros aplicados: se reversan antes de tocar nada. */
  | { accion: "reversar_cobros_primero"; mensaje: string }
  /** Hay un envío en curso: no se sabe si el documento llegó. */
  | { accion: "esperar_confirmacion"; mensaje: string }
  /** Ya está anulada de los dos lados, o no queda nada por hacer. */
  | { accion: "nada_que_hacer"; mensaje: string }
  /** Borrador o cancelada antes de emitir: no hay documento que corregir. */
  | { accion: "no_aplica"; mensaje: string }
  /** Los datos se contradicen. Nadie debería actuar sobre esto sin mirarlo. */
  | { accion: "inconsistente"; mensaje: string };

export type ClaveDeAccion = AccionSobreFactura["accion"];

/**
 * @param estado  Lo que la base sabe de la factura.
 * @param ahora   El instante contra el que se mide la ventana. **Se pasa
 *                siempre**: una función que lee el reloj por su cuenta no se
 *                puede probar y devuelve algo distinto cada día.
 */
export function decidirAccionFiscal(
  estado: EstadoDeFactura,
  ahora: Date
): AccionSobreFactura {
  const cufe = normalizar(estado.dgiCufe);

  // 0. Sin documento que corregir.
  if (estado.status === "borrador" || estado.status === "cancelada_pre_emision") {
    return {
      accion: "no_aplica",
      mensaje:
        "Esta factura todavía no se emitió: no hay nada que anular ni que acreditar. " +
        "Para descartarla está el botón Eliminar.",
    };
  }

  // 1. 🔴 EL ESTADO INTERMEDIO (D4), ANTES QUE CUALQUIER BLOQUEO.
    //    Anular es PAC primero, libro después: entre las dos cosas el documento
    //    está muerto ante la DGI y vivo en el libro. Terminar de anularlo es
    //    obligatorio aunque el mes se haya cerrado entre medio o aparezca una
    //    NC: dejarlo así es el único estado que no se puede explicar.
  if (estado.feEstado === "canceled" && estado.status !== "anulada") {
    return {
      accion: "completar_anulacion_en_libro",
      cufe,
      mensaje:
        "Esta factura ya fue anulada ante la DGI pero sigue viva en el libro contable. " +
        "Hay que completar la anulación: no emita cobros ni notas de crédito sobre ella " +
        "hasta que quede anulada de los dos lados.",
    };
  }

  // 2. Ya está anulada de los dos lados.
  if (estado.status === "anulada") {
    return {
      accion: "nada_que_hacer",
      mensaje:
        estado.feEstado === "canceled"
          ? "Esta factura ya está anulada, en el libro y ante la DGI."
          : "Esta factura ya está anulada en el libro.",
    };
  }

  // 3. Envío en curso. NO es "todavía no se mandó": es "se mandó y no sabemos
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

  // 4. Cobros aplicados. Bloquea anular Y acota la NC (el tope D7 es el saldo),
  //    así que se responde antes que la matriz: el paso siguiente es uno solo.
  if (estado.amountPaid > 0) {
    return {
      accion: "reversar_cobros_primero",
      mensaje:
        `Esta factura tiene B/. ${estado.amountPaid.toFixed(2)} en cobros aplicados. ` +
        "Reverse o elimine los cobros antes de anularla o acreditarla.",
    };
  }

  // 5. Contradicción: autorizada pero sin CUFE. El CUFE es lo que devuelve la
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

  // 6. Los motivos que impiden ANULAR, todos juntos. Acá está "gana siempre la
  //    más estricta": no importa el orden en que se evalúen, porque no se
  //    devuelve el primero que aparece — se devuelven todos.
  const motivos: string[] = [];
  if (estado.creditedTotal > 0) {
    motivos.push(
      `ya tiene B/. ${estado.creditedTotal.toFixed(2)} acreditados por nota de crédito`
    );
  }
  if (estado.mesCerrado) {
    motivos.push("el mes de la factura está cerrado");
  }

  // 7. Sin CUFE: puede ser una factura que nunca llegó a la DGI, o una emitida
  //    a mano en el portal de ideati (punto 050) cuyo CUFE el CRM no guardó.
  //    Se ven igual. Se pide el dato en vez de inventarlo.
  if (!cufe) {
    return {
      accion: "nc_04_requiere_cufe",
      motivos,
      mensaje:
        "Esta factura no tiene CUFE guardado en el CRM. Si se emitió a mano en el portal " +
        "de ideati (punto 050), el CUFE existe y hay que traerlo de ahí para emitir la nota " +
        "de crédito referenciándolo. Si nunca se envió a la DGI, indíquelo para seguir por " +
        "el camino de nota de crédito genérica.",
    };
  }

  // 8. Hay CUFE ⇒ el documento existe ante la DGI. Entra la ventana.
  const ventana = calcularVentana(estado, ahora);
  if (!ventana) {
    return {
      accion: "inconsistente",
      mensaje:
        "No se pudo determinar desde cuándo contar el plazo de anulación: la factura no " +
        "tiene una fecha válida. Revise la factura antes de actuar.",
    };
  }
  if (ventana.vencida) {
    motivos.push(`venció el plazo de ${HORAS_PARA_ANULAR} horas para anular ante la DGI`);
  }

  if (motivos.length === 0) {
    return {
      accion: "anular_en_dgi_y_libro",
      cufe,
      ventana,
      mensaje:
        `Se puede anular ante la DGI y en el libro. Quedan ` +
        `${formatearHoras(ventana.horasRestantes)} de las ${HORAS_PARA_ANULAR} horas del plazo.`,
    };
  }

  return {
    accion: "nc_04",
    cufe,
    ventana,
    motivos,
    mensaje:
      `Esta factura no se anula: ${unirMotivos(motivos)}. La corrección es una nota de ` +
      `crédito con fecha de hoy, que referencia el CUFE de esta factura.`,
    advertencia: advertenciaDePlazoItbms(ventana),
  };
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

function calcularVentana(estado: EstadoDeFactura, ahora: Date): Ventana | null {
  const desdeEmision = instanteDeEmision(estado.issueDate);
  const desdeAutorizacion = instanteISO(estado.dgiFechaAutorizacion);

  // Se usa el candidato elegido; si falta, se cae al otro antes de rendirse.
  const elegido =
    INSTANTE_DE_INICIO === "emision"
      ? (desdeEmision ?? desdeAutorizacion)
      : (desdeAutorizacion ?? desdeEmision);
  if (elegido === null) return null;

  const contadaDesde: "emision" | "autorizacion" =
    elegido === desdeEmision ? "emision" : "autorizacion";

  const transcurridas = (ahora.getTime() - elegido) / MS_POR_HORA;
  const restantes = HORAS_PARA_ANULAR - transcurridas;

  return {
    desde: new Date(elegido).toISOString(),
    contadaDesde,
    horasTranscurridas: redondear(Math.max(0, transcurridas)),
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

function unirMotivos(motivos: string[]): string {
  if (motivos.length === 1) return motivos[0];
  return motivos.slice(0, -1).join(", ") + " y " + motivos[motivos.length - 1];
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
