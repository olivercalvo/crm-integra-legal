/**
 * ANULAR UNA FACTURA ANTE LA DGI, Y DESPUÉS EN EL LIBRO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL ORDEN ES PAC PRIMERO, LIBRO DESPUÉS (D3), Y NO ES REVERSIBLE
 * ─────────────────────────────────────────────────────────────────────────────
 * Las dos cosas pueden fallar, así que la pregunta es cuál de los dos estados a
 * medias preferimos:
 *
 *   · **Libro primero** → la factura queda anulada en nuestros libros y viva
 *     ante la DGI. El contador certifica un libro que no coincide con lo que la
 *     DGI tiene, y nadie se entera hasta la declaración. Para arreglarlo hay que
 *     deshacer una reversión que es inmutable por diseño (`023`): no se puede.
 *
 *   · **PAC primero** → el documento queda anulado ante la DGI y vivo en el
 *     libro. Se ve, se explica, y se termina de anular con un botón. El asiento
 *     de reversión todavía no existe, así que no hay nada inmutable que deshacer.
 *
 * El segundo es recuperable y el primero no. Por eso el PAC va primero, y por
 * eso el estado intermedio tiene nombre propio (`completar_anulacion_en_libro`
 * en `decidirAccionFiscal`) en vez de ser "un error raro".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 LOS TRES CAMINOS DE FALLA, Y QUÉ SE ESCRIBE EN CADA UNO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   1. **LA DGI RECHAZA** (fuera de plazo, CUFE que no reconoce, motivo que no
 *      le sirve). No se escribe NADA fuera del registro del intento. La factura
 *      queda exactamente como estaba y la persona ve el motivo del rechazo con
 *      su próximo paso.
 *
 *   2. **NO SABEMOS SI LLEGÓ** (se cortó la red, o el PAC contestó algo que el
 *      clasificador no reconoce). Tampoco se escribe nada en la factura ni en
 *      el libro. Se guarda el intento con `sin_respuesta` / `indeterminada` y
 *      **el caso escala a una persona**. No hay reintento automático, y no lo
 *      hay porque hoy no se puede leer con certeza si un documento está anulado
 *      del lado del PAC (ver `anulacion-en-pac.ts`: `anulado` devuelve `null`
 *      hasta la prueba de sandbox (b)). Reintentar a ciegas sobre un endpoint
 *      del que no sabemos si es idempotente es la peor opción disponible.
 *
 *   3. **LA DGI ANULÓ PERO EL LIBRO FALLÓ.** Es el estado intermedio de D4.
 *      `fe_estado` ya quedó en `'canceled'` —se escribe ANTES de tocar el
 *      libro, a propósito— así que la pantalla lo detecta, lo muestra con la
 *      banda roja, bloquea cobros y notas de crédito, y ofrece terminar la
 *      anulación. Si ese UPDATE previo no existiera, una caída entre el PAC y
 *      el libro dejaría una factura anulada ante la DGI **sin una sola marca en
 *      nuestra base**: indistinguible de una que nunca se tocó.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE MÓDULO NO DECIDE
 * ─────────────────────────────────────────────────────────────────────────────
 * Si corresponde anular o emitir una nota de crédito lo decide
 * `decidirAccionFiscal` (SOP-038), que es pura. Acá sólo se ejecuta la acción
 * que esa función habilitó, y se vuelve a pedir su veredicto en T0 — no se
 * confía en lo que la pantalla creía cuando se apretó el botón.
 *
 * La reversión del asiento y la nota de crédito total las sigue haciendo
 * `cancelInvoice` (RPC `cancel_invoice_with_reversal`, `052`/`053`), sin
 * cambios. Este módulo le agrega la mitad fiscal por delante.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { cancelInvoice, periodoDeLaFacturaCerrado } from "@/lib/finanzas/api/invoices";
import { loadEmisorConfig } from "@/lib/finanzas/efactura/config/emisor-config";
import {
  decidirAccionFiscal,
  type EstadoDeFactura,
  type FeEstado,
} from "@/lib/finanzas/efactura/orchestration/decidir-accion-fiscal";
import { clasificarRespuestaDeAnulacion } from "@/lib/finanzas/efactura/orchestration/clasificar-respuesta-de-anulacion";
import {
  anularEnPac,
  consultarEstadoEnPac,
  leerEstadoDelDocumento,
} from "@/lib/finanzas/efactura/transport/anulacion-en-pac";
import { validarMotivoDeAnulacion } from "@/lib/finanzas/validators/cancel-invoice";

type DB = SupabaseClient;

export type ResultadoDeAnulacionFiscal =
  /** Anulada ante la DGI y en el libro. El camino feliz. */
  | {
      estado: "anulada";
      mensaje: string;
      credit_note_id: string | null;
      credit_note_number: string | null;
      reversal_entry_number: number | null;
    }
  /** 🔴 Estado intermedio (D4): muerta ante la DGI, viva en el libro. */
  | { estado: "anulada_en_dgi_falta_el_libro"; mensaje: string; detalle: string }
  /** La DGI rechazó. Nada cambió. */
  | { estado: "rechazada_por_la_dgi"; mensaje: string; pista: string | null }
  /** No sabemos si llegó. Nada cambió. Escala a una persona. */
  | { estado: "no_sabemos"; mensaje: string; intento: number };

/**
 * @param db        Cliente de la sesión (lecturas y escrituras bajo RLS).
 * @param ledgerDb  Cliente de SERVICIO. Lo exige `cancelInvoice` (SOP-014):
 *                  desde la `030` el RPC del libro no corre bajo la sesión.
 * @param ahora     El instante contra el que se mide la ventana de 182 h. Se
 *                  pasa siempre, por la misma razón que en `decidirAccionFiscal`.
 */
export async function anularFacturaAnteDgi(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  invoiceId: string,
  motivoCrudo: unknown,
  observations: string | null,
  ahora: Date
): Promise<ResultadoDeAnulacionFiscal> {
  // ---------------------------------------------------------------------------
  // T0 — Qué se puede hacer con esta factura. Se vuelve a preguntar acá: lo que
  //      la pantalla creía cuando se apretó el botón puede haber cambiado.
  // ---------------------------------------------------------------------------
  const estado = await cargarEstadoDeFactura(db, tenantId, invoiceId);
  const accion = decidirAccionFiscal(estado, ahora);

  // Las tres acciones que terminan en una factura anulada. Escritas una por una
  // y no con un `includes`, porque así TypeScript estrecha el tipo y los
  // `accion.cufe` de más abajo dejan de necesitar un cast.
  if (
    accion.accion !== "anular_en_dgi_y_libro" &&
    accion.accion !== "anular_solo_en_el_libro" &&
    accion.accion !== "completar_anulacion_en_libro"
  ) {
    // El mensaje de la matriz ya explica el caso y el próximo paso: no se
    // reescribe acá, para que la pantalla y el servidor digan lo mismo.
    throw new MutationError(accion.mensaje, 409);
  }

  // ---------------------------------------------------------------------------
  // T0.b — El motivo. Mismo validador que la ruta y que el CHECK de la `058`.
  // ---------------------------------------------------------------------------
  const validado = validarMotivoDeAnulacion(motivoCrudo);
  if (!validado.ok) {
    throw new MutationError(validado.mensaje, 400);
  }
  const motivo = validado.motivo;

  // ---------------------------------------------------------------------------
  // CAMINO CORTO — la factura YA está anulada ante la DGI y sólo falta el libro.
  //   Es el reintento del estado intermedio. No se vuelve a llamar al PAC: el
  //   documento ya está muerto ahí, y pedirlo de nuevo sobre un endpoint que no
  //   sabemos si es idempotente sólo puede empeorar las cosas.
  // ---------------------------------------------------------------------------
  if (accion.accion === "completar_anulacion_en_libro") {
    return await cerrarEnElLibro(db, ledgerDb, tenantId, userId, invoiceId, motivo, observations);
  }

  // ---------------------------------------------------------------------------
  // CAMINO SIN CUFE — se anula SÓLO en el libro, que es lo que el CRM hace hoy.
  //   No hay a quién pedirle la anulación: no tenemos CUFE. La advertencia de
  //   la matriz —que el documento puede seguir vivo ante la DGI si se emitió a
  //   mano por el portal— es lo que la pantalla ya muestra con su checkbox.
  //   Esta rama existe para que el comportamiento actual NO cambie: quitarla
  //   convertiría en imposible algo que hoy funciona, y eso es una decisión de
  //   política del bufete, no de este archivo.
  // ---------------------------------------------------------------------------
  if (accion.accion === "anular_solo_en_el_libro") {
    return await cerrarEnElLibro(db, ledgerDb, tenantId, userId, invoiceId, motivo, observations);
  }

  // ---------------------------------------------------------------------------
  // T1 — El registro del intento, ANTES de salir a la red.
  //      Misma razón que el INSERT de `fe_emisiones` antes del POST: si el
  //      proceso se muere en la llamada, tiene que quedar rastro de que se
  //      pidió. `sin_respuesta` es el estado honesto de arranque.
  // ---------------------------------------------------------------------------
  const emisor = loadEmisorConfig();
  const intento = await proximoIntento(db, tenantId, invoiceId);
  const pedido = { cufe: accion.cufe, cancellationReason: motivo };

  const { data: filaIntento, error: errIntento } = await db
    .from("fe_anulaciones")
    .insert({
      tenant_id: tenantId,
      invoice_id: invoiceId,
      intento,
      cufe: accion.cufe,
      motivo,
      request_payload: pedido,
      resultado: "sin_respuesta",
      i_amb: emisor.iAmb,
      created_by: userId,
    })
    .select("id")
    .single();

  if (errIntento || !filaIntento) {
    throw new MutationError(pgErrorToMessage(errIntento), 500, errIntento);
  }
  const intentoId = filaIntento.id as string;

  // ---------------------------------------------------------------------------
  // T2 — El POST al PAC.
  // ---------------------------------------------------------------------------
  let respuesta: unknown;
  try {
    respuesta = await anularEnPac(pedido);
  } catch (err) {
    // CAMINO DE FALLA 2 — no sabemos si llegó. NO se toca la factura ni el libro.
    const detalle = err instanceof Error ? err.message : String(err);
    await cerrarIntento(db, tenantId, intentoId, "sin_respuesta", {
      _meta: { error: recortar(detalle, 500) },
    });
    return {
      estado: "no_sabemos",
      intento,
      mensaje:
        "No se pudo confirmar si la DGI recibió la anulación: la comunicación se cortó. " +
        "La factura NO se modificó. Antes de reintentar hay que verificar en el portal de " +
        "la DGI si el documento quedó anulado — pedirlo dos veces sobre un documento que ya " +
        "está anulado puede dar un error que tape el estado real. Detalle: " +
        recortar(detalle, 200),
    };
  }

  const clasificacion = clasificarRespuestaDeAnulacion(respuesta);

  // ---------------------------------------------------------------------------
  // CAMINO DE FALLA 1 — la DGI rechazó. Nada cambió.
  // ---------------------------------------------------------------------------
  if (clasificacion.clase === "rechazada") {
    await cerrarIntento(db, tenantId, intentoId, "rechazada", respuesta);
    return {
      estado: "rechazada_por_la_dgi",
      mensaje: `La DGI rechazó la anulación. ${clasificacion.mensaje}`,
      pista: clasificacion.pista,
    };
  }

  // ---------------------------------------------------------------------------
  // CAMINO DE FALLA 2 (bis) — contestó algo que no reconocemos.
  //   D3: antes de decidir nada, se consulta el estado del documento. Hoy esa
  //   consulta no puede afirmar si está anulado (`anulado === null` hasta la
  //   prueba de sandbox (b)), así que el caso escala. La consulta se hace igual
  //   y su respuesta se guarda: es la evidencia que esa prueba necesita.
  // ---------------------------------------------------------------------------
  if (clasificacion.clase === "indeterminada") {
    const consulta = await consultarEstadoSinRomper(accion.cufe);
    await cerrarIntento(db, tenantId, intentoId, "indeterminada", {
      respuesta,
      _consulta_de_estado: consulta?.crudo ?? null,
      _meta: {
        anulado_segun_hipotesis: consulta?.anuladoSegunHipotesis ?? null,
        deleted_date: consulta?.deletedDate ?? null,
        autorizada: consulta?.autorizada ?? null,
      },
    });

    return {
      estado: "no_sabemos",
      intento,
      mensaje:
        "La DGI contestó algo que el sistema no puede interpretar, así que NO se modificó " +
        "nada: la factura sigue emitida y el libro sin tocar. Verifique en el portal de la " +
        "DGI si el documento quedó anulado y avise a soporte con el número de esta factura. " +
        clasificacion.mensaje,
    };
  }

  // ---------------------------------------------------------------------------
  // T3 — La DGI anuló (o dice que ya estaba anulada, que para nosotros es lo
  //      mismo: el documento está muerto allá).
  //
  //      🔴 `fe_estado = 'canceled'` SE ESCRIBE ACÁ, ANTES DE TOCAR EL LIBRO.
  //      Es lo único que convierte una caída en un estado recuperable. Sin este
  //      UPDATE, morirse en la línea siguiente dejaría una factura anulada ante
  //      la DGI sin una sola marca en nuestra base.
  // ---------------------------------------------------------------------------
  await cerrarIntento(db, tenantId, intentoId, clasificacion.clase, respuesta);

  const { error: errMarca } = await db
    .from("invoices")
    .update({ fe_estado: "canceled" as FeEstado })
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId);

  if (errMarca) {
    // El documento ya está anulado en la DGI y no pudimos ni marcarlo. Es el
    // peor caso posible y por eso el mensaje nombra el registro del intento,
    // que sí quedó guardado.
    throw new MutationError(
      "La DGI anuló el documento pero no se pudo registrar en el CRM. NO reintente: " +
        `el documento ya está anulado ante la DGI (intento #${intento}). Avise a soporte. ` +
        pgErrorToMessage(errMarca),
      500,
      errMarca
    );
  }

  // ---------------------------------------------------------------------------
  // T4 — El libro. Si falla, queda el estado intermedio de D4 (camino 3).
  // ---------------------------------------------------------------------------
  return await cerrarEnElLibro(db, ledgerDb, tenantId, userId, invoiceId, motivo, observations);
}

// ---------------------------------------------------------------------------
// Partes
// ---------------------------------------------------------------------------

/**
 * La mitad contable: nota de crédito total + reversión del asiento + `anulada`,
 * en una transacción, con `cancelInvoice` sin cambios.
 *
 * Si falla, NO se relanza: se devuelve el estado intermedio. Es deliberado —
 * un 500 acá haría creer que no pasó nada, cuando en realidad el documento ya
 * está anulado ante la DGI y lo que falta es un paso que se puede reintentar.
 */
async function cerrarEnElLibro(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  invoiceId: string,
  motivo: string,
  observations: string | null
): Promise<ResultadoDeAnulacionFiscal> {
  try {
    const r = await cancelInvoice(db, ledgerDb, tenantId, userId, invoiceId, motivo, observations);
    return {
      estado: "anulada",
      mensaje: "Factura anulada ante la DGI y en el libro contable.",
      credit_note_id: r.credit_note_id ?? null,
      credit_note_number: r.credit_note_number ?? null,
      reversal_entry_number: r.reversal_entry_number ?? null,
    };
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    return {
      estado: "anulada_en_dgi_falta_el_libro",
      mensaje:
        "El documento quedó ANULADO ante la DGI, pero la anulación en el libro contable " +
        "no se completó. La factura no acepta cobros ni notas de crédito en este estado. " +
        "Use «Completar anulación» para terminarla.",
      detalle: recortar(detalle, 400),
    };
  }
}

async function cargarEstadoDeFactura(
  db: DB,
  tenantId: string,
  invoiceId: string
): Promise<EstadoDeFactura> {
  const { data, error } = await db
    .from("invoices")
    .select(
      "id, status, fe_estado, dgi_cufe, issue_date, dgi_fecha_autorizacion, credited_total, amount_paid"
    )
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  if (!data) throw new MutationError("Factura no encontrada", 404);

  const issueDate = data.issue_date ? String(data.issue_date) : null;

  return {
    status: String(data.status),
    feEstado: (data.fe_estado as FeEstado) ?? "no_emitida",
    dgiCufe: (data.dgi_cufe as string | null) ?? null,
    issueDate,
    dgiFechaAutorizacion: (data.dgi_fecha_autorizacion as string | null) ?? null,
    creditedTotal: Number(data.credited_total ?? 0),
    amountPaid: Number(data.amount_paid ?? 0),
    mesCerrado: issueDate ? await periodoDeLaFacturaCerrado(db, tenantId, issueDate) : false,
  };
}

async function proximoIntento(db: DB, tenantId: string, invoiceId: string): Promise<number> {
  const { data, error } = await db
    .from("fe_anulaciones")
    .select("intento")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("intento", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  return data ? Number(data.intento) + 1 : 1;
}

/**
 * Cierra el registro del intento con lo que contestó el PAC. Un fallo acá se
 * loguea y NO corta: el registro es la memoria del proceso, no su permiso, y
 * perderlo no puede impedir que la anulación termine.
 */
async function cerrarIntento(
  db: DB,
  tenantId: string,
  intentoId: string,
  resultado: string,
  respuesta: unknown
): Promise<void> {
  const { error } = await db
    .from("fe_anulaciones")
    .update({ resultado, response_payload: respuesta as object })
    .eq("tenant_id", tenantId)
    .eq("id", intentoId);
  if (error) {
    console.error("[efactura/anulacion] no se pudo cerrar el intento", error);
  }
}

/** La consulta de estado nunca puede tumbar el flujo: es información extra. */
async function consultarEstadoSinRomper(cufe: string) {
  try {
    return leerEstadoDelDocumento(await consultarEstadoEnPac(cufe));
  } catch (err) {
    console.error("[efactura/anulacion] falló la consulta de estado", err);
    return null;
  }
}

function recortar(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}
