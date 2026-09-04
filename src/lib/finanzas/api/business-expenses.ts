/**
 * Helpers server-side para mutaciones de business_expenses. Llamados desde
 * route handlers `/api/finanzas/business-expenses/...`. Mismo patrón que
 * api/invoices.ts: admin client (bypass RLS) + filter manual por tenant_id +
 * MutationError para errores con código HTTP sugerido.
 *
 * Cada mutación graba en audit_log con (entity='business_expenses',
 * action='create|update|delete').
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateBusinessExpenseInput,
  UpdateBusinessExpenseInput,
  BusinessExpensePaymentMethod,
} from "@/lib/finanzas/types/business-expense";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { validarCuentaDeGasto } from "@/lib/finanzas/queries/business-expenses";
import { vencimientoPorPlazo } from "@/lib/finanzas/types/supplier";
import type { AsientoInput } from "@/lib/finanzas/contabilidad/posting";
import { postJournalEntry } from "@/lib/finanzas/contabilidad/posting";
import {
  construirAsientoDeCompra,
  SOURCE_TYPE_COMPRA,
} from "@/lib/finanzas/contabilidad/asiento-compra";
import { cargarCompraParaAsiento } from "@/lib/finanzas/queries/compra-para-asiento";
import { construirAsientoDePagoProveedor } from "@/lib/finanzas/contabilidad/asiento-tesoreria";
import { cargarPagoProveedorParaAsiento } from "@/lib/finanzas/queries/tesoreria-para-asiento";

/** Centavos, y una sola vez. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type DB = SupabaseClient;

const ENTITY = "business_expenses";

/**
 * El vencimiento que le corresponde a un gasto.
 *
 * Si el formulario mandó uno, manda ese: lo que diga el comprobante gana sobre
 * el plazo del proveedor. Si no, se calcula desde el plazo del proveedor, y si
 * tampoco hay proveedor se asume contado (vence el mismo día).
 *
 * Está acá y no en el validador porque necesita leer el plazo de la base.
 */
async function resolverVencimiento(
  db: DB,
  tenantId: string,
  input: { due_date: string | null; supplier_id: string | null; expense_date: string }
): Promise<string> {
  if (input.due_date) return input.due_date;

  if (input.supplier_id) {
    const { data } = await db
      .from("suppliers")
      .select("payment_terms_days")
      .eq("tenant_id", tenantId)
      .eq("id", input.supplier_id)
      .maybeSingle();
    if (data) {
      return vencimientoPorPlazo(input.expense_date, Number(data.payment_terms_days ?? 0));
    }
  }
  return input.expense_date;
}

/** Que el proveedor exista y sea de este bufete. La FK no alcanza: es global. */
async function proveedorValido(db: DB, tenantId: string, id: string): Promise<boolean> {
  const { data } = await db
    .from("suppliers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return !!data;
}


/**
 * 🔴 GATE CONTABLE — una compra que ya está en el libro no se edita ni se borra.
 *
 * Mismo patrón que `cancelInvoice` (`api/invoices.ts`), y por el mismo motivo:
 * el asiento es INMUTABLE. Si la compra cambia de monto, de cuenta o de fecha, o
 * si desaparece, el asiento sigue en el libro tal cual, y el documento deja de
 * respaldarlo. Un contador que audite el mayor llega a una compra que dice otra
 * cosa — o a ninguna.
 *
 * Corregir una compra contabilizada requiere un asiento de REVERSIÓN, que es su
 * propio bloque y todavía necesita decidir con qué fecha se revierte.
 *
 * ⚠️ Hasta el 04/09/2026 este gate NO existía en compras: `update` y `delete`
 * podían tocar libremente una compra con asiento, y las tres compras sembradas
 * en staging ya tenían el suyo. El agujero estaba abierto, no era teórico.
 */
async function gateContable(db: DB, tenantId: string, id: string, verbo: string) {
  const { data: asiento } = await db
    .from("journal_entries")
    .select("entry_number")
    .eq("tenant_id", tenantId)
    .eq("source_type", SOURCE_TYPE_COMPRA)
    .eq("source_id", id)
    .maybeSingle();

  if (asiento) {
    const numero = (asiento as { entry_number: number }).entry_number;
    throw new MutationError(
      `Esta compra ya está registrada en el libro contable (asiento ${numero}), ` +
        `así que no se puede ${verbo}. Los asientos son inmutables por ley. ` +
        `La corrección de compras contabilizadas se habilita junto con el asiento ` +
        `de reversión.`,
      409
    );
  }
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

/**
 * Registra una compra del bufete **y su asiento contable**.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 REGISTRAR → POSTEAR → DESHACER EL REGISTRO SI EL POSTEO FALLA
 * ═════════════════════════════════════════════════════════════════════════════
 * **No es "postear antes de registrar"**, que es lo que hace `emitInvoice` con
 * las facturas, y decirlo así acá sería falso. Una compra no tiene ciclo
 * borrador → emitir: nace registrada en el mismo INSERT que la crea. Y el
 * `source_id` del asiento **es** el id de la compra, que no existe hasta después
 * de ese INSERT. Postear antes es literalmente imposible.
 *
 * Entonces el orden real es:
 *
 *   1. INSERT de la compra (y de sus líneas)
 *   2. Postear el asiento
 *   3. Si el posteo falla → **DELETE compensatorio** de la compra
 *
 * El efecto visible para quien usa el sistema es el mismo que en la factura —una
 * compra que no se pudo contabilizar no queda registrada— pero la mecánica es
 * otra, y quien lea esto tiene que saber cuál es.
 *
 * ⚠️ El DELETE compensatorio es seguro acá **porque `business_expenses` NO es
 * inmutable**. En `journal_entries` sería imposible: los triggers de la `023`
 * rechazan DELETE, y por eso el ledger se escribe con un RPC que hace todo
 * adentro. Es el mismo patrón que `credit-notes.ts` usa para las líneas de una
 * nota de crédito.
 *
 * ⚠️ Si el DELETE compensatorio **también** falla, se registra en el log y se
 * lanza el error del posteo, no el del DELETE: lo que la persona necesita saber
 * es por qué no se contabilizó. La compra huérfana queda, y es detectable con
 * una consulta (compras sin asiento) — que es justamente el caso reversible.
 */
export async function createBusinessExpense(
  db: DB,
  tenantId: string,
  userId: string,
  input: CreateBusinessExpenseInput,
  ledgerDb: DB
) {
  // ---- Las líneas, y su cuenta ------------------------------------------
  // 🔑 La cuenta es OBLIGATORIA acá, en el servidor, además de serlo en el
  //    formulario. El formulario guía; el servidor garantiza. Un `curl` saltea
  //    la pantalla, y una compra sin cuenta no se puede imputar a nada.
  if (input.lineas.length === 0) {
    throw new MutationError("La compra necesita al menos una línea.", 400);
  }

  // Validación cross-tabla POR LÍNEA: la cuenta debe existir, estar activa y ser
  // de un tipo que pueda recibir un desembolso — gasto, costo o ACTIVO, que es
  // lo que pide el acta del 25/08 ("la cuenta de gasto, costo o activo que elija
  // el usuario"). La FK es lógica (no hay constraint de BD), por eso se verifica
  // a mano. Se recorren TODAS y se informa la primera que falla, nombrando su
  // número de línea: con varias líneas, "la cuenta X está inactiva" sin decir
  // cuál línea obliga a adivinar.
  for (let i = 0; i < input.lineas.length; i++) {
    const l = input.lineas[i];
    const nro = i + 1;
    if (!l.chart_account_code) {
      throw new MutationError(
        `La línea ${nro} ("${l.description}") no tiene cuenta contable. ` +
          `Cada línea de una compra tiene que decir contra qué cuenta se imputa.`,
        400
      );
    }
    // Distingue "no existe" de "existe pero está inactiva": son dos errores
    // distintos, y el segundo tiene que explicar POR QUÉ o la persona vuelve a
    // elegir la misma cuenta del plan viejo.
    const veredicto = await validarCuentaDeGasto(db, tenantId, l.chart_account_code);
    if (veredicto.estado === "no-existe") {
      throw new MutationError(
        `Línea ${nro}: la cuenta contable "${l.chart_account_code}" no existe en el Plan de Cuentas.`,
        400
      );
    }
    // El tipo se informa con su MOTIVO, que ya viene redactado desde
    // `cuentas-de-gasto.ts`. Antes este caso caía en "no existe o no es de tipo
    // gasto": el mensaje mandaba a buscar la cuenta en el plan cuando la cuenta
    // estaba ahí y el problema era otro.
    if (veredicto.estado === "tipo-invalido") {
      throw new MutationError(`Línea ${nro}: ${veredicto.mensaje}`, 400);
    }
    if (veredicto.estado === "inactiva") {
      throw new MutationError(
        `Línea ${nro}: la cuenta "${l.chart_account_code}" está inactiva en el Plan de ` +
          `Cuentas: es del plan contable anterior y no se puede usar para clasificar ` +
          `gastos nuevos. Seleccione una cuenta activa.`,
        400
      );
    }
  }

  if (input.supplier_id !== null && !(await proveedorValido(db, tenantId, input.supplier_id))) {
    throw new MutationError("El proveedor seleccionado no existe.", 400);
  }
  const dueDate = await resolverVencimiento(db, tenantId, input);

  // Los totales del encabezado los calcula el SERVIDOR sumando las líneas, no
  // llegan del cliente: si llegaran, un cliente podría mandar un total que no
  // es la suma y el asiento no cuadraría contra su propio documento.
  const subtotal = round2(input.lineas.reduce((s, l) => s + l.amount, 0));
  const taxAmount = round2(input.lineas.reduce((s, l) => s + l.tax_amount, 0));

  const { data, error } = await db
    .from("business_expenses")
    .insert({
      tenant_id: tenantId,
      expense_date: input.expense_date,
      due_date: dueDate,
      supplier_id: input.supplier_id,
      supplier_name: input.supplier_name,
      supplier_ruc: input.supplier_ruc,
      // 🔴 SIEMPRE null: la cuenta vive en la línea desde la migración `040`, y
      //    el CHECK `business_expenses_cuenta_vive_en_la_linea` rechaza otra
      //    cosa. No se lee `input.chart_account_code` a propósito.
      chart_account_code: null,
      description: input.description,
      subtotal,
      tax_rate: input.tax_rate,
      tax_amount: taxAmount,
      status: input.status,
      payment_date: input.payment_date,
      payment_method: input.payment_method,
      notes: input.notes,
      created_by: userId,
    })
    .select("id, total")
    .single();

  if (error || !data) {
    console.error("[finanzas/api] createBusinessExpense failed", error);
    throw new MutationError(pgErrorToMessage(error), 500, error);
  }

  const compraId = data.id as string;

  /** Deshace el registro. Ver el encabezado: por qué se puede y por qué acá sí. */
  async function deshacerRegistro(causa: unknown) {
    const { error: errDel } = await db
      .from("business_expenses")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", compraId);
    if (errDel) {
      // No se pisa el error original: lo que hace falta explicar es por qué no
      // se contabilizó. La compra huérfana queda registrada en el log.
      console.error(
        "[finanzas/api] DELETE compensatorio FALLÓ para la compra %s. Quedó registrada sin asiento.",
        compraId,
        errDel
      );
    }
    throw causa;
  }

  // ---- Las líneas -------------------------------------------------------
  const { error: errLineas } = await db.from("expense_lines").insert(
    input.lineas.map((l, i) => ({
      tenant_id: tenantId,
      business_expense_id: compraId,
      line_order: i + 1,
      description: l.description,
      chart_account_code: l.chart_account_code,
      amount: l.amount,
      tax_rate: l.tax_rate,
      tax_amount: l.tax_amount,
    }))
  );
  if (errLineas) {
    console.error("[finanzas/api] insert de expense_lines falló", errLineas);
    await deshacerRegistro(new MutationError(pgErrorToMessage(errLineas), 500, errLineas));
  }

  // ---- EL ASIENTO -------------------------------------------------------
  const compra = await cargarCompraParaAsiento(ledgerDb, tenantId, compraId);
  if (!compra) {
    await deshacerRegistro(
      new MutationError("La compra se registró pero no se pudo releer para contabilizarla.", 500)
    );
  }

  const armado = construirAsientoDeCompra(compra as NonNullable<typeof compra>);
  if (!armado.ok) {
    // 422: la compra está bien formada como documento; lo que está mal es la
    // clasificación contable de una línea. El mensaje ya nombra cuál.
    await deshacerRegistro(new MutationError(armado.mensaje, 422));
  }

  try {
    await postJournalEntry(
      ledgerDb,
      tenantId,
      (armado as { ok: true; asiento: AsientoInput }).asiento,
      userId
    );
  } catch (err) {
    // El asiento ya existía: solo puede pasar si este mismo `compraId` ya se
    // posteó, y como el id lo acaba de generar el INSERT, es prácticamente
    // imposible. Se trata igual que cualquier otro fallo —deshacer— en vez de
    // dejarlo pasar como en `emitInvoice`: allá el reintento era de un documento
    // que YA existía; acá la compra es nueva, así que un choque significa que
    // algo está mal, no que se reintentó.
    await deshacerRegistro(err);
  }

  await db.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: userId,
    entity: ENTITY,
    entity_id: data.id as string,
    action: "create",
    field: null,
    old_value: null,
    new_value: JSON.stringify({
      expense_date: input.expense_date,
      description: input.description,
      subtotal,
      tax_amount: taxAmount,
      status: input.status,
      lineas: input.lineas.length,
      cuentas: input.lineas.map((l) => l.chart_account_code),
      supplier_name: input.supplier_name,
    }),
  });

  return { id: compraId, total: Number(data.total) };
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

export async function updateBusinessExpense(
  db: DB,
  tenantId: string,
  id: string,
  userId: string,
  input: UpdateBusinessExpenseInput
) {
  // Verificar existencia + tenant ownership (defensa en profundidad sobre RLS).
  const { data: existing, error: errExisting } = await db
    .from("business_expenses")
    .select(
      `id, expense_date, due_date, supplier_id, supplier_name, supplier_ruc,
       chart_account_code, description, subtotal, tax_rate, tax_amount,
       status, payment_date, payment_method, notes`
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (errExisting) {
    throw new MutationError(pgErrorToMessage(errExisting), 500, errExisting);
  }
  if (!existing) {
    throw new MutationError("Gasto no encontrado", 404);
  }

  await gateContable(db, tenantId, id, "editar");

  // La cuenta ya NO vive acá: desde la migración `040` está en
  // `expense_lines.chart_account_code`, una por línea, y un CHECK fuerza esta
  // columna a NULL. La validación de cuenta que había en este punto quedó sin
  // objeto y se eliminó — dejarla habría sido validar un campo que ya nadie
  // escribe.

  if (input.supplier_id !== null && !(await proveedorValido(db, tenantId, input.supplier_id))) {
    throw new MutationError("El proveedor seleccionado no existe.", 400);
  }
  const dueDateUpdate = await resolverVencimiento(db, tenantId, input);

  const { error: errUpdate } = await db
    .from("business_expenses")
    .update({
      expense_date: input.expense_date,
      due_date: dueDateUpdate,
      supplier_id: input.supplier_id,
      supplier_name: input.supplier_name,
      supplier_ruc: input.supplier_ruc,
      // Sigue en NULL: la cuenta vive en la línea (migración `040`).
      chart_account_code: null,
      description: input.description,
      subtotal: input.subtotal,
      tax_rate: input.tax_rate,
      tax_amount: input.tax_amount,
      status: input.status,
      payment_date: input.payment_date,
      payment_method: input.payment_method,
      notes: input.notes,
    })
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (errUpdate) {
    console.error("[finanzas/api] updateBusinessExpense failed", errUpdate);
    throw new MutationError(pgErrorToMessage(errUpdate), 500, errUpdate);
  }

  // Audit log: diff de campos modificados
  const fields = [
    "expense_date", "supplier_name", "supplier_ruc", "chart_account_code",
    "description", "subtotal", "tax_rate", "tax_amount",
    "status", "payment_date", "payment_method", "notes",
  ] as const;
  const changed: Record<string, { old: unknown; new: unknown }> = {};
  for (const f of fields) {
    const oldVal = (existing as unknown as Record<string, unknown>)[f];
    const newVal = (input as unknown as Record<string, unknown>)[f];
    // Comparar normalizando NUMERIC string vs number
    const oldNorm = typeof oldVal === "string" && /^-?\d+(\.\d+)?$/.test(oldVal) ? Number(oldVal) : oldVal;
    const newNorm = typeof newVal === "string" && /^-?\d+(\.\d+)?$/.test(newVal) ? Number(newVal) : newVal;
    if (oldNorm !== newNorm) {
      changed[f] = { old: oldVal, new: newVal };
    }
  }

  if (Object.keys(changed).length > 0) {
    await db.from("audit_log").insert({
      tenant_id: tenantId,
      user_id: userId,
      entity: ENTITY,
      entity_id: id,
      action: "update",
      field: Object.keys(changed).join(","),
      old_value: JSON.stringify(Object.fromEntries(
        Object.entries(changed).map(([k, v]) => [k, v.old])
      )),
      new_value: JSON.stringify(Object.fromEntries(
        Object.entries(changed).map(([k, v]) => [k, v.new])
      )),
    });
  }

  return { id };
}

// ---------------------------------------------------------------------------
// DELETE (hard delete + cleanup de receipt en storage)
// ---------------------------------------------------------------------------

export async function deleteBusinessExpense(
  db: DB,
  tenantId: string,
  id: string,
  userId: string
) {
  const { data: existing, error: errExisting } = await db
    .from("business_expenses")
    .select("id, receipt_url, description, expense_date, subtotal, tax_amount")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (errExisting) {
    throw new MutationError(pgErrorToMessage(errExisting), 500, errExisting);
  }
  if (!existing) {
    throw new MutationError("Gasto no encontrado", 404);
  }

  // ANTES de tocar el storage: si el borrado no va a poder completarse, no hay
  // que haber borrado ya el comprobante.
  await gateContable(db, tenantId, id, "borrar");

  // Borrar receipt del storage si existe (consistente con expenses legacy).
  if (existing.receipt_url) {
    await db.storage.from("documents").remove([existing.receipt_url as string]);
  }

  const { error: errDelete } = await db
    .from("business_expenses")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (errDelete) {
    console.error("[finanzas/api] deleteBusinessExpense failed", errDelete);
    throw new MutationError(pgErrorToMessage(errDelete), 500, errDelete);
  }

  await db.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: userId,
    entity: ENTITY,
    entity_id: id,
    action: "delete",
    field: null,
    old_value: JSON.stringify({
      description: existing.description,
      expense_date: existing.expense_date,
      subtotal: existing.subtotal,
      tax_amount: existing.tax_amount,
    }),
    new_value: null,
  });

  return { id };
}

// ---------------------------------------------------------------------------
// MARK AS PAID (atajo para cambiar status)
// ---------------------------------------------------------------------------

/**
 * Marca una compra como pagada **y postea el asiento del pago**.
 *
 *   DEBE  200001 Cuentas por pagar  (baja lo que debíamos)
 *   HABER el banco elegido          (sale plata)
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * NO HAY TABLA DE PAGOS A PROVEEDOR, Y ES UNA DECISIÓN DE ALCANCE
 * ═════════════════════════════════════════════════════════════════════════════
 * El pago se modela como un cambio de estado de la COMPRA, no como un documento
 * propio. Consecuencias, todas asumidas:
 *
 *   · Solo existe el pago TOTAL de una compra. No hay pago parcial, ni un pago
 *     que salde tres compras, ni anticipos a proveedor.
 *   · El `source_id` del asiento es el id de la COMPRA.
 *
 * El acta no pide ninguna de las tres: la fila 15 pide el módulo de *recibir*
 * pago y la 16 los cobros parciales, las dos del lado del CLIENTE. El día que
 * haga falta, esto se migra a una tabla propia igual que la cuenta de la compra
 * se migró a `expense_lines`.
 *
 * 🔴 `source_type` es `pago_proveedor`, NO `pago`. Ver la migración `042`: con
 * `pago`, el enlace del Libro Mayor mandaría a `/finanzas/facturas/<id-de-una-
 * compra>`.
 *
 * ⚠️ ORDEN: se postea ANTES del UPDATE a 'pagado'. Acá SÍ se puede —al revés que
 * al crear una compra— porque la compra YA existe y su id también: no hace falta
 * DELETE compensatorio, alcanza con no hacer el UPDATE.
 */
export async function markBusinessExpenseAsPaid(
  db: DB,
  tenantId: string,
  id: string,
  userId: string,
  paymentDate: string,
  paymentMethod: BusinessExpensePaymentMethod | null,
  /** La cuenta de donde SALIÓ la plata. Obligatoria: la elige quien registra. */
  paymentAccountCode: string | null,
  /** 🔑 Obligatorio (SOP-014). Ver `createBusinessExpense`. */
  ledgerDb: DB
) {
  if (!paymentAccountCode) {
    throw new MutationError(
      "Falta la cuenta bancaria de donde salió el pago. La elige quien registra: " +
        "es lo que el asiento acredita y no se puede deducir.",
      400
    );
  }
  const { data: existing, error: errExisting } = await db
    .from("business_expenses")
    .select("id, status, payment_date, payment_method")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (errExisting) {
    throw new MutationError(pgErrorToMessage(errExisting), 500, errExisting);
  }
  if (!existing) {
    throw new MutationError("Gasto no encontrado", 404);
  }
  if (existing.status === "pagado") {
    throw new MutationError("La compra ya está marcada como pagada.", 409);
  }

  // ---- EL ASIENTO, ANTES DEL UPDATE --------------------------------------
  const pago = await cargarPagoProveedorParaAsiento(
    ledgerDb,
    tenantId,
    id,
    paymentDate,
    paymentAccountCode
  );
  if (!pago) {
    throw new MutationError("Compra no encontrada", 404);
  }

  const armadoPago = construirAsientoDePagoProveedor(pago);
  if (!armadoPago.ok) {
    throw new MutationError(armadoPago.mensaje, 422);
  }

  await postJournalEntry(ledgerDb, tenantId, armadoPago.asiento, userId);

  const { error: errUpdate } = await db
    .from("business_expenses")
    .update({
      status: "pagado",
      payment_date: paymentDate,
      payment_method: paymentMethod,
      payment_account_code: paymentAccountCode,
    })
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (errUpdate) {
    console.error("[finanzas/api] markBusinessExpenseAsPaid failed", errUpdate);
    throw new MutationError(pgErrorToMessage(errUpdate), 500, errUpdate);
  }

  await db.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: userId,
    entity: ENTITY,
    entity_id: id,
    action: "update",
    field: "status,payment_date,payment_method",
    old_value: JSON.stringify({
      status: existing.status,
      payment_date: existing.payment_date,
      payment_method: existing.payment_method,
    }),
    new_value: JSON.stringify({
      status: "pagado",
      payment_date: paymentDate,
      payment_method: paymentMethod,
    }),
  });

  return { id };
}
