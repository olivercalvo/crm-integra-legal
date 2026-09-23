/**
 * Mutaciones de proveedores. Mismo patrón que `api/business-expenses.ts`:
 * admin client + filtro manual por `tenant_id` + `MutationError` con el código
 * HTTP sugerido, y una fila en `audit_log` por operación.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateSupplierInput, UpdateSupplierInput } from "@/lib/finanzas/types/supplier";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { allocateSupplierNumber } from "@/lib/finanzas/numbering/supplier-numbering";
import { motivoDeRechazoComoDefaultDeProveedor } from "@/lib/finanzas/contabilidad/cuentas-de-gasto";
import type { AccountType } from "@/lib/finanzas/types/chart-of-account";

type DB = SupabaseClient;

const ENTITY = "suppliers";

/**
 * La cuenta por defecto del proveedor tiene que EXISTIR, ser de gasto o costo y
 * estar activa (4.4).
 *
 * Es cross-tabla, así que no puede vivir en el validador puro: el mismo patrón
 * que `isValidExpenseAccountCode` en `api/business-expenses.ts`.
 *
 * 🔴 Usa `motivoDeRechazoComoDefaultDeProveedor`, NO `motivoDeRechazo`. El
 * segundo permite `asset` a propósito, para que `130003` pueda clasificar un
 * gasto de trámite. Acá un activo no sirve: una compra del bufete es un gasto o
 * un costo propio, nunca un adelanto por un cliente. Ver el comentario largo en
 * `contabilidad/cuentas-de-gasto.ts`.
 *
 * Se valida al GUARDAR, no al leer: una cuenta puede desactivarse después, y
 * para ese caso la decisión es DEGRADAR en pantalla, no bloquear la ficha.
 */
async function validarCuentaPorDefecto(
  db: DB,
  tenantId: string,
  code: string | null
): Promise<void> {
  if (!code) return;

  const { data, error } = await db
    .from("chart_of_accounts")
    .select("code, name, account_type, active")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .maybeSingle();

  if (error) {
    console.error("[finanzas/api] validarCuentaPorDefecto failed", error);
    throw new MutationError(pgErrorToMessage(error), 500, error);
  }
  if (!data) {
    throw new MutationError(
      `La cuenta contable "${code}" no existe en el plan de cuentas.`,
      400
    );
  }

  const motivo = motivoDeRechazoComoDefaultDeProveedor({
    code: data.code as string,
    name: data.name as string,
    account_type: data.account_type as AccountType,
    active: data.active as boolean,
  });
  if (motivo) throw new MutationError(motivo, 400);
}

/** 23505 = unique_violation. El único UNIQUE "de negocio" es el nombre. */
function esNombreRepetido(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "23505" && !!e.message?.includes("legal_name");
}

export async function createSupplier(
  db: DB,
  tenantId: string,
  userId: string,
  input: CreateSupplierInput
) {
  await validarCuentaPorDefecto(db, tenantId, input.default_chart_account_code);

  const supplierNumber = await allocateSupplierNumber(db, tenantId);

  const { data, error } = await db
    .from("suppliers")
    .insert({
      tenant_id: tenantId,
      supplier_number: supplierNumber,
      legal_name: input.legal_name,
      trade_name: input.trade_name,
      // RUC y DV se guardan por separado. Nunca concatenados.
      ruc: input.ruc,
      dv: input.dv,
      address: input.address,
      phone: input.phone,
      email: input.email,
      default_chart_account_code: input.default_chart_account_code,
      contact_name: input.contact_name,
      contact_phone: input.contact_phone,
      contact_email: input.contact_email,
      payment_terms_days: input.payment_terms_days,
      active: input.active,
      notes: input.notes,
      created_by: userId,
    })
    .select("id, supplier_number")
    .single();

  if (error || !data) {
    if (esNombreRepetido(error)) {
      throw new MutationError(
        `Ya existe un proveedor con la razón social "${input.legal_name}". Use esa ficha en lugar de crear otra.`,
        409,
        error
      );
    }
    console.error("[finanzas/api] createSupplier failed", error);
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
      supplier_number: data.supplier_number,
      legal_name: input.legal_name,
      ruc: input.ruc,
      dv: input.dv,
      payment_terms_days: input.payment_terms_days,
    }),
  });

  return { id: data.id as string, supplier_number: data.supplier_number as string };
}

export async function updateSupplier(
  db: DB,
  tenantId: string,
  userId: string,
  id: string,
  input: UpdateSupplierInput
) {
  const { data: antes } = await db
    .from("suppliers")
    .select("id, legal_name, ruc, dv, payment_terms_days, active")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (!antes) throw new MutationError("Proveedor no encontrado", 404);

  await validarCuentaPorDefecto(db, tenantId, input.default_chart_account_code);

  const { error } = await db
    .from("suppliers")
    .update({
      legal_name: input.legal_name,
      trade_name: input.trade_name,
      ruc: input.ruc,
      dv: input.dv,
      address: input.address,
      phone: input.phone,
      email: input.email,
      default_chart_account_code: input.default_chart_account_code,
      contact_name: input.contact_name,
      contact_phone: input.contact_phone,
      contact_email: input.contact_email,
      payment_terms_days: input.payment_terms_days,
      active: input.active,
      notes: input.notes,
    })
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) {
    if (esNombreRepetido(error)) {
      throw new MutationError(
        `Ya existe otro proveedor con la razón social "${input.legal_name}".`,
        409,
        error
      );
    }
    console.error("[finanzas/api] updateSupplier failed", error);
    throw new MutationError(pgErrorToMessage(error), 500, error);
  }

  await db.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: userId,
    entity: ENTITY,
    entity_id: id,
    action: "update",
    field: null,
    old_value: JSON.stringify(antes),
    new_value: JSON.stringify({
      legal_name: input.legal_name,
      ruc: input.ruc,
      dv: input.dv,
      payment_terms_days: input.payment_terms_days,
      active: input.active,
    }),
  });

  return { id };
}

/**
 * Borra un proveedor.
 *
 * Si tiene gastos NO se borra: se propone desactivarlo. Borrarlo pondría en
 * NULL el `supplier_id` de esos gastos (ON DELETE SET NULL) y el historial
 * quedaría sin a quién se le compró. Un proveedor con el que se dejó de
 * trabajar se desactiva, no se elimina.
 */
export async function deleteSupplier(db: DB, tenantId: string, userId: string, id: string) {
  const { data: antes } = await db
    .from("suppliers")
    .select("id, supplier_number, legal_name")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (!antes) throw new MutationError("Proveedor no encontrado", 404);

  const { count } = await db
    .from("business_expenses")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("supplier_id", id);

  if ((count ?? 0) > 0) {
    throw new MutationError(
      `${antes.legal_name} tiene ${count} gasto(s) registrados y no se puede eliminar. ` +
        "Desactívelo para que deje de aparecer al cargar gastos nuevos; el historial se conserva.",
      409
    );
  }

  // 054: y si aparece en el LIBRO, tampoco — pero por otro motivo, y el mensaje
  // lo dice. La FK es `ON DELETE NO ACTION` y el libro es inmutable: no es que
  // haya que borrar algo antes, es que nunca se va a poder. Sin este conteo el
  // DELETE explotaría con el texto crudo de la FK (D2).
  const { count: enElLibro } = await db
    .from("journal_entry_lines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("supplier_id", id);

  if ((enElLibro ?? 0) > 0) {
    throw new MutationError(
      `${antes.legal_name} aparece en ${enElLibro} línea(s) de asiento del libro contable y no se ` +
        "puede eliminar: el libro es inmutable. Desactívelo en su lugar.",
      409
    );
  }

  const { error } = await db
    .from("suppliers")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) {
    console.error("[finanzas/api] deleteSupplier failed", error);
    throw new MutationError(pgErrorToMessage(error), 500, error);
  }

  await db.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: userId,
    entity: ENTITY,
    entity_id: id,
    action: "delete",
    field: null,
    old_value: JSON.stringify(antes),
    new_value: null,
  });

  return { id };
}
