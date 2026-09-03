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

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

export async function createBusinessExpense(
  db: DB,
  tenantId: string,
  userId: string,
  input: CreateBusinessExpenseInput
) {
  // Validación cross-tabla: si llega chart_account_code, debe existir, estar
  // activa y ser de un tipo que pueda clasificar un desembolso — gasto, costo o
  // ACTIVO, que es lo que pide el acta del 25/08 ("la cuenta de gasto, costo o
  // activo que elija el usuario"). La FK es lógica (no constraint de BD), por eso
  // se verifica a mano acá.
  if (input.chart_account_code !== null) {
    // Distingue "no existe" de "existe pero está inactiva": son dos errores
    // distintos, y el segundo tiene que explicar POR QUÉ o la persona vuelve a
    // elegir la misma cuenta del plan viejo.
    const veredicto = await validarCuentaDeGasto(db, tenantId, input.chart_account_code);
    if (veredicto.estado === "no-existe") {
      throw new MutationError(
        `La cuenta contable "${input.chart_account_code}" no existe en el Plan de Cuentas.`,
        400
      );
    }
    // El tipo se informa con su MOTIVO, que ya viene redactado desde
    // `cuentas-de-gasto.ts`. Antes este caso caía en "no existe o no es de tipo
    // gasto": el mensaje mandaba a buscar la cuenta en el plan cuando la cuenta
    // estaba ahí y el problema era otro.
    if (veredicto.estado === "tipo-invalido") {
      throw new MutationError(veredicto.mensaje, 400);
    }
    if (veredicto.estado === "inactiva") {
      throw new MutationError(
        `La cuenta "${input.chart_account_code}" está inactiva en el Plan de Cuentas: es del ` +
          `plan contable anterior y no se puede usar para clasificar gastos nuevos. ` +
          `Seleccione una cuenta activa.`,
        400
      );
    }
  }

  if (input.supplier_id !== null && !(await proveedorValido(db, tenantId, input.supplier_id))) {
    throw new MutationError("El proveedor seleccionado no existe.", 400);
  }
  const dueDate = await resolverVencimiento(db, tenantId, input);

  const { data, error } = await db
    .from("business_expenses")
    .insert({
      tenant_id: tenantId,
      expense_date: input.expense_date,
      due_date: dueDate,
      supplier_id: input.supplier_id,
      supplier_name: input.supplier_name,
      supplier_ruc: input.supplier_ruc,
      chart_account_code: input.chart_account_code,
      description: input.description,
      subtotal: input.subtotal,
      tax_rate: input.tax_rate,
      tax_amount: input.tax_amount,
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
      subtotal: input.subtotal,
      tax_amount: input.tax_amount,
      status: input.status,
      chart_account_code: input.chart_account_code,
      supplier_name: input.supplier_name,
    }),
  });

  return { id: data.id as string, total: Number(data.total) };
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

  if (input.chart_account_code !== null) {
    // `existing.chart_account_code` es la cuenta que el gasto YA tenía: si no
    // cambió, se acepta aunque esté inactiva. Editar la descripción de un gasto
    // viejo no puede fallar porque su cuenta se desactivó después.
    const veredicto = await validarCuentaDeGasto(
      db,
      tenantId,
      input.chart_account_code,
      (existing as { chart_account_code: string | null }).chart_account_code
    );
    if (veredicto.estado === "no-existe") {
      throw new MutationError(
        `La cuenta contable "${input.chart_account_code}" no existe en el Plan de Cuentas.`,
        400
      );
    }
    // El tipo se informa con su MOTIVO, que ya viene redactado desde
    // `cuentas-de-gasto.ts`. Antes este caso caía en "no existe o no es de tipo
    // gasto": el mensaje mandaba a buscar la cuenta en el plan cuando la cuenta
    // estaba ahí y el problema era otro.
    if (veredicto.estado === "tipo-invalido") {
      throw new MutationError(veredicto.mensaje, 400);
    }
    if (veredicto.estado === "inactiva") {
      throw new MutationError(
        `La cuenta "${input.chart_account_code}" está inactiva en el Plan de Cuentas: es del ` +
          `plan contable anterior y no se puede usar para clasificar gastos nuevos. ` +
          `Seleccione una cuenta activa.`,
        400
      );
    }
  }

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
      chart_account_code: input.chart_account_code,
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

export async function markBusinessExpenseAsPaid(
  db: DB,
  tenantId: string,
  id: string,
  userId: string,
  paymentDate: string,
  paymentMethod: BusinessExpensePaymentMethod | null
) {
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

  const { error: errUpdate } = await db
    .from("business_expenses")
    .update({
      status: "pagado",
      payment_date: paymentDate,
      payment_method: paymentMethod,
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
