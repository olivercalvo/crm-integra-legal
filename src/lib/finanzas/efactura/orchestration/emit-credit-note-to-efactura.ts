/**
 * ENVIAR UNA NOTA DE CRÉDITO A LA DGI (Bloque 9C).
 *
 * Hasta hoy la nota de crédito era un **documento interno**: nacía
 * `fe_estado = 'no_emitida'`, con banda roja, y no se le entregaba al cliente
 * como comprobante fiscal (D1 del Bloque 5). Esto es el envío.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LO QUE **NO** SE REESCRIBE
 * ═════════════════════════════════════════════════════════════════════════════
 * La NC sale por el MISMO endpoint que una factura (`POST /api/v1/Invoices`,
 * con `tipoDocumento = 04`), así que se reusan tal cual:
 *
 *   · `mapInvoiceToEfacturaRequest` — el mapper, con la NC ocupando el lugar
 *     de la factura en el bundle. El receptor sale del mismo `map-receptor`
 *     congelado y el ITBMS proporcional de una NC parcial lo calcula el mismo
 *     `mapTotales`.
 *   · `parsePacResponse` — 🔴 el clasificador, exportado y no copiado. La
 *     lección del `0600` fue que un clasificador duplicado diverge y termina
 *     llamando rechazo a un éxito. Medido el 24/09: la respuesta de un `04`
 *     trae `autorizada` explícito y `0260`, igual que una factura.
 *   · `allocateFeNumero` y la secuencia del punto — ideati confirmó el 22/09
 *     que la NC usa la MISMA secuencia; la duplicidad la valida la DGI por
 *     tipo de documento.
 *   · `fe_emisiones` — la misma tabla, por el arco exclusivo de la `062`. Es
 *     lo que mantiene la alerta de rechazo (SOP-041) en una sola consulta.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 SIN CUFE NO SE MANDA NADA
 * ═════════════════════════════════════════════════════════════════════════════
 * El bloque `documentosFiscalesReferenciados` se arma con el CUFE de la
 * factura que se corrige. Si la factura no lo tiene:
 *
 *   · **Caso B** — se emitió a mano en el portal (antes del 8 de julio de
 *     2026): el CUFE EXISTE ante la DGI y hay que cargarlo
 *     (`POST /api/finanzas/invoices/[id]/cufe`). Es lo que ofrece la pantalla.
 *   · **Caso C** — nunca pasó por la DGI: **no hay camino**. Referenciar por
 *     número de factura en papel hace que el PAC conteste `[0000] Object
 *     reference not set to an instance of an object` (medido el 24/09/2026,
 *     igual con `04` que con `06`: lo que rompe es el bloque de papel, no el
 *     tipo de documento). La pantalla lo dice en claro y no deja emitir.
 *
 * En los dos casos se corta ACÁ, antes de quemar un correlativo. Una NC que no
 * se puede referenciar no es un envío que falla: es un envío que no se hace.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * UN CORRELATIVO POR NOTA DE CRÉDITO, COMO MÁXIMO (D-3)
 * ═════════════════════════════════════════════════════════════════════════════
 * El número se reserva EN LA NC antes de llamar al mapper, igual que en
 * `emitInvoiceToEfactura`. Si algo falla después, la NC queda en `error` con
 * el número guardado y el reintento lo reusa. Los huecos en la numeración
 * siguen aceptados (SOP-031); lo que no se acepta es quemar uno nuevo en cada
 * reintento.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { loadEmisorConfig } from "@/lib/finanzas/efactura/config/emisor-config";
import { mapInvoiceToEfacturaRequest } from "@/lib/finanzas/efactura/mapper/map-invoice";
import { allocateFeNumero } from "@/lib/finanzas/efactura/secuencias/allocate-fe-numero";
import { post } from "@/lib/finanzas/efactura/transport/efactura-client";
import { fetchCreditNoteEfacturaBundle } from "@/lib/finanzas/efactura/data/fetch-credit-note-efactura-bundle";
import {
  parsePacResponse,
  MENSAJE_INCIERTO,
  type EmitErrorKind,
  type FeEstado,
} from "./emit-invoice-to-efactura";

type DB = SupabaseClient;

/** `04` — nota de crédito. Probado en sandbox el 24/09/2026: autorizó `0260`. */
export const TIPO_DOCUMENTO_NOTA_CREDITO = "04" as const;

export interface EmitCreditNoteResult {
  ok: boolean;
  feEstado: FeEstado;
  creditNoteId: string;
  creditNoteNumber: string;
  puntoFacturacion: string;
  numeroDocumento: number;
  cufe: string | null;
  protocoloAutorizacion: string | null;
  fechaAutorizacion: string | null;
  intento: number;
  errorKind: EmitErrorKind | null;
  mensaje: string | null;
}

/**
 * Lo que la NC necesita saber de sí misma y de su factura antes de enviar.
 * Se lee una sola vez y se valida todo junto, para que el gate no dependa del
 * orden en que se hacen las consultas.
 */
interface MetaNc {
  id: string;
  credit_note_number: string;
  status: string;
  fe_estado: string;
  punto_facturacion: string | null;
  numero_documento: number | null;
}

async function loadMetaNc(db: DB, tenantId: string, id: string): Promise<MetaNc> {
  const { data, error } = await db
    .from("credit_notes")
    .select("id, credit_note_number, status, fe_estado, punto_facturacion, numero_documento")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  if (!data) throw new MutationError("Nota de crédito no encontrada", 404);
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    credit_note_number: String(r.credit_note_number),
    status: String(r.status),
    fe_estado: String(r.fe_estado ?? "no_emitida"),
    punto_facturacion: r.punto_facturacion === null ? null : String(r.punto_facturacion),
    numero_documento: r.numero_documento === null ? null : Number(r.numero_documento),
  };
}

async function siguienteIntento(db: DB, tenantId: string, id: string): Promise<number> {
  const { data, error } = await db
    .from("fe_emisiones")
    .select("intento")
    .eq("tenant_id", tenantId)
    .eq("credit_note_id", id)
    .order("intento", { ascending: false })
    .limit(1);
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  const filas = (data ?? []) as { intento: number }[];
  return filas.length === 0 ? 1 : Number(filas[0].intento) + 1;
}

export async function emitCreditNoteToEfactura(
  db: DB,
  tenantId: string,
  userId: string,
  creditNoteId: string
): Promise<EmitCreditNoteResult> {
  // -------------------------------------------------------------------------
  // T0 — Pre-check. Sin escrituras: todo lo que falle acá no deja rastro.
  // -------------------------------------------------------------------------
  const nc = await loadMetaNc(db, tenantId, creditNoteId);

  if (nc.status === "anulada") {
    throw new MutationError(
      "Esta nota de crédito está anulada: no se envía a la DGI.",
      409
    );
  }
  if (nc.fe_estado !== "no_emitida" && nc.fe_estado !== "error") {
    throw new MutationError(
      nc.fe_estado === "authorized"
        ? "Esta nota de crédito ya fue autorizada por la DGI."
        : nc.fe_estado === "pending"
          ? "Esta nota de crédito ya tiene un envío en curso. Espere a que se resuelva o reintente luego."
          : `No se puede reenviar: estado fiscal "${nc.fe_estado}".`,
      409
    );
  }

  const { bundle, factura } = await fetchCreditNoteEfacturaBundle(db, tenantId, creditNoteId);

  // 🔴 EL GATE DEL CUFE. Antes de tocar el correlativo.
  if (!factura.dgi_cufe) {
    throw new MutationError(
      `La factura ${factura.invoice_number} no tiene CUFE, así que esta nota de crédito no se ` +
        "puede enviar a la DGI: el documento electrónico tiene que decir qué factura corrige. " +
        "Si la factura se emitió en el portal de ideati, cargue su CUFE. Si no tiene CUFE, " +
        "consulte con administración antes de hacer la nota de crédito.",
      409
    );
  }

  const emisor = loadEmisorConfig();
  const intento = await siguienteIntento(db, tenantId, creditNoteId);

  // -------------------------------------------------------------------------
  // T1 — Correlativo: nuevo, o el ya reservado si esto es un reintento (D-3).
  // -------------------------------------------------------------------------
  let puntoFacturacion: string;
  let numeroDocumento: number;
  if (nc.fe_estado === "error" && nc.punto_facturacion !== null && nc.numero_documento !== null) {
    puntoFacturacion = nc.punto_facturacion;
    numeroDocumento = nc.numero_documento;
  } else {
    puntoFacturacion = emisor.puntoFacturacion;
    numeroDocumento = await allocateFeNumero(db, { tenantId, puntoFacturacion });
  }

  // -------------------------------------------------------------------------
  // T1.5 — Se reserva EN LA NC antes del mapper, que es lo primero que puede
  //        lanzar. El guard sobre fe_estado es el lock optimista.
  // -------------------------------------------------------------------------
  const { count, error: errMark } = await db
    .from("credit_notes")
    .update(
      {
        fe_estado: "pending",
        punto_facturacion: puntoFacturacion,
        numero_documento: numeroDocumento,
        i_amb: emisor.iAmb,
      },
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .eq("id", creditNoteId)
    .in("fe_estado", ["no_emitida", "error"]);

  if (errMark) throw new MutationError(pgErrorToMessage(errMark), 500, errMark);
  if (!count) {
    throw new MutationError(
      "Otro proceso ya inició el envío de esta nota de crédito. Refresque y vuelva a intentar.",
      409
    );
  }

  const marcarError = async () => {
    await db
      .from("credit_notes")
      .update({ fe_estado: "error" })
      .eq("tenant_id", tenantId)
      .eq("id", creditNoteId);
  };

  // -------------------------------------------------------------------------
  // T2 — El payload. Puro, sin I/O.
  // -------------------------------------------------------------------------
  let request: ReturnType<typeof mapInvoiceToEfacturaRequest>;
  try {
    request = mapInvoiceToEfacturaRequest({
      bundle,
      emisor,
      sequence: { puntoFacturacion, numeroDocumento },
      options: {
        iAmb: emisor.iAmb,
        tipoDocumento: TIPO_DOCUMENTO_NOTA_CREDITO,
        referencia: { cufe: factura.dgi_cufe, fechaEmision: factura.issue_date },
      },
    });
  } catch (err) {
    await marcarError();
    throw err;
  }

  const { data: emision, error: errIns } = await db
    .from("fe_emisiones")
    .insert({
      tenant_id: tenantId,
      credit_note_id: creditNoteId,
      intento,
      punto_facturacion: puntoFacturacion,
      numero_documento: numeroDocumento,
      request_payload: request,
      i_amb: emisor.iAmb,
      created_by: userId,
    })
    .select("id")
    .single();

  if (errIns) {
    await marcarError();
    throw new MutationError(pgErrorToMessage(errIns), 500, errIns);
  }
  const emisionId = (emision as { id: string }).id;

  const guardarRespuesta = async (campos: Record<string, unknown>) => {
    await db.from("fe_emisiones").update(campos).eq("id", emisionId);
  };

  // -------------------------------------------------------------------------
  // T3 — El POST.
  // -------------------------------------------------------------------------
  let raw: unknown;
  try {
    raw = await post("/api/v1/Invoices?qr=true&xml=false", request);
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    await guardarRespuesta({ response_payload: { error: mensaje }, autorizada: null });
    await marcarError();
    return {
      ok: false,
      feEstado: "error",
      creditNoteId,
      creditNoteNumber: nc.credit_note_number,
      puntoFacturacion,
      numeroDocumento,
      cufe: null,
      protocoloAutorizacion: null,
      fechaAutorizacion: null,
      intento,
      errorKind: "transport",
      mensaje:
        "No se pudo comunicar con la DGI. La nota de crédito quedó sin enviar y se puede " +
        `reintentar con el mismo número. Detalle: ${mensaje}`,
    };
  }

  // -------------------------------------------------------------------------
  // T4 — La respuesta, con el MISMO clasificador que las facturas.
  // -------------------------------------------------------------------------
  const parsed = parsePacResponse(raw);

  if (parsed.kind === "authorized") {
    await guardarRespuesta({
      response_payload: raw,
      autorizada: true,
      cufe: parsed.cufe,
      protocolo_autorizacion: parsed.protocoloAutorizacion,
      fecha_autorizacion: parsed.fechaAutorizacion,
      cod_res: parsed.codRes,
    });
    const { error: errUpd } = await db
      .from("credit_notes")
      .update({
        fe_estado: "authorized",
        dgi_cufe: parsed.cufe,
        dgi_protocolo_autorizacion: parsed.protocoloAutorizacion,
        dgi_fecha_autorizacion: parsed.fechaAutorizacion,
        dgi_numero_documento: String(numeroDocumento),
        qr_content: parsed.qrContent,
        ef_invoice_uuid: parsed.efInvoiceUuid,
      })
      .eq("tenant_id", tenantId)
      .eq("id", creditNoteId);
    if (errUpd) {
      // El documento EXISTE ante la DGI: no se puede volver atrás. Se avisa
      // fuerte en vez de fingir que falló.
      console.error("[efactura/nc] autorizada pero no se pudo persistir", errUpd);
      throw new MutationError(
        `La DGI autorizó la nota de crédito ${nc.credit_note_number} (CUFE ${parsed.cufe}) pero ` +
          "no se pudo guardar en el sistema. NO la reenvíe: avise para que se registre a mano.",
        500,
        errUpd
      );
    }
    return {
      ok: true,
      feEstado: "authorized",
      creditNoteId,
      creditNoteNumber: nc.credit_note_number,
      puntoFacturacion,
      numeroDocumento,
      cufe: parsed.cufe,
      protocoloAutorizacion: parsed.protocoloAutorizacion,
      fechaAutorizacion: parsed.fechaAutorizacion,
      intento,
      errorKind: null,
      mensaje: null,
    };
  }

  if (parsed.kind === "incierto") {
    await guardarRespuesta({
      response_payload: raw,
      autorizada: null,
      cod_res: parsed.codRes,
    });
    await marcarError();
    const resumen = parsed.codRes.map((c) => c.dMsgRes).filter(Boolean).join(" · ") || null;
    return {
      ok: false,
      feEstado: "error",
      creditNoteId,
      creditNoteNumber: nc.credit_note_number,
      puntoFacturacion,
      numeroDocumento,
      cufe: null,
      protocoloAutorizacion: null,
      fechaAutorizacion: null,
      intento,
      errorKind: "incierto",
      mensaje: MENSAJE_INCIERTO(resumen),
    };
  }

  await guardarRespuesta({
    response_payload: raw,
    autorizada: false,
    cod_res: parsed.codRes,
  });
  await marcarError();
  return {
    ok: false,
    feEstado: "error",
    creditNoteId,
    creditNoteNumber: nc.credit_note_number,
    puntoFacturacion,
    numeroDocumento,
    cufe: null,
    protocoloAutorizacion: null,
    fechaAutorizacion: null,
    intento,
    errorKind: parsed.isDuplicate ? "pac_duplicate" : "pac_rejected",
    mensaje: parsed.summary,
  };
}
