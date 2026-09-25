/**
 * REVERSAR UNA NOTA DE CRÉDITO: ANTE LA DGI PRIMERO SI HACE FALTA, Y EN EL LIBRO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE (25/09/2026)
 * ─────────────────────────────────────────────────────────────────────────────
 * Desde 9C la NC se manda a la DGI, y `decidirAccionSobreNotaDeCredito` ya
 * decía `anular_en_dgi_y_libro` para una NC autorizada dentro de las 182 h.
 * Pero nadie lo ejecutaba: «Reversar» llamaba a `reverseCreditNote`, que sólo
 * toca el libro. Una NC autorizada quedaba anulada en nuestros libros y VIVA
 * ante la DGI, que es justamente el estado que D3 prohíbe para las facturas: la
 * reversión del libro es inmutable y no se deshace. Lo encontró la verificación
 * con clics (NC-000016).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL ORDEN ES EL DE LA FACTURA (D3), Y POR LA MISMA RAZÓN
 * ─────────────────────────────────────────────────────────────────────────────
 *   T0  la matriz decide, otra vez acá (no se confía en la pantalla).
 *   T1  el intento se registra en `fe_anulaciones` ANTES del POST.
 *   T2  el POST al PAC.
 *   T3  si la DGI anuló: `credit_notes.fe_estado = 'canceled'` ANTES del libro.
 *   T4  el libro: `reverseCreditNote` (RPC `reverse_credit_note`, `060`).
 *
 * Los tres caminos de falla son los de la factura y dejan lo mismo: la DGI
 * rechaza → nada cambió; no sabemos si llegó → nada cambió; la DGI anuló y el
 * libro falló → `fe_estado = 'canceled'` con la NC viva en el libro, que la
 * matriz ya reconoce (`reversar_solo_en_el_libro` con `canceled`) y que se
 * termina volviendo a apretar «Reversar». Ese reintento VUELVE A PEDIR la
 * anulación al PAC antes de tocar el libro (`0622` = ya estaba anulada), igual
 * que «Completar anulación» de la factura.
 *
 * 🔴 El motivo: 15 caracteres cuando viaja a la DGI (`cancellationReason`, el
 *    mismo validador que la factura), 3 cuando la reversión es sólo contable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import {
  getAsientoDeNotaDeCredito,
  reverseCreditNote,
  type ReverseCreditNoteResult,
} from "@/lib/finanzas/api/credit-notes";
import { MOTIVO_MAX, MOTIVO_MIN } from "@/lib/finanzas/contabilidad/reversion";
import { loadEmisorConfig } from "@/lib/finanzas/efactura/config/emisor-config";
import {
  decidirAccionSobreNotaDeCredito,
  type FeEstado,
} from "@/lib/finanzas/efactura/orchestration/decidir-accion-fiscal";
import { clasificarRespuestaDeAnulacion } from "@/lib/finanzas/efactura/orchestration/clasificar-respuesta-de-anulacion";
import { anularEnPac, type PedidoDeAnulacion } from "@/lib/finanzas/efactura/transport/anulacion-en-pac";
import { validarMotivoDeAnulacion } from "@/lib/finanzas/validators/cancel-invoice";

type DB = SupabaseClient;

export type ResultadoDeReversionDeNc =
  /** Reversada en el libro (y anulada ante la DGI si correspondía). */
  | {
      estado: "reversada";
      mensaje: string;
      anuladaAnteLaDgi: boolean;
      entry_number: number;
      credit_note_number: string;
    }
  /** 🔴 Estado intermedio: muerta ante la DGI, viva en el libro. */
  | { estado: "anulada_en_dgi_falta_el_libro"; mensaje: string; detalle: string }
  /** La DGI rechazó. Nada cambió. */
  | { estado: "rechazada_por_la_dgi"; mensaje: string; pista: string | null }
  /** No sabemos si llegó. Nada cambió. */
  | { estado: "no_sabemos"; mensaje: string; intento: number };

/** El PAC y el libro, inyectables para poder congelar el orden en un test. */
export interface Dependencias {
  anularEnPac: (pedido: PedidoDeAnulacion) => Promise<unknown>;
  reversarEnElLibro: (motivo: string) => Promise<ReverseCreditNoteResult>;
  tieneAsientoPropio: () => Promise<boolean>;
}

export async function reversarNotaDeCredito(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  creditNoteId: string,
  motivoCrudo: unknown,
  ahora: Date,
  deps?: Partial<Dependencias>
): Promise<ResultadoDeReversionDeNc> {
  const d: Dependencias = {
    anularEnPac: deps?.anularEnPac ?? anularEnPac,
    reversarEnElLibro:
      deps?.reversarEnElLibro ??
      ((motivo) => reverseCreditNote(db, ledgerDb, tenantId, userId, creditNoteId, motivo)),
    tieneAsientoPropio:
      deps?.tieneAsientoPropio ??
      (async () => (await getAsientoDeNotaDeCredito(db, tenantId, creditNoteId)) !== null),
  };

  // ── T0: la matriz, otra vez acá ───────────────────────────────────────────
  const nc = await cargarNota(db, tenantId, creditNoteId);
  const tieneAsientoPropio = await d.tieneAsientoPropio();
  const accion = decidirAccionSobreNotaDeCredito(
    {
      status: nc.status,
      feEstado: nc.fe_estado,
      dgiCufe: nc.dgi_cufe,
      issueDate: nc.issue_date,
      dgiFechaAutorizacion: nc.dgi_fecha_autorizacion,
      tieneAsientoPropio,
    },
    ahora
  );

  if (accion.accion !== "reversar_solo_en_el_libro" && accion.accion !== "anular_en_dgi_y_libro") {
    // El mensaje de la matriz ya explica el caso: no se reescribe acá.
    throw new MutationError(accion.mensaje, 409);
  }

  const viajaALaDgi = accion.accion === "anular_en_dgi_y_libro";
  const cufe = (nc.dgi_cufe ?? "").trim();
  // La NC ya marcada como anulada ante la DGI por un intento anterior que no
  // llegó al libro: antes de tocar el libro se le vuelve a preguntar al PAC.
  const esReintento = accion.accion === "reversar_solo_en_el_libro" && nc.fe_estado === "canceled" && cufe !== "";

  const motivo = validarMotivo(motivoCrudo, viajaALaDgi || esReintento);

  // ── Sin DGI de por medio: sólo el libro ──────────────────────────────────
  if (!viajaALaDgi && !esReintento) {
    const r = await d.reversarEnElLibro(motivo);
    return {
      estado: "reversada",
      anuladaAnteLaDgi: false,
      entry_number: r.entry_number,
      credit_note_number: r.credit_note_number,
      mensaje: `Nota de crédito ${r.credit_note_number} reversada en el libro (asiento ${r.entry_number}).`,
    };
  }

  // ── T1 + T2: el intento registrado ANTES del POST, y el POST ────────────
  const pac = await pedirAnulacion(db, d, tenantId, userId, creditNoteId, cufe, motivo);

  if (pac.clase === "sin_respuesta" || pac.clase === "indeterminada") {
    if (esReintento) {
      return {
        estado: "anulada_en_dgi_falta_el_libro",
        mensaje:
          "No se pudo confirmar con la DGI que la nota de crédito esté anulada, así que el libro " +
          "no se tocó. Vuelve a intentarlo. " + pac.mensaje,
        detalle: pac.mensaje,
      };
    }
    return {
      estado: "no_sabemos",
      intento: pac.intento,
      mensaje:
        "No se pudo confirmar si la DGI recibió la anulación. La nota de crédito NO se modificó. " +
        "Puedes volver a intentarlo: si el pedido había llegado, la DGI lo informa y sigue desde " +
        "donde quedó. " + pac.mensaje,
    };
  }

  if (pac.clase === "rechazada") {
    if (esReintento) {
      return {
        estado: "anulada_en_dgi_falta_el_libro",
        mensaje: `La DGI no confirmó la anulación, así que el libro no se tocó. ${pac.mensaje}`,
        detalle: pac.mensaje,
      };
    }
    return { estado: "rechazada_por_la_dgi", mensaje: `La DGI rechazó la anulación. ${pac.mensaje}`, pista: pac.pista };
  }

  // ── T3: la DGI anuló. `canceled` ANTES del libro ─────────────────────────
  if (!esReintento) {
    const { error: errMarca } = await db
      .from("credit_notes")
      .update({ fe_estado: "canceled" as FeEstado })
      .eq("tenant_id", tenantId)
      .eq("id", creditNoteId);
    if (errMarca) {
      throw new MutationError(
        "La DGI anuló la nota de crédito pero no se pudo registrar en el CRM. NO reintentes: " +
          `ya está anulada ante la DGI (intento #${pac.intento}). Avisa a soporte. ` +
          pgErrorToMessage(errMarca),
        500,
        errMarca
      );
    }
  }

  // ── T4: el libro ─────────────────────────────────────────────────────────
  try {
    const r = await d.reversarEnElLibro(motivo);
    return {
      estado: "reversada",
      anuladaAnteLaDgi: true,
      entry_number: r.entry_number,
      credit_note_number: r.credit_note_number,
      mensaje:
        `Nota de crédito ${r.credit_note_number} anulada ante la DGI y reversada en el libro ` +
        `(asiento ${r.entry_number}).`,
    };
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    return {
      estado: "anulada_en_dgi_falta_el_libro",
      mensaje:
        "La nota de crédito quedó ANULADA ante la DGI, pero la reversión en el libro no se " +
        "completó. Vuelve a apretar «Reversar» para terminarla.",
      detalle: recortar(detalle, 400),
    };
  }
}

// ---------------------------------------------------------------------------
// Partes
// ---------------------------------------------------------------------------

function validarMotivo(crudo: unknown, viajaALaDgi: boolean): string {
  if (viajaALaDgi) {
    const v = validarMotivoDeAnulacion(crudo);
    if (!v.ok) throw new MutationError(v.mensaje, 400);
    return v.motivo;
  }
  const m = typeof crudo === "string" ? crudo.trim() : "";
  if (m.length < MOTIVO_MIN || m.length > MOTIVO_MAX) {
    throw new MutationError(
      `El motivo de la reversión debe tener entre ${MOTIVO_MIN} y ${MOTIVO_MAX} caracteres.`,
      400
    );
  }
  return m;
}

type RespuestaDelPac =
  | { clase: "anulada" | "ya_anulada"; intento: number; mensaje: string }
  | { clase: "rechazada"; intento: number; mensaje: string; pista: string | null }
  | { clase: "indeterminada" | "sin_respuesta"; intento: number; mensaje: string };

/** T1 + T2. El intento queda registrado antes de salir a la red. */
async function pedirAnulacion(
  db: DB,
  d: Dependencias,
  tenantId: string,
  userId: string,
  creditNoteId: string,
  cufe: string,
  motivo: string
): Promise<RespuestaDelPac> {
  const emisor = loadEmisorConfig();
  const intento = await proximoIntento(db, tenantId, creditNoteId);
  const pedido: PedidoDeAnulacion = { cufe, cancellationReason: motivo };

  const { data: fila, error } = await db
    .from("fe_anulaciones")
    .insert({
      tenant_id: tenantId,
      credit_note_id: creditNoteId,
      intento,
      cufe,
      motivo,
      request_payload: pedido,
      resultado: "sin_respuesta",
      i_amb: emisor.iAmb,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !fila) throw new MutationError(pgErrorToMessage(error), 500, error);
  const intentoId = fila.id as string;

  let respuesta: unknown;
  try {
    respuesta = await d.anularEnPac(pedido);
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    await cerrarIntento(db, tenantId, intentoId, "sin_respuesta", { _meta: { error: recortar(detalle, 500) } });
    return { clase: "sin_respuesta", intento, mensaje: `Detalle: ${recortar(detalle, 200)}` };
  }

  const c = clasificarRespuestaDeAnulacion(respuesta);
  await cerrarIntento(db, tenantId, intentoId, c.clase, respuesta);
  if (c.clase === "rechazada") return { clase: "rechazada", intento, mensaje: c.mensaje, pista: c.pista };
  return { clase: c.clase, intento, mensaje: c.mensaje };
}

async function cargarNota(db: DB, tenantId: string, creditNoteId: string) {
  const { data, error } = await db
    .from("credit_notes")
    .select("id, status, fe_estado, dgi_cufe, issue_date, dgi_fecha_autorizacion")
    .eq("tenant_id", tenantId)
    .eq("id", creditNoteId)
    .maybeSingle();
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  if (!data) throw new MutationError("Nota de crédito no encontrada", 404);
  return {
    status: String(data.status),
    fe_estado: ((data.fe_estado as FeEstado) ?? "no_emitida") as FeEstado,
    dgi_cufe: (data.dgi_cufe as string | null) ?? null,
    issue_date: data.issue_date ? String(data.issue_date) : null,
    dgi_fecha_autorizacion: (data.dgi_fecha_autorizacion as string | null) ?? null,
  };
}

async function proximoIntento(db: DB, tenantId: string, creditNoteId: string): Promise<number> {
  const { data, error } = await db
    .from("fe_anulaciones")
    .select("intento")
    .eq("tenant_id", tenantId)
    .eq("credit_note_id", creditNoteId)
    .order("intento", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  return data ? Number(data.intento) + 1 : 1;
}

/** Un fallo al cerrar el intento se loguea y NO corta: es memoria, no permiso. */
async function cerrarIntento(db: DB, tenantId: string, intentoId: string, resultado: string, respuesta: unknown) {
  const { error } = await db
    .from("fe_anulaciones")
    .update({ resultado, response_payload: respuesta as object })
    .eq("tenant_id", tenantId)
    .eq("id", intentoId);
  if (error) console.error("[efactura/anulacion-nc] no se pudo cerrar el intento", error);
}

function recortar(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}
