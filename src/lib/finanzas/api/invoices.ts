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
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { createCreditNoteFromInvoice, compensarNotaDeCredito } from "@/lib/finanzas/api/credit-notes";
import { construirAsientoDeReversion } from "@/lib/finanzas/contabilidad/reversion";
import { cargarAsientosPorOrigen } from "@/lib/finanzas/queries/payments";
import { postJournalEntry } from "@/lib/finanzas/contabilidad/posting";
import { construirAsientoDeFactura } from "@/lib/finanzas/contabilidad/asiento-factura";
import { cargarFacturaParaAsiento } from "@/lib/finanzas/queries/factura-para-asiento";
import { validarCufe } from "@/lib/finanzas/validators/cufe";
import {
  validarConsistenciaDeKind,
  motivoDeInconsistenciaDeKind,
  type ServicioParaConsistenciaDeKind,
} from "@/lib/finanzas/validators/invoice";

type DB = SupabaseClient;
/**
 * Resuelve `service_id → {code, name, service_type}` para las líneas de una
 * factura, filtrado por TENANT. Es lo que le da a `validarConsistenciaDeKind()`
 * (módulo puro, sin base) algo contra qué comparar, resuelto por el servidor y
 * no por lo que mande el body — mismo criterio que `resolverCodigosDeImpuesto`
 * en `api/tax-codes.ts` (migración `045`, 16/09/2026, en `develop`; este helper
 * viajó solo a `main` en el hotfix del 18/09, así que ahí esa referencia no
 * existe todavía).
 *
 * ⚠️ `services_catalog.id` NO tiene FK compuesta con tenant_id (es un FK
 * global, igual que `expense_lines.tax_code_id` antes de esa migración). Sin
 * el `.eq("tenant_id", tenantId)` de acá, un `service_id` de otro bufete
 * pasaría la consulta igual — este helper cierra esa grieta de paso, aunque no
 * sea el motivo por el que se escribió.
 *
 * Ids que no existen o no son de este tenant simplemente no aparecen en el
 * Map — `validarConsistenciaDeKind()` los ignora (no hay contra qué comparar;
 * si el `service_id` es inválido de otra forma, eso lo rechaza la FK de la
 * base al insertar, con su propio mensaje).
 */
async function resolverServiciosPorId(
  db: DB,
  tenantId: string,
  serviceIds: readonly (string | null)[]
): Promise<Map<string, ServicioParaConsistenciaDeKind>> {
  const unicos = Array.from(new Set(serviceIds.filter((id): id is string => !!id)));
  const resueltos = new Map<string, ServicioParaConsistenciaDeKind>();
  if (unicos.length === 0) return resueltos;

  const { data, error } = await db
    .from("services_catalog")
    .select("id, code, name, service_type")
    .eq("tenant_id", tenantId)
    .in("id", unicos);

  if (error) {
    console.error("[finanzas] resolverServiciosPorId failed", error);
    throw new MutationError("No se pudo leer el catálogo de servicios", 500, error);
  }

  for (const s of (data ?? []) as { id: string; code: string; name: string; service_type: string }[]) {
    resueltos.set(s.id, { code: s.code, name: s.name, service_type: s.service_type });
  }
  return resueltos;
}

/**
 * El guard: ninguna línea con `service_id` puede pertenecer a un
 * `service_type` que no combine con el `invoice_kind` de la factura. Corre
 * ANTES de cualquier INSERT/UPDATE de línea, en `createInvoice` y
 * `updateInvoice` — son los DOS ÚNICOS lugares del código que escriben en
 * `invoice_lines` (confirmado por grep sobre todo `src/`, 17/09/2026), así que
 * ponerlo acá cubre también la conversión de cotizaciones (`convertToInvoices`
 * llama a `createInvoice` directamente).
 *
 * Bloqueo duro, en los dos sentidos — decisión de Oliver, 17/09/2026: una
 * advertencia dismissible es el mismo mecanismo por el que ya pasó tres veces
 * en producción (tres facturas FAC-REI-* con líneas HON-COR, jul-ago/2026).
 */
async function validarLineasContraKind(
  db: DB,
  tenantId: string,
  invoiceKind: InvoiceKind,
  lineas: readonly { service_id: string | null; description: string }[]
): Promise<void> {
  const servicios = await resolverServiciosPorId(
    db,
    tenantId,
    lineas.map((l) => l.service_id)
  );
  const fieldErrors = validarConsistenciaDeKind(lineas, servicios, invoiceKind);
  if (Object.keys(fieldErrors).length === 0) return;

  const motivo = motivoDeInconsistenciaDeKind(lineas, servicios, invoiceKind);
  throw new MutationError(
    motivo ?? "Alguna línea no combina con el tipo de documento.",
    400,
    undefined,
    fieldErrors
  );
}


/**
 * Alias mantenido por backwards compatibility con los route handlers de
 * /api/finanzas/invoices/* que ya importan `InvoiceMutationError`. Los
 * módulos nuevos (quotes, etc.) deben importar `MutationError` directamente
 * desde `./errors`.
 */
export const InvoiceMutationError = MutationError;
export type InvoiceMutationError = MutationError;
export { pgErrorToMessage };

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
  // Gate: el cliente debe estar en estado 'active' para emitir factura. Los
  // prospects (creados inline desde una cotización) NO son facturables hasta
  // que un admin los promueva manualmente desde el módulo Clientes (D12).
  // Sprint 2E.1 — agregado al introducir client_status.
  const { data: client, error: errClient } = await db
    .from("clients")
    .select("client_status")
    .eq("tenant_id", tenantId)
    .eq("id", input.client_id)
    .maybeSingle();

  if (errClient) {
    throw new MutationError(pgErrorToMessage(errClient), 500, errClient);
  }
  if (!client) {
    throw new MutationError("Cliente no encontrado", 404);
  }
  const clientStatus = client.client_status as string;
  if (clientStatus !== "active") {
    const stateLabel = clientStatus === "prospect" ? "prospecto" : clientStatus;
    throw new MutationError(
      `No se puede emitir factura a un cliente en estado '${stateLabel}'. El cliente debe estar activo (datos completos) para poder facturar.`,
      400
    );
  }

  // 🔴 Ninguna línea puede pertenecer a un service_type que no combine con
  //    este invoice_kind (17/09/2026). Corre ANTES de insertar nada: si
  //    rechaza, no queda ni el encabezado ni las líneas — no hace falta
  //    DELETE compensatorio para un documento que nunca llegó a existir.
  await validarLineasContraKind(db, tenantId, input.invoice_kind, input.lines);

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
  // 0. Ninguna línea puede pertenecer a un service_type que no combine con el
  //    invoice_kind que se está por guardar (17/09/2026). Corre ANTES del
  //    UPDATE del encabezado: es exactamente el hueco reportado — cambiar el
  //    "Tipo de documento" con líneas ya cargadas, sin que nada las revise.
  await validarLineasContraKind(db, tenantId, input.invoice_kind, input.lines);

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

/** El asiento `factura` de una factura, si ya está en el libro (FND-011). */
interface AsientoDeFactura {
  entry_number: number;
  reference: string | null;
}

async function asientoDeFacturaExistente(
  ledgerDb: DB,
  tenantId: string,
  invoiceId: string
): Promise<AsientoDeFactura | null> {
  const { data, error } = await ledgerDb
    .from("journal_entries")
    .select("entry_number, reference")
    .eq("tenant_id", tenantId)
    .eq("source_type", "factura")
    .eq("source_id", invoiceId)
    .maybeSingle();
  if (error) {
    throw new InvoiceMutationError(pgErrorToMessage(error), 500, error);
  }
  if (!data) return null;
  return {
    entry_number: Number((data as { entry_number: number }).entry_number),
    reference: ((data as { reference: string | null }).reference ?? null) as string | null,
  };
}

/**
 * El número con el que un asiento ya escrito nombra a su factura. Está en
 * `reference` desde la `039`; sin él no se puede saber con qué número se posteó
 * y la emisión se detiene en vez de inventar uno (FND-011).
 */
function numeroDelAsiento(asiento: AsientoDeFactura): string {
  if (!asiento.reference) {
    throw new InvoiceMutationError(
      `Esta factura ya tiene el asiento ${asiento.entry_number} en el libro, pero ese asiento no ` +
        `registra con qué número se posteó. No se emite para no ponerle uno distinto al del libro: ` +
        `avisale a Oliver.`,
      409
    );
  }
  return asiento.reference;
}

/**
 * 🔴 El número que se va a escribir no puede pertenecer a OTRA factura.
 *
 * Es el guard de FND-011: se corre ANTES de postear. Si la secuencia quedó
 * detrás de las facturas emitidas (un seed que la rebobinó, una restauración
 * parcial), el UPDATE del paso 4 fallaría por `invoices_tenant_number_unique`
 * **después** de que el asiento ya está en el libro, y ese asiento queda para
 * siempre con el número de otro documento.
 */
async function asegurarNumeroLibre(
  db: DB,
  tenantId: string,
  invoiceId: string,
  formatted: string,
  asientoPrevio: AsientoDeFactura | null
): Promise<void> {
  const { data, error } = await db
    .from("invoices")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("invoice_number", formatted)
    .maybeSingle();
  if (error) {
    throw new InvoiceMutationError(pgErrorToMessage(error), 500, error);
  }
  const duenio = (data as { id: string } | null)?.id ?? null;
  if (!duenio || duenio === invoiceId) return;

  if (asientoPrevio) {
    throw new InvoiceMutationError(
      `Esta factura ya tiene el asiento ${asientoPrevio.entry_number} con el número ${formatted}, ` +
        `que hoy pertenece a otra factura. No se puede emitir sin corregir el libro: avisale a Oliver.`,
      409
    );
  }
  throw new InvoiceMutationError(
    `El número ${formatted} ya pertenece a otra factura: la numeración quedó detrás de las facturas ` +
      `emitidas. No se emitió nada y no se registró ningún asiento. Avisale a Oliver para realinearla.`,
    409
  );
}

/**
 * Genera el invoice_number con get_next_sequence_number(), **registra el asiento
 * contable** y transiciona el status a 'emitida'. T2 valida la transición.
 *
 * Atomicidad: el SELECT FOR UPDATE dentro de la función SQL bloquea la
 * fila numbering_sequences. Si entre el RPC y el UPDATE invoices algo
 * falla, el número quedaría consumido sin asignar (gap). Aceptable para
 * MVP — Daveiva ya tiene gaps históricos de QuickBooks.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EL ASIENTO SE POSTEA ANTES DE EMITIR, Y SI FALLA NO SE EMITE
 * ═════════════════════════════════════════════════════════════════════════════
 * El orden es: correlativo → asiento → UPDATE a 'emitida'. **No hay transacción
 * que abarque las tres cosas**: el correlativo y el UPDATE van por supabase-js y
 * el asiento por un RPC con otro cliente. Así que hay que elegir de qué lado cae
 * el error, y se eligió éste:
 *
 *   · Si el asiento falla → la factura queda en BORRADOR, sin número escrito.
 *     Se corrige la configuración y se vuelve a emitir.
 *   · Si emitiéramos primero → una factura emitida sin asiento. Eso es una
 *     divergencia SILENCIOSA entre el documento y el libro, que es exactamente
 *     lo que este módulo existe para impedir.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 Y EL NÚMERO SE VERIFICA ANTES DE POSTEAR (FND-011, 22/09/2026)
 * ═════════════════════════════════════════════════════════════════════════════
 * El asiento lleva el número en `reference` y en su descripción, y se postea
 * ANTES del UPDATE que escribe ese número en la factura. Si el UPDATE falla por
 * el UNIQUE `invoices_tenant_number_unique` —la secuencia quedó DETRÁS de las
 * facturas ya emitidas— el asiento queda en el libro con un número que la
 * factura nunca recibe, y que además pertenece a OTRA factura. Pasó el 22/09 en
 * staging (asiento 43 con `FAC-HON-000007` sobre un borrador) porque el seed
 * rebobinaba `numbering_sequences`.
 *
 * Dos cierres, los dos acá:
 *
 *   1. **Guard antes de postear** (`asegurarNumeroLibre`): si el número ya es de
 *      otra factura, se corta con 409 y **no se postea nada**. El hueco en la
 *      secuencia se acepta; un asiento con número ajeno, no.
 *   2. **El reintento toma el número DEL ASIENTO** (`asientoDeFacturaExistente`),
 *      no uno nuevo de la secuencia. Lo hace posible el UNIQUE
 *      `journal_entries_un_asiento_por_documento` (tenant, source_type,
 *      source_id) de la `034`: el asiento de una factura es único y se puede
 *      buscar por su documento. Así factura y libro dicen SIEMPRE lo mismo.
 *
 * ⚠️ **El correlativo SÍ se pierde igual.** `get_next_sequence_number` ya
 * consumió el número cuando el asiento falla, y no se devuelve: la secuencia no
 * tiene rollback y dos emisiones concurrentes no pueden compartir un número. O
 * sea que un intento fallido deja un HUECO en la numeración. Es el mismo gap que
 * el comentario de arriba ya aceptaba para el caso del UPDATE fallido; lo que
 * cambia es que ahora hay una causa más probable que un error de red — un
 * servicio mal configurado. Se acepta a conciencia: un hueco en la numeración se
 * explica, un asiento duplicado en un libro inmutable no se borra.
 *
 * 🔑 **`ledgerDb` es OBLIGATORIO, no opcional.** Desde la migración `030` el RPC
 * tiene `EXECUTE` solo para `service_role`, así que hace falta el cliente de
 * servicio (SOP-014). Podría haber sido un parámetro opcional que, ausente,
 * saltease el posteo — y sería el agujero perfecto: alguien agrega un segundo
 * llamador, no pasa el cliente, y las facturas de ese camino dejan de entrar al
 * libro sin que nadie se entere. Al ser obligatorio, el compilador lo impide.
 */
export async function emitInvoice(
  db: DB,
  tenantId: string,
  invoiceId: string,
  ledgerDb: DB,
  userId: string | null
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
  //
  //    Se leen las líneas enteras (no solo el count) porque el paso 2b las
  //    necesita: `service_id` y `description`, en el orden de la factura.
  const { data: lineasRaw, error: errLineas } = await db
    .from("invoice_lines")
    .select("service_id, description, line_order")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("line_order", { ascending: true });
  if (errLineas) {
    throw new InvoiceMutationError(pgErrorToMessage(errLineas), 500, errLineas);
  }
  const lineas = (lineasRaw ?? []) as { service_id: string | null; description: string }[];
  if (lineas.length === 0) {
    throw new InvoiceMutationError(
      "La factura no tiene líneas. Agregue al menos una antes de emitir.",
      400
    );
  }

  // 2b. 🔴 invoice_kind ↔ service_type TAMBIÉN AL EMITIR (18/09/2026).
  //
  //     `createInvoice` y `updateInvoice` ya lo validan (SOP-029), pero un
  //     borrador guardado ANTES de que existiera esa validación —o escrito por
  //     otro camino— llegaba acá sin que nadie lo mirara, y emitir es el último
  //     punto antes de que el documento sea irreversible: el número se consume
  //     en el paso 3 y, con el tipo 09 en el mapper, una REI con una línea de
  //     honorarios saldría a la DGI rotulada como reembolso exento con ITBMS
  //     adentro.
  //
  //     Misma función pura que el resto (`validarLineasContraKind` →
  //     `validarConsistenciaDeKind`), releyendo las líneas desde la base. Va
  //     ANTES del correlativo para que un rechazo no queme un número.
  await validarLineasContraKind(
    db,
    tenantId,
    inv.invoice_kind as InvoiceKind,
    lineas
  );

  // 3. EL NÚMERO. Antes de pedirle uno nuevo a la secuencia, mirar si esta
  //    factura YA tiene asiento: sería el reintento de una emisión que posteó y
  //    no llegó al UPDATE, y su número es el que está en el libro (FND-011).
  const asientoPrevio = await asientoDeFacturaExistente(ledgerDb, tenantId, invoiceId);
  let formatted: string;
  if (asientoPrevio) {
    formatted = numeroDelAsiento(asientoPrevio);
  } else {
    // Llamar a la RPC SECURITY DEFINER del schema. Devuelve el INT del
    // siguiente número en la secuencia.
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

    formatted = `${PREFIX_BY_KIND[inv.invoice_kind as InvoiceKind]}-${String(
      nextNumber
    ).padStart(6, "0")}`;
  }

  // 3a. 🔴 EL NÚMERO NO PUEDE SER DE OTRA FACTURA. Se verifica ANTES de postear:
  //     el UPDATE del paso 4 lo rechazaría igual, pero para entonces el asiento
  //     ya estaría en el libro con ese número (FND-011). Acá no se posteó nada.
  await asegurarNumeroLibre(db, tenantId, invoiceId, formatted, asientoPrevio);

  // 3b. EL ASIENTO. Con el correlativo ya generado y ANTES de emitir.
  //
  //     Si esto lanza, la función corta acá: la factura sigue en 'borrador' y el
  //     `formatted` de arriba nunca se escribe. Ver el encabezado para por qué
  //     este orden y qué pasa con el número consumido.
  const factura = await cargarFacturaParaAsiento(
    ledgerDb,
    tenantId,
    invoiceId,
    formatted
  );
  if (!factura) {
    throw new InvoiceMutationError("Factura no encontrada", 404);
  }

  const armado = construirAsientoDeFactura(factura);
  if (!armado.ok) {
    // 422: la factura está bien formada como documento, lo que está mal es la
    // configuración contable de un servicio. El mensaje ya nombra cuál.
    throw new InvoiceMutationError(armado.mensaje, 422);
  }

  if (asientoPrevio) {
    // El reintento: el asiento ya está en el libro con ESTE número (paso 3). No
    // se vuelve a postear —el UNIQUE de la `034` lo rechazaría— y se pasa
    // directo al UPDATE que la emisión anterior no alcanzó a hacer.
    console.warn(
      "[finanzas] la factura %s ya tenía el asiento %d (%s); se completa la emisión con ese número",
      invoiceId,
      asientoPrevio.entry_number,
      formatted
    );
  } else {
    try {
      await postJournalEntry(ledgerDb, tenantId, armado.asiento, userId);
    } catch (err) {
      // El asiento ya existía: es un reintento de una emisión que sí posteó pero
      // no llegó a hacer el UPDATE, y que el paso 3 no vio (dos emisiones a la
      // vez). No es un error — hay que dejar que la emisión termine, o la
      // factura quedaría en borrador para siempre con su asiento ya en el libro.
      // Las dos llaves (`source_id` y `idempotency_key`) salen del mismo
      // invoice.id, así que cualquiera de los dos 23505 significa esto.
      const detalle = err instanceof MutationError ? err.detail : undefined;
      const code = (detalle as { code?: string } | undefined)?.code;
      if (code !== "23505") {
        throw err instanceof MutationError
          ? new InvoiceMutationError(err.message, err.status, detalle)
          : err;
      }
      // 🔴 Y manda el número DEL ASIENTO, no el que se acaba de consumir: el
      // libro ya se escribió y no se corrige (FND-011).
      const existente = await asientoDeFacturaExistente(ledgerDb, tenantId, invoiceId);
      if (existente) {
        const numeroEnElLibro = numeroDelAsiento(existente);
        if (numeroEnElLibro !== formatted) {
          await asegurarNumeroLibre(db, tenantId, invoiceId, numeroEnElLibro, existente);
          formatted = numeroEnElLibro;
        }
      }
      console.warn(
        "[finanzas] la factura %s ya tenía asiento; se completa la emisión como %s",
        invoiceId,
        formatted
      );
    }
  }

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
 * El origen del CUFE que se guarda desde la captura manual (legacy).
 *
 * 061/064: un CUFE sin origen no se sabe leer. El que entra por esta pantalla
 * lo copió una persona, así que es `'portal_050'` — salvo que sea el MISMO que
 * ya estaba guardado, que conserva el origen que tenía (reguardar la tarjeta
 * no puede convertir en "copiado a mano" un CUFE que devolvió el PAC).
 */
export function origenDelCufeManual(
  actual: { dgi_cufe: string | null; dgi_cufe_origen: string | null },
  cufeNuevo: string | null
): "crm" | "portal_050" | null {
  if (cufeNuevo === null) return null;
  if (cufeNuevo === actual.dgi_cufe && actual.dgi_cufe_origen === "crm") return "crm";
  return "portal_050";
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
    .select("id, status, invoice_number, dgi_cufe, dgi_cufe_origen")
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
      dgi_cufe_origen: origenDelCufeManual(inv, input.dgi_cufe),
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
// CANCEL — anulación post-emisión con razón persistida
// ---------------------------------------------------------------------------

/**
 * 🗑️ `validateCancelInput` VIVÍA ACÁ Y SE FUE EN EL BLOQUE 9B (23/09/2026).
 *
 * Validaba el motivo de anulación con un mínimo de **3** caracteres mientras la
 * DGI pedía **15**, y el diálogo repetía el número por su cuenta. Dos copias del
 * mismo umbral, ninguna de las dos mirando a la otra: por eso el mínimo pudo
 * quedar desactualizado sin que nada fallara.
 *
 * Ahora el largo lo decide `validators/cancel-invoice.ts`
 * (`validarMotivoDeAnulacion`), que es puro y lo importan **los dos** — la ruta
 * a través del orquestador, y el diálogo directamente. El tope de las
 * observaciones lo aplica la ruta, que es la única que las recibe.
 */

/**
 * ANULAR una factura emitida (Bloque 5, 22/09/2026 — D4, D5).
 *
 *   1. Gates de status y de pagos (como antes: sin pagos, no anulada, emitida).
 *   2. 🔴 El MES DE LA FACTURA cerrado → 409: "no se anula, se emite una nota
 *      de crédito con fecha de hoy" (Josuarth). La pantalla cambia el botón.
 *   3. La NC TOTAL automática (`createCreditNoteFromInvoice`: la misma función
 *      que la NC manual, con todas las líneas). Fecha de hoy.
 *   4. RPC `cancel_invoice_with_reversal` (052), UNA transacción: si la factura
 *      está en el libro, postea la REVERSIÓN de su asiento con la fecha de hoy
 *      (el espejo lo arma `construirAsientoDeReversion`, la misma función que
 *      dibuja la vista previa; el RPC lo verifica), y marca `anulada`. La NC NO
 *      se postea aparte: el libro cierra con el espejo (D5).
 *   5. Si el RPC falla, la NC se deshace con la válvula de la 052.
 *
 * El "GATE CONTABLE (02/09/2026)" que rechazaba anular cualquier factura con
 * asiento se ELIMINÓ acá: la reversión real es lo que ese gate esperaba.
 *
 * `ledgerDb` es el cliente de SERVICIO (SOP-014): lee el asiento, llama al RPC
 * y compensa.
 */
export async function cancelInvoice(
  db: DB,
  ledgerDb: DB,
  tenantId: string,
  userId: string,
  invoiceId: string,
  reason: string,
  observations: string | null = null
) {
  // 1. Status y pagos
  const { data: inv, error: errFetch } = await db
    .from("invoices")
    .select("id, status, invoice_number, amount_paid, credited_total, issue_date")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (errFetch) {
    throw new InvoiceMutationError(pgErrorToMessage(errFetch), 500, errFetch);
  }
  if (!inv) {
    throw new InvoiceMutationError("Factura no encontrada", 404);
  }
  if (inv.status === "anulada") {
    throw new InvoiceMutationError("La factura ya está anulada.", 400);
  }
  if (inv.status === "borrador" || inv.status === "cancelada_pre_emision") {
    throw new InvoiceMutationError(
      "No se puede anular una factura no emitida. Para descartarla está el botón Eliminar.",
      400
    );
  }
  const amountPaid = Number(inv.amount_paid);
  if (amountPaid > 0) {
    throw new InvoiceMutationError(
      `Esta factura tiene B/. ${amountPaid.toFixed(2)} en pagos registrados. Elimine o reverse los pagos primero antes de anular.`,
      400
    );
  }
  // Una factura con una NC parcial ya NO se anula: la anulación espeja el
  // asiento ORIGINAL completo, y la NC parcial ya debitó su parte con asiento
  // propio (D5) — se contabilizaría dos veces. El resto se acredita con otra
  // NC. El RPC lo vuelve a verificar.
  const creditedTotal = Number(inv.credited_total ?? 0);
  if (creditedTotal > 0) {
    throw new InvoiceMutationError(MENSAJE_YA_ACREDITADA(creditedTotal), 409);
  }

  // 2. 🔴 El mes de la factura (D4). Se mira acá, con el mensaje para la
  //    persona, y el RPC lo vuelve a verificar (es el permiso).
  if (await periodoDeLaFacturaCerrado(db, tenantId, String(inv.issue_date))) {
    throw new InvoiceMutationError(MENSAJE_MES_CERRADO(String(inv.issue_date)), 409);
  }

  // 3. La NC total, con la MISMA función que la NC manual.
  const cn = await createCreditNoteFromInvoice(db, tenantId, userId, invoiceId, reason, observations);

  // 4. El espejo del asiento de la factura, si lo hay, y la anulación en el RPC.
  const original = await getAsientoDeFactura(ledgerDb, tenantId, invoiceId);
  let lines: { account_code: string; debit: number; credit: number; description: string | null }[] | null = null;
  let description = `Anulación de la factura ${inv.invoice_number}`;
  const hoy = new Date().toISOString().slice(0, 10);
  if (original) {
    const armado = construirAsientoDeReversion(original, { hoy, motivo: reason, source_id: invoiceId });
    if (!armado.ok) {
      await compensarNotaDeCredito(ledgerDb, tenantId, cn.id, new MutationError(armado.mensaje, 422));
      throw new MutationError(armado.mensaje, 422); // inalcanzable: compensar lanza
    }
    // Lo que va al RPC sale de `armado.asiento`: la misma función que dibuja
    // la vista previa (reversion-una-sola-implementacion).
    lines = armado.asiento.lines.map((l) => ({
      account_code: l.account_code,
      debit: l.debit,
      credit: l.credit,
      description: l.description ?? null,
    }));
    description = armado.asiento.description;
  }

  const { data, error } = await ledgerDb.rpc("cancel_invoice_with_reversal", {
    p_tenant_id: tenantId,
    p_invoice_id: invoiceId,
    p_reason: reason,
    p_observations: observations,
    p_transaction_date: hoy,
    p_description: description,
    p_lines: lines,
    p_created_by: userId,
  });
  if (error) {
    console.error("[finanzas/api] cancel_invoice_with_reversal failed", error);
    await compensarNotaDeCredito(
      ledgerDb,
      tenantId,
      cn.id,
      new InvoiceMutationError(error.message || "No se pudo anular la factura", 422, error)
    );
  }
  const r = (data ?? {}) as { entry_number?: number | null; reversed_entry_number?: number | null };

  return {
    id: invoiceId,
    credit_note_id: cn.id,
    credit_note_number: cn.credit_note_number,
    reversal_entry_number: r.entry_number ?? null,
    reversed_entry_number: r.reversed_entry_number ?? null,
  };
}

/** El texto de D4, en un solo lugar (lo usa también la pantalla). */
export function MENSAJE_YA_ACREDITADA(creditedTotal: number): string {
  return (
    `Esta factura ya tiene B/. ${creditedTotal.toFixed(2)} acreditados por nota de crédito: ` +
    `no se anula. Lo que falta se acredita con otra nota de crédito.`
  );
}

export function MENSAJE_MES_CERRADO(issueDate: string): string {
  return (
    `El mes de esta factura (${issueDate.slice(0, 7)}) está cerrado: no se anula, ` +
    `se emite una nota de crédito con fecha de hoy.`
  );
}

/** ¿El período contable del mes de `issueDate` está cerrado? */
export async function periodoDeLaFacturaCerrado(db: DB, tenantId: string, issueDate: string): Promise<boolean> {
  const year = Number(issueDate.slice(0, 4));
  const month = Number(issueDate.slice(5, 7));
  const { data } = await db
    .from("accounting_periods")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  return (data as { status?: string } | null)?.status === "cerrado";
}

/** El asiento `factura` de una factura, con sus líneas, o null. */
async function getAsientoDeFactura(db: DB, tenantId: string, invoiceId: string) {
  const mapa = await cargarAsientosPorOrigen(db, tenantId, "factura", [invoiceId]);
  return mapa.get(invoiceId) ?? null;
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

// ═══════════════════════════════════════════════════════════════════════════
// EL CUFE DEL PORTAL (Bloque 9C, caso B — migración `061`)
// ═══════════════════════════════════════════════════════════════════════════

export interface RegistrarCufeResult {
  invoice_id: string;
  invoice_number: string;
  dgi_cufe: string;
  dgi_cufe_origen: string;
  avisos: string[];
}

/**
 * Guarda el CUFE de una factura que se emitió A MANO en el portal de ideati.
 *
 * Las facturas anteriores al 8 de julio de 2026 salieron por el punto `050` y
 * **tienen CUFE ante la DGI**: el CRM simplemente no lo guardó. Sin ese dato no
 * se les puede emitir una nota de crédito electrónica, porque el bloque
 * `documentosFiscalesReferenciados` se arma con el CUFE del documento que se
 * corrige (y referenciar por número de factura en papel hace explotar al PAC —
 * ver `map-referencia-fiscal.ts`).
 *
 * 🔴 NO CAMBIA `fe_estado`. La factura sigue `no_emitida` porque **este sistema
 * no la emitió**, y decir lo contrario sería ensuciar el registro de envíos con
 * un envío que nunca ocurrió. Lo que la marca es `dgi_cufe_origen =
 * 'portal_050'`, que es una afirmación verdadera y distinta.
 *
 * 🔴 NO PISA UN CUFE QUE YA ESTÉ. Si la factura ya tiene uno, se rechaza con
 * 409: o lo devolvió el PAC —y entonces esto sería corromper el vínculo con el
 * documento real— o ya lo cargó alguien. Corregir un CUFE mal tecleado es una
 * operación distinta y todavía no existe; hasta que exista, la pregunta la
 * contesta una persona mirando el portal.
 *
 * ⚠️ Nadie puede verificar acá que el CUFE exista ante la DGI: ideati no tiene
 * endpoint para consultar un documento ajeno (swagger completo, 23/09/2026). Si
 * está mal, se va a ver como un rechazo al emitir la nota de crédito.
 */
export async function registrarCufeDelPortal(
  db: DB,
  tenantId: string,
  invoiceId: string,
  cufeCrudo: string
): Promise<RegistrarCufeResult> {
  const revisado = validarCufe(cufeCrudo);
  if (!revisado.ok) {
    throw new MutationError(revisado.mensaje ?? "El CUFE no tiene la forma esperada.", 400);
  }

  const { data: inv, error: errFetch } = await db
    .from("invoices")
    .select("id, invoice_number, status, fe_estado, dgi_cufe")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (errFetch) {
    throw new MutationError(pgErrorToMessage(errFetch), 500, errFetch);
  }
  if (!inv) {
    throw new MutationError("Factura no encontrada", 404);
  }

  const f = inv as {
    id: string;
    invoice_number: string;
    status: string;
    fe_estado: string | null;
    dgi_cufe: string | null;
  };

  if (f.status === "borrador" || f.status === "cancelada_pre_emision") {
    throw new MutationError(
      "Esta factura todavía es un borrador, así que no pudo emitirse en el portal. " +
        "El CUFE se carga sobre una factura ya emitida.",
      409
    );
  }
  if (f.dgi_cufe && f.dgi_cufe.trim().length > 0) {
    throw new MutationError(
      `La factura ${f.invoice_number} ya tiene un CUFE guardado. Si el que está cargado es ` +
        "incorrecto, hay que revisarlo con administración antes de cambiarlo.",
      409
    );
  }
  if (f.fe_estado === "pending") {
    throw new MutationError(
      "Esta factura tiene un envío a la DGI en curso: hay que esperar el resultado antes de " +
        "cargarle un CUFE a mano.",
      409
    );
  }

  const { error: errUpd } = await db
    .from("invoices")
    .update({ dgi_cufe: revisado.valor, dgi_cufe_origen: "portal_050" })
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId);

  if (errUpd) {
    throw new MutationError(pgErrorToMessage(errUpd), 500, errUpd);
  }

  return {
    invoice_id: f.id,
    invoice_number: f.invoice_number,
    dgi_cufe: revisado.valor,
    dgi_cufe_origen: "portal_050",
    avisos: revisado.avisos,
  };
}
