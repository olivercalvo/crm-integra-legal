/**
 * LA PUERTA DE ENVÍO A LA DGI (03/10/2026): todo envío de una factura, ND o NC
 * al PAC pasa por acá, y no directo por los orquestadores.
 *
 * Agrega, alrededor de `emitInvoiceToEfactura` / `emitCreditNoteToEfactura`:
 *   1. 🔴 Un documento de un MES ANTERIOR no se reenvía: «Consultar con el
 *      contador». Ante la DGI quedaría con la fecha de hoy (el payload lleva el
 *      momento del envío) y su ITBMS ya está en su mes; falta la decisión de
 *      Josuarth (docs/efactura/propuesta-alerta-no-enviadas.md, punto d).
 *   2. Las validaciones previas (`validarParaLaDgi`) ANTES del correlativo
 *      fiscal, también para lo emitido antes de que existieran.
 *   3. El MOTIVO guardado en el documento (085): validación previa, rechazo del
 *      PAC o falla de conexión. Se limpia cuando la DGI autoriza.
 *
 * Los orquestadores quedan como estaban (y sus tests también); las rutas y
 * `envio-al-emitir.ts` llaman a estas dos funciones.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { hoyEnPanama } from "@/lib/utils/hoy-en-panama";
import { validarParaLaDgi, resumirProblemas } from "@/lib/finanzas/efactura/validaciones-previas";
import {
  cargarFacturaParaValidar,
  cargarNotaDeCreditoParaValidar,
  guardarMotivoPendiente,
} from "@/lib/finanzas/efactura/data/datos-para-validar";
import { emitInvoiceToEfactura, type EmitToEfacturaResult } from "./emit-invoice-to-efactura";
import { emitCreditNoteToEfactura, type EmitCreditNoteResult } from "./emit-credit-note-to-efactura";

type DB = SupabaseClient;

export const MENSAJE_MES_ANTERIOR =
  "Consultar con el contador antes de reenviar: el documento es de un mes anterior. Ante la DGI quedaría con la fecha de hoy y su ITBMS ya está en el mes del documento.";

/** `true` si la fecha del documento es de un mes anterior al de hoy en Panamá. */
export function esDeUnMesAnterior(fechaDocumento: string, hoy: string = hoyEnPanama()): boolean {
  return String(fechaDocumento).slice(0, 7) < hoy.slice(0, 7);
}

/** Los estados desde los que un envío tiene sentido; los demás los rechaza el orquestador. */
const ENVIABLE = new Set(["no_emitida", "error"]);

/**
 * Un documento que YA existe ante la DGI no se manda, y se corta ANTES que el
 * resto: antes del mes anterior (que daría un motivo equivocado) y antes de las
 * validaciones previas (que le guardarían un `fe_motivo_pendiente` a una
 * factura que la DGI ya autorizó). `externo` = emitida fuera del CRM (092);
 * cualquier otro CUFE con `no_emitida`/`error` = cargado del portal (caso B).
 * El orquestador tiene su propio corte para el caso B; éste es el primero.
 */
/** Por qué un documento de prueba no se manda a la DGI. */
export const MENSAJE_DOCUMENTO_DE_PRUEBA_A_LA_DGI =
  "Este documento está marcado de prueba: no se envía a la DGI ni cuenta en los reportes.";

export function motivoParaNoEnviar(origen: string | null | undefined, cufe: string | null | undefined): string | null {
  if (origen === "externo") {
    return "Esta factura se emitió fuera del CRM y ya existe ante la DGI: el CRM sólo la registra en sus libros y no la envía.";
  }
  if (cufe && cufe.trim().length > 0) {
    return "Este documento ya existe ante la DGI: tiene un CUFE cargado. No se vuelve a enviar, porque sería un segundo documento fiscal por la misma operación.";
  }
  return null;
}

async function metaDelDocumento(db: DB, tenantId: string, tabla: "invoices" | "credit_notes", id: string) {
  const columnas = tabla === "invoices"
    ? "issue_date, fe_estado, dgi_cufe, dgi_cufe_origen, de_prueba"
    : "issue_date, fe_estado, dgi_cufe, de_prueba";
  const { data, error } = await db.from(tabla).select(columnas).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  if (!data) throw new MutationError("Documento no encontrado", 404);
  const d = data as unknown as {
    issue_date: string; fe_estado: string | null; dgi_cufe?: string | null; dgi_cufe_origen?: string | null; de_prueba?: boolean;
  };
  return {
    issueDate: String(d.issue_date),
    feEstado: String(d.fe_estado ?? "no_emitida"),
    cufe: d.dgi_cufe ?? null,
    origen: d.dgi_cufe_origen ?? null,
    dePrueba: d.de_prueba === true,
  };
}

async function antesDeEnviar(
  db: DB,
  tenantId: string,
  tabla: "invoices" | "credit_notes",
  id: string
): Promise<boolean> {
  const meta = await metaDelDocumento(db, tenantId, tabla, id);
  // 🔴 Un documento de prueba (094) nunca va a la DGI, en ningún estado. Las de
  // prueba de producción tienen fe_estado `error` o `no_emitida`: sin esto,
  // «Reenviar a la DGI» las mandaría.
  if (meta.dePrueba) throw new MutationError(MENSAJE_DOCUMENTO_DE_PRUEBA_A_LA_DGI, 409);
  // Autorizada, en curso o interna: que conteste el orquestador con su mensaje.
  if (!ENVIABLE.has(meta.feEstado)) return false;

  const yaExiste = motivoParaNoEnviar(meta.origen, meta.cufe);
  if (yaExiste) throw new MutationError(yaExiste, 409);

  if (esDeUnMesAnterior(meta.issueDate)) {
    throw new MutationError(MENSAJE_MES_ANTERIOR, 409);
  }

  const doc =
    tabla === "invoices"
      ? await cargarFacturaParaValidar(db, tenantId, id)
      : await cargarNotaDeCreditoParaValidar(db, tenantId, id);
  const problemas = validarParaLaDgi(doc);
  if (problemas.length > 0) {
    const resumen = resumirProblemas(problemas);
    await guardarMotivoPendiente(db, tenantId, tabla, id, `No se envió a la DGI: hay que corregir antes.\n${resumen}`);
    throw new MutationError(`No se puede enviar a la DGI: la rechazaría. Corrija esto y vuelva a intentarlo:\n${resumen}`, 422);
  }
  return true;
}

function motivoDeRechazo(mensaje: string | null, hint: string | null | undefined, feEstado: string): string {
  const base =
    feEstado === "pending"
      ? "El PAC no dio una respuesta clara: no se sabe si la DGI la autorizó."
      : `La DGI no la autorizó: ${mensaje ?? "sin detalle del PAC"}`;
  return hint ? `${base}\n${hint}` : base;
}

/** Envía una factura o ND al PAC, con las tres reglas del encabezado. */
export async function enviarFacturaALaDgi(
  db: DB,
  tenantId: string,
  userId: string,
  invoiceId: string
): Promise<EmitToEfacturaResult> {
  const valida = await antesDeEnviar(db, tenantId, "invoices", invoiceId);
  let r: EmitToEfacturaResult;
  try {
    r = await emitInvoiceToEfactura(db, tenantId, userId, invoiceId);
  } catch (err) {
    if (valida && err instanceof MutationError && err.status < 500) {
      await guardarMotivoPendiente(db, tenantId, "invoices", invoiceId, `No se envió a la DGI: ${err.message}`);
    } else if (valida) {
      await guardarMotivoPendiente(db, tenantId, "invoices", invoiceId, `Falló el envío a la DGI: ${err instanceof Error ? err.message : String(err)}`);
    }
    throw err;
  }
  await guardarMotivoPendiente(
    db,
    tenantId,
    "invoices",
    invoiceId,
    r.feEstado === "authorized" ? null : motivoDeRechazo(r.errorMessage, r.errorHint, r.feEstado)
  );
  return r;
}

/** Envía una NC al PAC, con las tres reglas del encabezado. */
export async function enviarNotaDeCreditoALaDgi(
  db: DB,
  tenantId: string,
  userId: string,
  creditNoteId: string
): Promise<EmitCreditNoteResult> {
  const valida = await antesDeEnviar(db, tenantId, "credit_notes", creditNoteId);
  let r: EmitCreditNoteResult;
  try {
    r = await emitCreditNoteToEfactura(db, tenantId, userId, creditNoteId);
  } catch (err) {
    if (valida) {
      const m = err instanceof Error ? err.message : String(err);
      await guardarMotivoPendiente(db, tenantId, "credit_notes", creditNoteId, `No se envió a la DGI: ${m}`);
    }
    throw err;
  }
  await guardarMotivoPendiente(
    db,
    tenantId,
    "credit_notes",
    creditNoteId,
    r.ok ? null : motivoDeRechazo(r.mensaje, null, r.feEstado)
  );
  return r;
}
