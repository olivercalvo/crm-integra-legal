/**
 * Helpers server-side para mutaciones de chart_of_accounts (Plan de Cuentas).
 * Llamados desde los route handlers `/api/finanzas/configuracion/chart-of-accounts`.
 *
 * Mismo patrón que api/business-expenses.ts: admin client (bypass RLS) + filter
 * manual por tenant_id + MutationError con código HTTP sugerido + audit_log en
 * cada mutación (entity='chart_of_accounts').
 *
 * Reglas de negocio (ver CLAUDE.md / prompt AG):
 *   - code único por tenant (guard app-level + UNIQUE en BD como red final).
 *   - is_system=true (1201,1202,2301,4101,4102): NO se puede desactivar ni
 *     cambiar el código. El nombre/tipo/descripción sí se pueden editar.
 *   - Sin hard delete: "borrar" = active=false.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ChartAccountRow,
  CreateChartAccountInput,
  UpdateChartAccountInput,
} from "@/lib/finanzas/types/chart-of-account";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { findChartAccountByCode } from "@/lib/finanzas/queries/chart-of-accounts";

type DB = SupabaseClient;

const ENTITY = "chart_of_accounts";
const SELECT_COLS =
  "id, code, name, account_type, account_name_qb, description, is_trust_pass_through, is_system, active";

/** true si el error de Postgres es una violación de UNIQUE (código 23505). */
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "23505";
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

export async function createChartAccount(
  db: DB,
  tenantId: string,
  userId: string,
  input: CreateChartAccountInput
): Promise<ChartAccountRow> {
  // Unicidad de código por tenant (guard app-level → 400 accionable).
  const dup = await findChartAccountByCode(db, tenantId, input.code);
  if (dup) {
    throw new MutationError(
      `Ya existe una cuenta con el código "${input.code}". Usá un código distinto.`,
      400
    );
  }

  const { data, error } = await db
    .from("chart_of_accounts")
    .insert({
      tenant_id: tenantId,
      code: input.code,
      name: input.name,
      account_type: input.account_type,
      description: input.description,
      active: input.active,
      // La pantalla mantiene la tabla PLANA y no gestiona trust/QB/is_system:
      is_trust_pass_through: false,
      is_system: false,
    })
    .select(SELECT_COLS)
    .single();

  if (error || !data) {
    // Red final: si dos requests concurrentes pasaron el guard, la UNIQUE de BD
    // frena el segundo. Lo traducimos al mismo 409 accionable.
    if (isUniqueViolation(error)) {
      throw new MutationError(
        `Ya existe una cuenta con el código "${input.code}". Usá un código distinto.`,
        400
      );
    }
    console.error("[finanzas/api] createChartAccount failed", error);
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
      code: input.code,
      name: input.name,
      account_type: input.account_type,
      description: input.description,
      active: input.active,
    }),
  });

  return data as ChartAccountRow;
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

export async function updateChartAccount(
  db: DB,
  tenantId: string,
  id: string,
  userId: string,
  input: UpdateChartAccountInput
): Promise<ChartAccountRow> {
  // Existencia + tenant ownership (defensa en profundidad sobre RLS).
  const { data: existing, error: errExisting } = await db
    .from("chart_of_accounts")
    .select("id, code, name, account_type, description, active, is_system")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (errExisting) {
    throw new MutationError(pgErrorToMessage(errExisting), 500, errExisting);
  }
  if (!existing) {
    throw new MutationError("Cuenta no encontrada", 404);
  }

  const isSystem = existing.is_system === true;

  // Regla: no se puede DESACTIVAR una cuenta del sistema (la usan los reportes).
  // Reactivar (false→true) sí se permite; editar nombre/tipo/desc también.
  if (isSystem && existing.active === true && input.active === false) {
    throw new MutationError(
      `La cuenta "${existing.code}" es del sistema (la usan los reportes) y no se puede desactivar.`,
      409
    );
  }

  // El CÓDIGO es INMUTABLE para TODAS las cuentas (no solo is_system). Es la
  // identidad contable de la cuenta y actúa como FK LÓGICO desde
  // business_expenses.chart_account_code (SIN constraint ni ON UPDATE CASCADE,
  // ver 010_create_business_expenses.sql): renombrarlo orfanaría en silencio
  // los gastos que la referencian. Si el código está mal, se desactiva la
  // cuenta y se crea una nueva.
  const wantsCode = input.code !== undefined && input.code !== existing.code;
  if (wantsCode) {
    throw new MutationError(
      "El código de una cuenta no se puede modificar. Si está mal, desactivala y creá una nueva.",
      400
    );
  }

  const updatePayload: Record<string, unknown> = {
    name: input.name,
    account_type: input.account_type,
    description: input.description,
    active: input.active,
  };

  const { data, error: errUpdate } = await db
    .from("chart_of_accounts")
    .update(updatePayload)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select(SELECT_COLS)
    .single();

  if (errUpdate || !data) {
    console.error("[finanzas/api] updateChartAccount failed", errUpdate);
    throw new MutationError(pgErrorToMessage(errUpdate), 500, errUpdate);
  }

  // Audit log: diff de campos modificados. El código nunca cambia (inmutable),
  // así que no forma parte del diff.
  const fields: Array<keyof typeof updatePayload> = [
    "name",
    "account_type",
    "description",
    "active",
  ];
  const changed: Record<string, { old: unknown; new: unknown }> = {};
  for (const f of fields) {
    if (!(f in updatePayload)) continue;
    const oldVal = (existing as unknown as Record<string, unknown>)[f];
    const newVal = updatePayload[f];
    if (oldVal !== newVal) changed[f] = { old: oldVal, new: newVal };
  }

  if (Object.keys(changed).length > 0) {
    await db.from("audit_log").insert({
      tenant_id: tenantId,
      user_id: userId,
      entity: ENTITY,
      entity_id: id,
      action: "update",
      field: Object.keys(changed).join(","),
      old_value: JSON.stringify(
        Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.old]))
      ),
      new_value: JSON.stringify(
        Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.new]))
      ),
    });
  }

  return data as ChartAccountRow;
}
