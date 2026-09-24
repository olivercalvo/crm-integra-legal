/**
 * Orquestación de la emisión electrónica al PAC eFactura PTY.
 *
 * Amarra las piezas existentes:
 *   - `loadEmisorConfig`        (config/emisor-config.ts)
 *   - `fetchInvoiceEfacturaBundle` (data/fetch-invoice-efactura-bundle.ts)
 *   - `mapInvoiceToEfacturaRequest` (mapper/map-invoice.ts)
 *   - `allocateFeNumero`        (secuencias/allocate-fe-numero.ts)
 *   - `post`                    (transport/efactura-client.ts)
 *
 * Política de correlativo: REUSO por factura. El allocator commitea el número
 * por sí solo, pero lo RESERVAMOS en la factura (punto+numero, fe_estado
 * 'pending') ANTES del mapper — es decir, antes del primer punto que puede
 * lanzar. Así cualquier fallo posterior (mapper, POST, DB) deja la factura en
 * 'error' con el número ya guardado, y el reintento entra por la rama de reuso
 * D-3 (T1) reusando ESE MISMO número, sin volver a llamar al allocator. Cada
 * factura quema como MÁXIMO un correlativo, reusado en todos sus reintentos
 * hasta autorizar → los saltos de numeración quedan en ~0 aun ante rachas de
 * fallos. Nunca se reusa un número YA autorizado: la factura autorizada queda
 * fuera del gate T0 y el allocator sólo incrementa (jamás retrocede).
 *
 * (Antes: Política A — cada reintento quemaba OTRO número porque el throw del
 * mapper ocurría entre el allocate y la reserva, dejando la factura en
 * 'no_emitida' sin número persistido; el reuso D-3 nunca era alcanzable. Caso
 * real FAC-REI-000039: los intentos fallidos quemaron 3, 4 y 5.)
 *
 * Frontera transaccional:
 *   - T1 (allocate o reuso D-3)              → commit del RPC (sólo 1ra vez).
 *   - T1.5 (UPDATE invoices → pending + numero) → reserva el correlativo en la
 *                                              factura ANTES del mapper. Lock
 *                                              optimista vía guard del estado.
 *   - T2 (map + INSERT fe_emisiones)         → el mapper puede lanzar; se
 *                                              atrapa y se deja 'error' para
 *                                              que el reintento reuse (D-3).
 *   - T3 (POST HTTP)                          → sin transacción, sin lock.
 *   - T4 (persist outcome)                    → dos UPDATEs, idempotentes
 *                                              individualmente.
 *
 * Fuera de scope (sprints posteriores):
 *   - Reconciliador del estado 'pending'.
 *   - Anulación PAC (POST /InvoiceEvents/CreateCancellation).
 *   - Descarga + storage del CAFE/XML.
 *   - Notas de crédito.
 *   - UI pulida (botón, badge, modal).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { loadEmisorConfig } from "@/lib/finanzas/efactura/config/emisor-config";
import { fetchInvoiceEfacturaBundle } from "@/lib/finanzas/efactura/data/fetch-invoice-efactura-bundle";
import { mapInvoiceToEfacturaRequest } from "@/lib/finanzas/efactura/mapper/map-invoice";
import { allocateFeNumero } from "@/lib/finanzas/efactura/secuencias/allocate-fe-numero";
import { post } from "@/lib/finanzas/efactura/transport/efactura-client";
import {
  classifyPacError,
  isHardRejection,
  isDuplicateSignal,
  summarizeCodRes,
  type CodRes,
} from "@/lib/finanzas/efactura/orchestration/classify-pac-error";

type DB = SupabaseClient;

export type FeEstado = "no_emitida" | "pending" | "authorized" | "canceled" | "error";

/**
 * 🔴 `incierto` — "el PAC contestó algo que no sé leer", y NO es un rechazo.
 *
 * Lo agregó el 23/09/2026 la prueba 5 del Bloque 9B, que encontró el problema
 * del otro lado: el endpoint de ANULACIÓN devuelve `0600 — Evento registrado
 * con éxito` y el clasificador, que heredaba la lista de códigos de este
 * endpoint, lo llamó **rechazo**. La DGI había anulado el documento y el CRM
 * informó lo contrario.
 *
 * La regla que sale de ahí, y que ahora vale para los dos: **un código que no
 * reconocemos no se declara rechazo.** Se declara incierto, no se escribe nada
 * que dependa de él, el documento queda reintentable y la pantalla dice
 * "Estado por confirmar" en vez de afirmar algo que no sabemos.
 *
 * Para la emisión el discriminador no es una lista de códigos sino el campo
 * `autorizada`, que el PAC manda SIEMPRE y explícito — verificado contra dos
 * respuestas reales del sandbox, una autorizada y una rechazada.
 */
export type EmitErrorKind = "pac_rejected" | "pac_duplicate" | "transport" | "incierto";

export type { CodRes };

export interface EmitToEfacturaResult {
  invoiceId: string;
  intento: number;
  puntoFacturacion: string;
  numeroDocumento: number;
  feEstado: "authorized" | "pending" | "error";
  cufe: string | null;
  protocoloAutorizacion: string | null;
  fechaAutorizacion: string | null;
  efInvoiceUuid: string | null;
  qrContent: string | null;
  /** Lista de gResProc del PAC si vino. */
  codRes: CodRes[];
  /** Discriminador del tipo de error (null si fe_estado != 'error'). */
  errorKind: EmitErrorKind | null;
  /** Mensaje user-friendly (null si fe_estado === 'authorized'). */
  errorMessage: string | null;
  /**
   * Guía accionable en lenguaje claro para el error (ej. RUC inválido → "revisa
   * la ficha del cliente"). null si el código no tiene guía asociada. El detalle
   * técnico sigue viajando en `codRes`.
   */
  errorHint: string | null;
}

interface InvoiceMeta {
  id: string;
  status: string;
  fe_estado: FeEstado;
  punto_facturacion: string | null;
  numero_documento: number | null;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export async function emitInvoiceToEfactura(
  db: DB,
  tenantId: string,
  userId: string,
  invoiceId: string
): Promise<EmitToEfacturaResult> {
  // -------------------------------------------------------------------------
  // T0 — Pre-check (sin escrituras). Cualquier fallo acá => MutationError.
  // -------------------------------------------------------------------------
  const inv = await loadInvoiceMeta(db, tenantId, invoiceId);

  if (inv.status !== "emitida") {
    throw new MutationError(
      `No se puede emitir al PAC: la factura está en estado "${inv.status}". Primero hay que emitirla internamente.`,
      400
    );
  }
  if (inv.fe_estado !== "no_emitida" && inv.fe_estado !== "error") {
    throw new MutationError(
      inv.fe_estado === "authorized"
        ? "Esta factura ya fue autorizada por el PAC."
        : inv.fe_estado === "pending"
          ? "Esta factura ya tiene un envío en curso al PAC. Espere a que se resuelva o reintente luego."
          : `No se puede reenviar: estado fiscal "${inv.fe_estado}".`,
      409
    );
  }

  // Bundle + gate fiscal del cliente (validateClientFiscalGate adentro).
  const bundle = await fetchInvoiceEfacturaBundle(db, tenantId, invoiceId);

  // Config del emisor (fail-fast si faltan envs / placeholders).
  const emisor = loadEmisorConfig();

  // Calcular el número de intento (race-free: el guard del UPDATE en T2
  // garantiza que sólo un caller pase al siguiente paso).
  const intento = await computeNextIntento(db, tenantId, invoiceId);

  // -------------------------------------------------------------------------
  // T1 — Allocator o reuso.
  //   - Primera vez (no_emitida): allocate nuevo número.
  //   - Reintento (error): REUSA el número ya guardado en la factura (D-3).
  //     Si por algún motivo la factura quedó en 'error' sin punto/numero
  //     persistidos (race rara), allocate uno nuevo como fallback.
  // -------------------------------------------------------------------------
  let puntoFacturacion: string;
  let numeroDocumento: number;
  if (
    inv.fe_estado === "error" &&
    inv.punto_facturacion !== null &&
    inv.numero_documento !== null
  ) {
    puntoFacturacion = inv.punto_facturacion;
    numeroDocumento = inv.numero_documento;
  } else {
    puntoFacturacion = emisor.puntoFacturacion;
    numeroDocumento = await allocateFeNumero(db, {
      tenantId,
      puntoFacturacion,
    });
  }

  // -------------------------------------------------------------------------
  // T1.5 — Reserva del correlativo EN LA FACTURA, ANTES del mapper.
  //   El correlativo que devuelve allocateFeNumero se "quema" en cuanto el RPC
  //   commitea. Para que un fallo posterior (mapper, POST, DB) NO obligue a
  //   quemar OTRO número en el reintento, persistimos punto+numero en la
  //   factura y la marcamos 'pending' ACÁ — antes del mapper, que es la primera
  //   parte que puede lanzar (buildRucReceptor con client_type NULL, caso
  //   FAC-REI-000039). Si algo falla luego, la factura queda 'error' con el
  //   número ya guardado y el reintento entra por la rama de reuso D-3 (T1) sin
  //   volver a llamar al allocator. Cada factura quema como MÁXIMO un
  //   correlativo, reusado en todos sus reintentos.
  //
  //   Guard fe_estado IN ('no_emitida','error'): lock optimista. count=0 →
  //   otro proceso ya avanzó → 409, sin tocar nada más.
  // -------------------------------------------------------------------------
  const { count: updatedCount, error: errMark } = await db
    .from("invoices")
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
    .eq("id", invoiceId)
    .in("fe_estado", ["no_emitida", "error"]);

  if (errMark) {
    throw new MutationError(pgErrorToMessage(errMark), 500, errMark);
  }
  if (!updatedCount || updatedCount === 0) {
    throw new MutationError(
      "Otro proceso ya inició la emisión al PAC. Refresque y vuelva a intentar.",
      409
    );
  }

  // -------------------------------------------------------------------------
  // T2 — Map a InvoiceRequest (PURE; sin I/O) + INSERT del intento.
  //   El mapper puede lanzar (Error plano) si el cliente tiene datos fiscales
  //   inconsistentes que el gate no atrapó. Como el número YA quedó reservado
  //   en la factura (T1.5), atrapamos el throw, dejamos la factura en 'error'
  //   (best-effort) y re-lanzamos: el reintento reusará el mismo número (D-3),
  //   sin quemar otro correlativo.
  //   Luego INSERT fe_emisiones (request_payload, autorizada=null). Si falla
  //   por DB → UPDATE invoices SET fe_estado='error' (best effort) y throw 500.
  // -------------------------------------------------------------------------
  let request: ReturnType<typeof mapInvoiceToEfacturaRequest>;
  try {
    request = mapInvoiceToEfacturaRequest({
      bundle,
      emisor,
      sequence: { puntoFacturacion, numeroDocumento },
      options: { iAmb: emisor.iAmb },
    });
  } catch (err) {
    await db
      .from("invoices")
      .update({ fe_estado: "error" })
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId);
    const msg = err instanceof Error ? err.message : String(err);
    throw new MutationError(
      `No se pudo construir el documento electrónico para el PAC: ${msg}`,
      500,
      err
    );
  }

  const { data: emisionRow, error: errEmis } = await db
    .from("fe_emisiones")
    .insert({
      tenant_id: tenantId,
      invoice_id: invoiceId,
      intento,
      punto_facturacion: puntoFacturacion,
      numero_documento: numeroDocumento,
      request_payload: request as unknown as object,
      i_amb: emisor.iAmb,
      autorizada: null,
      created_by: userId,
    })
    .select("id")
    .single();

  if (errEmis || !emisionRow) {
    // Best-effort rollback del estado: volver a 'error' para que se pueda
    // reintentar. Si falla este UPDATE también, queda 'pending' huérfana
    // y el operador interviene.
    await db
      .from("invoices")
      .update({ fe_estado: "error" })
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId);
    throw new MutationError(pgErrorToMessage(errEmis), 500, errEmis);
  }
  const emisionId = emisionRow.id as string;

  // -------------------------------------------------------------------------
  // T3 — POST al PAC. Cualquier throw acá entra al camino 'transport'.
  // -------------------------------------------------------------------------
  let responseRaw: unknown;
  try {
    responseRaw = await post(
      "/api/v1/Invoices?qr=true&xml=false",
      request
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await persistTransportError(db, tenantId, invoiceId, emisionId, msg);
    return buildResult({
      invoiceId,
      intento,
      puntoFacturacion,
      numeroDocumento,
      feEstado: "error",
      cufe: null,
      protocoloAutorizacion: null,
      fechaAutorizacion: null,
      efInvoiceUuid: null,
      qrContent: null,
      codRes: [],
      errorKind: "transport",
      errorMessage:
        "Fallo de comunicación con el PAC. Reintente en unos minutos. Detalle: " +
        truncate(msg, 200),
      errorHint: null,
    });
  }

  // -------------------------------------------------------------------------
  // T4 — Clasificar respuesta y persistir.
  // -------------------------------------------------------------------------
  const parsed = parsePacResponse(responseRaw);

  if (parsed.kind === "authorized") {
    await persistAuthorized(db, tenantId, invoiceId, emisionId, parsed);
    return buildResult({
      invoiceId,
      intento,
      puntoFacturacion,
      numeroDocumento,
      feEstado: "authorized",
      cufe: parsed.cufe,
      protocoloAutorizacion: parsed.protocoloAutorizacion,
      fechaAutorizacion: parsed.fechaAutorizacion,
      efInvoiceUuid: parsed.efInvoiceUuid,
      qrContent: parsed.qrContent,
      codRes: parsed.codRes,
      errorKind: null,
      errorMessage: null,
      errorHint: null,
    });
  }

  if (parsed.kind === "incierto") {
    await persistIncierto(db, tenantId, invoiceId, emisionId, parsed);
    return buildResult({
      invoiceId,
      intento,
      puntoFacturacion,
      numeroDocumento,
      // 'error' y no 'pending': 'pending' es intocable para el gate T0 y
      // nadie podría reintentar. Ver el comentario de ParsedIncierto.
      feEstado: "error",
      cufe: null,
      protocoloAutorizacion: null,
      fechaAutorizacion: null,
      efInvoiceUuid: parsed.efInvoiceUuid,
      qrContent: null,
      codRes: parsed.codRes,
      errorKind: "incierto",
      errorMessage: MENSAJE_INCIERTO(summarizeCodRes(parsed.codRes)),
      errorHint:
        "No cambie nada todavía. Verifique en el portal de la DGI si el documento quedó " +
        "autorizado; si no aparece, vuelva a enviarlo.",
    });
  }

  // kind === 'rejected'. La clasificación (rechazo duro vs duplicado) y el
  // mensaje los decide classifyPacError: si hay códigos de rechazo GANAN sobre
  // la heurística de duplicado y el texto de "posiblemente autorizado" NO se
  // muestra. Ver classify-pac-error.ts para la causa raíz.
  const classification = classifyPacError(parsed.codRes, parsed.summary);
  await persistRejected(db, tenantId, invoiceId, emisionId, parsed);
  return buildResult({
    invoiceId,
    intento,
    puntoFacturacion,
    numeroDocumento,
    feEstado: "error",
    cufe: null,
    protocoloAutorizacion: null,
    fechaAutorizacion: null,
    efInvoiceUuid: parsed.efInvoiceUuid,
    qrContent: null,
    codRes: parsed.codRes,
    errorKind: classification.errorKind,
    errorMessage: classification.errorMessage,
    errorHint: classification.errorHint,
  });
}

// ---------------------------------------------------------------------------
// Helpers de BD
// ---------------------------------------------------------------------------

async function loadInvoiceMeta(
  db: DB,
  tenantId: string,
  invoiceId: string
): Promise<InvoiceMeta> {
  const { data, error } = await db
    .from("invoices")
    .select("id, status, fe_estado, punto_facturacion, numero_documento")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) {
    throw new MutationError(pgErrorToMessage(error), 500, error);
  }
  if (!data) {
    throw new MutationError("Factura no encontrada", 404);
  }

  return {
    id: data.id as string,
    status: data.status as string,
    fe_estado: (data.fe_estado as FeEstado) ?? "no_emitida",
    punto_facturacion: (data.punto_facturacion as string | null) ?? null,
    numero_documento:
      data.numero_documento !== null && data.numero_documento !== undefined
        ? Number(data.numero_documento)
        : null,
  };
}

async function computeNextIntento(
  db: DB,
  tenantId: string,
  invoiceId: string
): Promise<number> {
  const { data, error } = await db
    .from("fe_emisiones")
    .select("intento")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("intento", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new MutationError(pgErrorToMessage(error), 500, error);
  }
  if (!data) return 1;
  return Number(data.intento) + 1;
}

async function persistAuthorized(
  db: DB,
  tenantId: string,
  invoiceId: string,
  emisionId: string,
  parsed: ParsedAuthorized
): Promise<void> {
  const { error: errEmis } = await db
    .from("fe_emisiones")
    .update({
      response_payload: parsed.raw as unknown as object,
      cufe: parsed.cufe,
      protocolo_autorizacion: parsed.protocoloAutorizacion,
      fecha_autorizacion: parsed.fechaAutorizacion,
      autorizada: true,
      cod_res: parsed.codRes,
    })
    .eq("tenant_id", tenantId)
    .eq("id", emisionId);
  if (errEmis) {
    // Log y continuar: la factura debe quedar 'authorized' aunque el log
    // de intentos no se haya podido cerrar (rare).
    console.error(
      "[efactura/orchestration] persistAuthorized: UPDATE fe_emisiones falló",
      errEmis
    );
  }

  const { error: errInv } = await db
    .from("invoices")
    .update({
      fe_estado: "authorized",
      dgi_cufe: parsed.cufe,
      dgi_protocolo_autorizacion: parsed.protocoloAutorizacion,
      dgi_fecha_autorizacion: parsed.fechaAutorizacion,
      qr_content: parsed.qrContent,
      ef_invoice_uuid: parsed.efInvoiceUuid,
    })
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId);
  if (errInv) {
    throw new MutationError(pgErrorToMessage(errInv), 500, errInv);
  }
}

/** El texto que ve la licenciada cuando no sabemos qué contestó el PAC. */
export function MENSAJE_INCIERTO(resumen: string | null): string {
  return (
    "Estado por confirmar: la DGI respondió algo que el sistema no puede interpretar, " +
    "así que NO se da por autorizada ni por rechazada. " +
    (resumen ? `Respuesta: ${resumen}. ` : "") +
    "La factura queda lista para reenviar."
  );
}

async function persistIncierto(
  db: DB,
  tenantId: string,
  invoiceId: string,
  emisionId: string,
  parsed: ParsedIncierto
): Promise<void> {
  // `autorizada: null` y `errorKind: 'incierto'` — las dos cosas dicen lo
  // mismo desde lados distintos: no sabemos. Un `false` acá afirmaría un
  // rechazo que el PAC no dictaminó.
  const responsePayload = {
    raw: parsed.raw,
    _meta: { errorKind: "incierto" as EmitErrorKind },
  };

  const { error: errEmis } = await db
    .from("fe_emisiones")
    .update({
      response_payload: responsePayload as unknown as object,
      autorizada: null,
      cod_res: parsed.codRes,
    })
    .eq("tenant_id", tenantId)
    .eq("id", emisionId);
  if (errEmis) {
    console.error(
      "[efactura/orchestration] persistIncierto: UPDATE fe_emisiones falló",
      errEmis
    );
  }

  if (parsed.efInvoiceUuid) {
    const { error: errInv } = await db
      .from("invoices")
      .update({ ef_invoice_uuid: parsed.efInvoiceUuid })
      .eq("tenant_id", tenantId)
      .eq("id", invoiceId);
    if (errInv) {
      console.error(
        "[efactura/orchestration] persistIncierto: UPDATE invoices.ef_invoice_uuid falló",
        errInv
      );
    }
  }
  // 🔴 Y la factura vuelve a 'error', que es REINTENTABLE. Antes se quedaba en
  //    'pending', que el gate T0 considera intocable: nadie podía reenviarla y
  //    el reconciliador que iba a destrabarla no existe. Una respuesta que no
  //    entendemos no puede dejar el documento en un estado del que no se sale.
  const { error: errEstado } = await db
    .from("invoices")
    .update({ fe_estado: "error" })
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId);
  if (errEstado) {
    throw new MutationError(pgErrorToMessage(errEstado), 500, errEstado);
  }
}

async function persistRejected(
  db: DB,
  tenantId: string,
  invoiceId: string,
  emisionId: string,
  parsed: ParsedRejected
): Promise<void> {
  const errorKind: EmitErrorKind = parsed.isDuplicate
    ? "pac_duplicate"
    : "pac_rejected";

  const responsePayload = {
    raw: parsed.raw,
    _meta: { errorKind },
  };

  const { error: errEmis } = await db
    .from("fe_emisiones")
    .update({
      response_payload: responsePayload as unknown as object,
      autorizada: false,
      cod_res: parsed.codRes,
    })
    .eq("tenant_id", tenantId)
    .eq("id", emisionId);
  if (errEmis) {
    console.error(
      "[efactura/orchestration] persistRejected: UPDATE fe_emisiones falló",
      errEmis
    );
  }

  const { error: errInv } = await db
    .from("invoices")
    .update({
      fe_estado: "error",
      ...(parsed.efInvoiceUuid ? { ef_invoice_uuid: parsed.efInvoiceUuid } : {}),
    })
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId);
  if (errInv) {
    throw new MutationError(pgErrorToMessage(errInv), 500, errInv);
  }
}

async function persistTransportError(
  db: DB,
  tenantId: string,
  invoiceId: string,
  emisionId: string,
  message: string
): Promise<void> {
  const responsePayload = {
    _meta: { errorKind: "transport" as EmitErrorKind, message },
  };

  const { error: errEmis } = await db
    .from("fe_emisiones")
    .update({
      response_payload: responsePayload as unknown as object,
      autorizada: false,
    })
    .eq("tenant_id", tenantId)
    .eq("id", emisionId);
  if (errEmis) {
    console.error(
      "[efactura/orchestration] persistTransportError: UPDATE fe_emisiones falló",
      errEmis
    );
  }

  const { error: errInv } = await db
    .from("invoices")
    .update({ fe_estado: "error" })
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId);
  if (errInv) {
    // Si falla este UPDATE, queda 'pending' huérfana. Loguear y propagar.
    throw new MutationError(pgErrorToMessage(errInv), 500, errInv);
  }
}

// ---------------------------------------------------------------------------
// Parser de la respuesta del PAC
// ---------------------------------------------------------------------------

export type ParsedAuthorized = {
  kind: "authorized";
  cufe: string;
  protocoloAutorizacion: string | null;
  fechaAutorizacion: string | null;
  efInvoiceUuid: string | null;
  qrContent: string | null;
  codRes: CodRes[];
  raw: unknown;
};

/**
 * 🔴 "No sé qué contestó." Ver el comentario de `EmitErrorKind`.
 *
 * Antes esto era `pending_async` y dejaba la factura en `fe_estado='pending'`,
 * que el gate T0 considera **intocable**: nadie podía reintentar y el
 * reconciliador que iba a destrabarla no existe. Ahora deja `'error'`, que es
 * reintentable, y el mensaje dice que el estado está por confirmar en vez de
 * afirmar un rechazo.
 */
export type ParsedIncierto = {
  kind: "incierto";
  efInvoiceUuid: string | null;
  codRes: CodRes[];
  raw: unknown;
};

export type ParsedRejected = {
  kind: "rejected";
  summary: string;
  isDuplicate: boolean;
  efInvoiceUuid: string | null;
  codRes: CodRes[];
  raw: unknown;
};

export type ParsedPacResponse = ParsedAuthorized | ParsedIncierto | ParsedRejected;

/**
 * Clasifica la respuesta del POST /api/v1/Invoices en uno de tres caminos:
 *
 *   1. authorized   — autorizada=true + cufe presente. Camino feliz.
 *   2. pending_async — HTTP 200 con UUID interno pero sin CUFE confirmado.
 *                      Habrá que pollear /Authorization/{cufe} (reconciliador,
 *                      fuera de scope).
 *   3. rejected      — autorizada=false, codRes con errores, o respuesta
 *                      vacía/inesperada. isDuplicate=true si el dMsgRes
 *                      sugiere documento ya autorizado.
 */
/**
 * 🔴 UNA SOLA IMPLEMENTACIÓN, PARA FACTURAS Y PARA NOTAS DE CRÉDITO.
 *
 * Se exporta —y no se copia— porque la lección del `0600` fue exactamente
 * ésa: los códigos de un endpoint no son los de otro, y un clasificador
 * duplicado diverge sin que nadie lo note hasta que llama un rechazo a un
 * éxito. La NC `04` sale por el MISMO `POST /api/v1/Invoices` y ya está
 * medido (24/09/2026) que su respuesta trae `autorizada` explícito y `0260`,
 * igual que una factura.
 */
export function parsePacResponse(raw: unknown): ParsedPacResponse {
  if (!raw || typeof raw !== "object") {
    return {
      kind: "rejected",
      summary: "Respuesta vacía o no-JSON del PAC.",
      isDuplicate: false,
      efInvoiceUuid: null,
      codRes: [],
      raw,
    };
  }

  const r = raw as Record<string, unknown>;

  const cufe = typeof r.cufe === "string" && r.cufe.length > 0 ? r.cufe : null;
  const protocoloAutorizacion =
    typeof r.protocoloAutorizacion === "string" && r.protocoloAutorizacion.length > 0
      ? r.protocoloAutorizacion
      : null;
  const fechaAutorizacion =
    typeof r.fechaAutorizacion === "string" && r.fechaAutorizacion.length > 0
      ? r.fechaAutorizacion
      : null;
  const autorizada = typeof r.autorizada === "boolean" ? r.autorizada : null;
  const qrContent = typeof r.qrContent === "string" ? r.qrContent : null;
  // El response trae `id` (UUID del PAC) y/o `invoice` (idem). Preferimos
  // `invoice` que es el que persistimos como ef_invoice_uuid; si falta,
  // caemos a `id`.
  const efInvoiceUuid =
    (typeof r.invoice === "string" && r.invoice.length > 0
      ? r.invoice
      : typeof r.id === "string" && r.id.length > 0
        ? r.id
        : null);

  const codRes = extractCodRes(r);

  if (autorizada === true && cufe) {
    return {
      kind: "authorized",
      cufe,
      protocoloAutorizacion,
      fechaAutorizacion,
      efInvoiceUuid,
      qrContent,
      codRes,
      raw,
    };
  }

  // 🔴 RECHAZO SÓLO CUANDO EL PAC LO DICE. `autorizada` viene SIEMPRE y
  //    explícito — verificado contra dos respuestas reales del sandbox, una
  //    autorizada y una rechazada (`1601`/`1602`). Con `false` no hace falta
  //    reconocer los códigos: el PAC ya dictaminó.
  if (autorizada === false) {
    return {
      kind: "rejected",
      summary: summarizeCodRes(codRes) ?? "El PAC rechazó el documento.",
      isDuplicate: detectsDuplicate(codRes),
      efInvoiceUuid,
      codRes,
      raw,
    };
  }

  // 🔴 TODO LO DEMÁS ES INCIERTO, NO RECHAZO.
  //    Incluye el caso que antes se declaraba rechazado: códigos presentes sin
  //    un `autorizada: false` que los respalde. Ese atajo —"si hay códigos,
  //    rechazó"— es exactamente el que hizo que el endpoint de anulación
  //    informara un rechazo sobre un documento que la DGI había anulado
  //    (`0600`, 23/09/2026). Un código que no reconocemos no dice si salió bien
  //    o mal: dice que hay que mirar.
  return { kind: "incierto", efInvoiceUuid, codRes, raw };
}

function extractCodRes(r: Record<string, unknown>): CodRes[] {
  // El response del POST envuelve los códigos en
  // rRetEnviFe.xProtFe.rProtFe.gInfProt.gResProc[]. Verificado contra una
  // respuesta real del sandbox (2026-06-03). El swagger sugería el path
  // sin el wrapper `xProtFe` y por eso la versión previa devolvía vacío.
  // Mantenemos el fallback al path sin `xProtFe` por si el PAC alguna vez
  // cambia el shape de la respuesta.
  const out: CodRes[] = [];

  const ret = r.rRetEnviFe as Record<string, unknown> | undefined;
  const xProt = ret?.xProtFe as Record<string, unknown> | undefined;
  const rProt =
    (xProt?.rProtFe as Record<string, unknown> | undefined) ??
    (ret?.rProtFe as Record<string, unknown> | undefined);
  const gInf = rProt?.gInfProt as Record<string, unknown> | undefined;
  const gRes = gInf?.gResProc;

  if (Array.isArray(gRes)) {
    for (const item of gRes) {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        out.push({
          dCodRes: typeof o.dCodRes === "string" ? o.dCodRes : undefined,
          dMsgRes: typeof o.dMsgRes === "string" ? o.dMsgRes : undefined,
        });
      }
    }
  }
  return out;
}

/**
 * Duplicado REAL: el PAC señala "ya existe / ya autorizado" y NO hay ningún
 * código de rechazo duro acompañándolo. La precedencia (rechazo > duplicado)
 * y la heurística de mensajes viven en classify-pac-error.ts, que es la fuente
 * única — así el `errorKind` que se PERSISTE en fe_emisiones no puede divergir
 * del que se le muestra a la usuaria.
 *
 * Antes esto era un `.some(msg.includes("existente"))` local, que clasificaba
 * "RUC inexistente" (1602) como duplicado y tapaba el motivo real.
 */
function detectsDuplicate(codRes: CodRes[]): boolean {
  if (codRes.length === 0) return false;
  if (codRes.some(isHardRejection)) return false;
  return codRes.some(isDuplicateSignal);
}

// ---------------------------------------------------------------------------
// Builders y misc
// ---------------------------------------------------------------------------

function buildResult(r: EmitToEfacturaResult): EmitToEfacturaResult {
  return r;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}
