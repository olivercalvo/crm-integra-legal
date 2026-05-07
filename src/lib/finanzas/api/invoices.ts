/**
 * Helpers server-side para mutaciones de facturas. Llamados desde route
 * handlers `/api/finanzas/invoices/...`. NO marcar 'use server' — son
 * funciones server-side puras invocadas dentro de route handlers Next.js.
 *
 * Patrón consistente con /legal: admin client (bypass RLS) + filter manual
 * por tenant_id. Cada función recibe el client + tenantId del contexto
 * autenticado del route handler.
 *
 * TODO(hardening): migrar a RPC create_invoice_with_lines (SECURITY DEFINER)
 * para atomicidad real con transacción server-side. Por ahora compensating
 * delete es safe-enough para MVP. Ver migración 20260505000004 que ya
 * anticipaba esta RPC.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateInvoiceInput,
  UpdateInvoiceInput,
  UpdateInvoiceDgiInput,
  InvoiceKind,
} from "@/lib/finanzas/types/invoice";
import { SEQUENCE_TYPE_BY_KIND, PREFIX_BY_KIND } from "@/lib/finanzas/types/invoice";

type DB = SupabaseClient;

export class InvoiceMutationError extends Error {
  /** Código HTTP sugerido para devolver. */
  status: number;
  /** Detalles internos para logging (NO mostrar al usuario). */
  detail?: unknown;
  constructor(message: string, status = 400, detail?: unknown) {
    super(message);
    this.name = "InvoiceMutationError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Mapea errores de Postgres (incluyendo RAISE de los triggers T1-T8b) a
 * mensajes friendly en español. Si no matchea, devuelve el message tal cual
 * (los triggers ya tienen mensajes en español).
 */
function pgErrorToMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "Error desconocido";
  const e = err as { message?: string; code?: string; details?: string };
  // Los RAISE EXCEPTION de los triggers vienen en .message, ya en español.
  if (e.message) {
    // Stripe el prefijo "new row violates check constraint" si aparece.
    if (e.code === "23514" && e.details) {
      return `Validación rechazada por la base de datos: ${e.details}`;
    }
    return e.message;
  }
  return "Error desconocido al procesar la operación";
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

/**
 * Crea una factura en estado borrador con sus líneas.
 *
 * Flujo (compensating delete pattern):
 *   1. INSERT invoices (header) con totales=0 e invoice_number temporal vacío
 *      → trigger T8b se ejecutará al insertar líneas y va a recalcular.
 *   2. INSERT invoice_lines (bulk) — si falla, hacemos DELETE del header.
 *   3. SELECT invoices recalculadas → devolvemos al caller.
 *
 * El `invoice_number` se asigna recién al EMITIR (D2). En borrador queda
 * como string vacío "" (NOT NULL pero sí vacío) — el constraint
 * invoices_tenant_number_unique permite múltiples vacíos por tenant en
 * Postgres porque '' = '' devuelve TRUE — entonces el constraint UNIQUE
 * SÍ los considera duplicados. Solución: generar un slug único temporal
 * "DRAFT-<uuid>" en borrador, reemplazado al emitir.
 */
export async function createInvoice(
  db: DB,
  tenantId: string,
  userId: string,
  input: CreateInvoiceInput
) {
  // Slug único temporal para borradores. Al emitir se reemplaza por el
  // número real ("FAC-HON-000454"). Esto sortea el UNIQUE (tenant, number).
  const draftSlug = `DRAFT-${cryptoRandom()}`;

  const { data: header, error: errHeader } = await db
    .from("invoices")
    .insert({
      tenant_id: tenantId,
      invoice_number: draftSlug,
      invoice_kind: input.invoice_kind,
      client_id: input.client_id,
      case_id: input.case_id,
      issue_date: input.issue_date,
      due_date: input.due_date,
      status: "borrador",
      currency: "USD",
      notes: input.notes,
      created_by: userId,
      // totales se quedan en 0 — T8b los recalcula al insertar líneas
    })
    .select("id")
    .single();

  if (errHeader || !header) {
    throw new InvoiceMutationError(pgErrorToMessage(errHeader), 400, errHeader);
  }

  const invoiceId = header.id as string;

  // INSERT bulk de líneas. Trigger T8b recalcula totales al final.
  const linesPayload = input.lines.map((ln, idx) => ({
    tenant_id: tenantId,
    invoice_id: invoiceId,
    line_order: idx,
    service_id: ln.service_id,
    description: ln.description,
    quantity: ln.quantity,
    unit_price: ln.unit_price,
    tax_code: ln.tax_code,
    tax_rate: ln.tax_rate,
    tax_code_id: ln.tax_code_id,
    created_by: userId,
  }));

  const { error: errLines } = await db.from("invoice_lines").insert(linesPayload);

  if (errLines) {
    // COMPENSATING DELETE — header sin líneas no debe quedar.
    // T6 permite borrar borradores. Si DELETE falla por red caída,
    // queda residuo (totals=0) que se limpia aparte.
    await db.from("invoices").delete().eq("tenant_id", tenantId).eq("id", invoiceId);
    throw new InvoiceMutationError(pgErrorToMessage(errLines), 400, errLines);
  }

  return { id: invoiceId };
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

/**
 * Actualiza una factura en estado borrador. Las líneas se diffean:
 *   - Líneas con `id` que ya existían: UPDATE in-place
 *   - Líneas sin `id` (nuevas): INSERT
 *   - Líneas que existían en BD y ya no están en el input: DELETE
 *
 * Si la factura no está en borrador, T4/T5c/T6 van a rechazar y devolvemos
 * el mensaje del trigger.
 */
export async function updateInvoice(
  db: DB,
  tenantId: string,
  userId: string,
  invoiceId: string,
  input: UpdateInvoiceInput
) {
  // 1. UPDATE header. Si la factura no está en borrador, T4 rechaza con
  //    mensaje claro.
  const { error: errHeader } = await db
    .from("invoices")
    .update({
      invoice_kind: input.invoice_kind,
      client_id: input.client_id,
      case_id: input.case_id,
      issue_date: input.issue_date,
      due_date: input.due_date,
      notes: input.notes,
    })
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId);

  if (errHeader) {
    throw new InvoiceMutationError(pgErrorToMessage(errHeader), 400, errHeader);
  }

  // 2. Diff de líneas. Cargamos las existentes para saber cuáles borrar.
  const { data: existing, error: errExisting } = await db
    .from("invoice_lines")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId);

  if (errExisting) {
    throw new InvoiceMutationError(pgErrorToMessage(errExisting), 500, errExisting);
  }

  const existingIds = new Set((existing ?? []).map((l) => l.id as string));
  const inputIds = new Set(
    input.lines.filter((l) => !!l.id).map((l) => l.id as string)
  );

  const toDelete = Array.from(existingIds).filter((id) => !inputIds.has(id));
  const toUpdate = input.lines.filter((l) => l.id && existingIds.has(l.id));
  const toInsert = input.lines.filter((l) => !l.id);

  // 2a. DELETE líneas removidas
  if (toDelete.length > 0) {
    const { error: errDel } = await db
      .from("invoice_lines")
      .delete()
      .eq("tenant_id", tenantId)
      .in("id", toDelete);
    if (errDel) {
      throw new InvoiceMutationError(pgErrorToMessage(errDel), 400, errDel);
    }
  }

  // 2b. UPDATE líneas existentes — una por una. Volumen esperado: 1-10
  //     líneas, no vale la pena batchear con upsert.
  for (const ln of toUpdate) {
    const idx = input.lines.indexOf(ln);
    const { error: errUpd } = await db
      .from("invoice_lines")
      .update({
        line_order: idx,
        service_id: ln.service_id,
        description: ln.description,
        quantity: ln.quantity,
        unit_price: ln.unit_price,
        tax_code: ln.tax_code,
        tax_rate: ln.tax_rate,
        tax_code_id: ln.tax_code_id,
      })
      .eq("tenant_id", tenantId)
      .eq("id", ln.id!);
    if (errUpd) {
      throw new InvoiceMutationError(pgErrorToMessage(errUpd), 400, errUpd);
    }
  }

  // 2c. INSERT líneas nuevas
  if (toInsert.length > 0) {
    const payload = toInsert.map((ln) => {
      const idx = input.lines.indexOf(ln);
      return {
        tenant_id: tenantId,
        invoice_id: invoiceId,
        line_order: idx,
        service_id: ln.service_id,
        description: ln.description,
        quantity: ln.quantity,
        unit_price: ln.unit_price,
        tax_code: ln.tax_code,
        tax_rate: ln.tax_rate,
        tax_code_id: ln.tax_code_id,
        created_by: userId,
      };
    });
    const { error: errIns } = await db.from("invoice_lines").insert(payload);
    if (errIns) {
      throw new InvoiceMutationError(pgErrorToMessage(errIns), 400, errIns);
    }
  }

  return { id: invoiceId };
}

// ---------------------------------------------------------------------------
// EMIT
// ---------------------------------------------------------------------------

/**
 * Genera el invoice_number con get_next_sequence_number() y transiciona el
 * status a 'emitida'. T2 valida la transición.
 *
 * Atomicidad: el SELECT FOR UPDATE dentro de la función SQL bloquea la
 * fila numbering_sequences. Si entre el RPC y el UPDATE invoices algo
 * falla, el número quedaría consumido sin asignar (gap). Aceptable para
 * MVP — Daveiva ya tiene gaps históricos de QuickBooks.
 */
export async function emitInvoice(
  db: DB,
  tenantId: string,
  invoiceId: string
) {
  // 1. Cargar la factura para conocer su kind (necesario para sequence_type).
  const { data: inv, error: errFetch } = await db
    .from("invoices")
    .select("id, invoice_kind, status")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (errFetch) {
    throw new InvoiceMutationError(pgErrorToMessage(errFetch), 500, errFetch);
  }
  if (!inv) {
    throw new InvoiceMutationError("Factura no encontrada", 404);
  }
  if (inv.status !== "borrador") {
    throw new InvoiceMutationError(
      `No se puede emitir la factura: está en estado ${inv.status}`,
      400
    );
  }

  // 2. Validación de líneas: el trigger T8b mantiene los totales pero NO
  //    obliga a que existan líneas al emitir. Acá la app lo hace cumplir
  //    para evitar facturas emitidas con grand_total=0.
  const { count: lineCount, error: errCount } = await db
    .from("invoice_lines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId);
  if (errCount) {
    throw new InvoiceMutationError(pgErrorToMessage(errCount), 500, errCount);
  }
  if (!lineCount || lineCount === 0) {
    throw new InvoiceMutationError(
      "La factura no tiene líneas. Agrega al menos una antes de emitir.",
      400
    );
  }

  // 3. Llamar a la RPC SECURITY DEFINER del schema. Devuelve el INT del
  //    siguiente número en la secuencia.
  const sequenceType = SEQUENCE_TYPE_BY_KIND[inv.invoice_kind as InvoiceKind];
  const { data: nextNumber, error: errSeq } = await db.rpc(
    "get_next_sequence_number",
    {
      p_tenant_id: tenantId,
      p_sequence_type: sequenceType,
    }
  );

  if (errSeq || typeof nextNumber !== "number") {
    throw new InvoiceMutationError(pgErrorToMessage(errSeq), 500, errSeq);
  }

  const formatted = `${PREFIX_BY_KIND[inv.invoice_kind as InvoiceKind]}-${String(
    nextNumber
  ).padStart(6, "0")}`;

  // 4. UPDATE status='emitida' + invoice_number=formatted. T2 valida.
  const { error: errUpd } = await db
    .from("invoices")
    .update({
      invoice_number: formatted,
      status: "emitida",
    })
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId);

  if (errUpd) {
    throw new InvoiceMutationError(pgErrorToMessage(errUpd), 400, errUpd);
  }

  return { id: invoiceId, invoice_number: formatted };
}

/**
 * Devuelve el SIGUIENTE número (preview) sin consumir la secuencia. Útil
 * para mostrar en el dialog de confirmación de emisión. NO bloquea — si
 * dos requests preview-an y luego uno emite, el otro va a ver un número
 * desactualizado, pero eso es esperable.
 */
export async function previewNextInvoiceNumber(
  db: DB,
  tenantId: string,
  kind: InvoiceKind
): Promise<string | null> {
  const sequenceType = SEQUENCE_TYPE_BY_KIND[kind];
  const { data, error } = await db
    .from("numbering_sequences")
    .select("last_number")
    .eq("tenant_id", tenantId)
    .eq("sequence_type", sequenceType)
    .maybeSingle();

  if (error || !data) return null;

  const next = (data.last_number as number) + 1;
  return `${PREFIX_BY_KIND[kind]}-${String(next).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

/**
 * Elimina una factura. T6 rechaza con mensaje claro si no está en borrador.
 * El CASCADE de invoice_lines limpia las líneas automáticamente.
 */
export async function deleteInvoice(
  db: DB,
  tenantId: string,
  invoiceId: string
) {
  const { error } = await db
    .from("invoices")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId);

  if (error) {
    throw new InvoiceMutationError(pgErrorToMessage(error), 400, error);
  }
  return { id: invoiceId };
}

// ---------------------------------------------------------------------------
// DGI (eFactura) — registro manual pre-integración PAC (Camino 1)
// ---------------------------------------------------------------------------

/**
 * Resultado de validación de los datos DGI. Mensajes en español, mapa flat
 * `campo → mensaje` consistente con validateCreateInvoice().
 */
export type DgiValidationErrors = Partial<
  Record<keyof UpdateInvoiceDgiInput, string>
>;

/**
 * Valida el payload DGI. Reglas (FAQ):
 *
 *   - dgi_numero_documento: opcional. Si se provee, exactamente 10 dígitos
 *     numéricos (formato '0000001234'). El backend NO lo deja en estado
 *     intermedio — o se manda válido o vacío/null.
 *   - dgi_cufe: opcional. Cualquier string trimeado no vacío.
 *   - dgi_fecha_autorizacion: opcional. Si se provee, debe parsear como
 *     fecha válida (Date.parse !== NaN). El frontend manda ISO 8601.
 *   - dgi_cafe_url: opcional. Si se provee, parseable por `new URL()`.
 *
 * Mantenemos las reglas server-side aún cuando el form ya valida — defensa
 * en profundidad. La UI puede enforzar adicionalmente que numero y fecha
 * sean obligatorios para "completar" el flujo, pero el endpoint acepta
 * guardados parciales.
 */
export function validateDgiInput(
  raw: Partial<UpdateInvoiceDgiInput> | null | undefined
): { ok: true; data: UpdateInvoiceDgiInput } | { ok: false; errors: DgiValidationErrors } {
  const errors: DgiValidationErrors = {};

  // Helper: trim + null-if-empty.
  const norm = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };

  const numero = norm(raw?.dgi_numero_documento);
  const cufe = norm(raw?.dgi_cufe);
  const fecha = norm(raw?.dgi_fecha_autorizacion);
  const url = norm(raw?.dgi_cafe_url);

  if (numero !== null && !/^\d{10}$/.test(numero)) {
    errors.dgi_numero_documento =
      "El número DGI debe ser exactamente 10 dígitos numéricos (formato 0000001234).";
  }

  if (fecha !== null) {
    const parsed = Date.parse(fecha);
    if (isNaN(parsed)) {
      errors.dgi_fecha_autorizacion = "Fecha de autorización inválida.";
    }
  }

  if (url !== null) {
    try {
      // `new URL()` rechaza strings que no son URL absolutas válidas.
      new URL(url);
    } catch {
      errors.dgi_cafe_url = "URL del CAFE inválida.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      dgi_numero_documento: numero,
      dgi_cufe: cufe,
      dgi_fecha_autorizacion: fecha,
      dgi_cafe_url: url,
    },
  };
}

/**
 * Actualiza los 4 campos DGI de una factura. SOLO debe llamarse para
 * facturas en status='emitida' — ni borrador (no tiene sentido) ni anulada
 * (cerrada). El handler debe gate-ear ese estado antes de llamar.
 *
 * Las 4 columnas no están en la whitelist de T4 (trg_invoice_immutability),
 * así que la DB no las bloquea aún en facturas emitidas. Eso es por diseño
 * (decisión D5 del sprint).
 */
export async function updateInvoiceDgiData(
  db: DB,
  tenantId: string,
  invoiceId: string,
  input: UpdateInvoiceDgiInput
) {
  // Verificá que la factura existe y está en un estado donde tiene sentido
  // capturar datos DGI. Si está en borrador, esto es prematuro; si está
  // cancelada_pre_emision, no hay nada que registrar.
  const { data: inv, error: errFetch } = await db
    .from("invoices")
    .select("id, status, invoice_number")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (errFetch) {
    throw new InvoiceMutationError(pgErrorToMessage(errFetch), 500, errFetch);
  }
  if (!inv) {
    throw new InvoiceMutationError("Factura no encontrada", 404);
  }
  if (inv.status === "borrador" || inv.status === "cancelada_pre_emision") {
    throw new InvoiceMutationError(
      "No se puede registrar datos DGI en una factura que aún no fue emitida.",
      400
    );
  }

  const { error: errUpd } = await db
    .from("invoices")
    .update({
      dgi_numero_documento: input.dgi_numero_documento,
      dgi_cufe: input.dgi_cufe,
      dgi_fecha_autorizacion: input.dgi_fecha_autorizacion,
      dgi_cafe_url: input.dgi_cafe_url,
    })
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId);

  if (errUpd) {
    throw new InvoiceMutationError(pgErrorToMessage(errUpd), 400, errUpd);
  }

  return { id: invoiceId };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Random 12 hex chars usando Web Crypto (Node 20+). */
function cryptoRandom(): string {
  const arr = new Uint8Array(6);
  // Edge / Node 20 ambos exponen globalThis.crypto
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
