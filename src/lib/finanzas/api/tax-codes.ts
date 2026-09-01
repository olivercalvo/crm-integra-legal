/**
 * Lectura y edición del catálogo de impuestos (`tax_codes`).
 *
 * La tasa dejó de ser un número fijo en el código el 01/09/2026 — pedido de Rose
 * en la reunión del 25/08, porque el sistema se puede vender a rubros con 10% o
 * 5%. Ver el encabezado de `types/tax-code.ts` para qué NO cambia al cambiarla.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { MutationError } from "@/lib/finanzas/api/errors";
import type { TaxCodeRow, UpdateTaxCodeInput } from "@/lib/finanzas/types/tax-code";

const ENTITY = "tax_codes";
const SELECT_COLS = "id, code, name, rate, active";

/** Catálogo completo del tenant, activos e inactivos, ordenado por código. */
export async function listTaxCodes(
  db: SupabaseClient,
  tenantId: string
): Promise<TaxCodeRow[]> {
  const { data, error } = await db
    .from("tax_codes")
    .select(SELECT_COLS)
    .eq("tenant_id", tenantId)
    .order("code");

  if (error) {
    console.error("[finanzas] listTaxCodes failed", error);
    throw new MutationError("No se pudo leer el catálogo de impuestos", 500, error);
  }

  return ((data ?? []) as unknown as TaxCodeRow[]).map((t) => ({
    ...t,
    rate: Number(t.rate),
  }));
}

/**
 * Cambia nombre, tasa y/o estado de un código de impuesto.
 *
 * No toca `code`: es la clave con la que las líneas de factura y cotización
 * referencian el impuesto, y renombrarlo dejaría documentos apuntando a un
 * código que ya no existe.
 */
export async function updateTaxCode(
  db: SupabaseClient,
  tenantId: string,
  id: string,
  userId: string,
  input: UpdateTaxCodeInput
): Promise<TaxCodeRow> {
  const { data: actual, error: errSel } = await db
    .from("tax_codes")
    .select(SELECT_COLS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (errSel) {
    throw new MutationError("No se pudo leer el impuesto", 500, errSel);
  }
  if (!actual) {
    throw new MutationError("Impuesto no encontrado", 404);
  }

  const previo = actual as unknown as TaxCodeRow;

  // Solo lo que de verdad cambió — así el audit_log no se llena de updates vacíos.
  const changed: Record<string, { old: unknown; nuevo: unknown }> = {};
  if (input.name !== undefined && input.name !== previo.name) {
    changed.name = { old: previo.name, nuevo: input.name };
  }
  if (input.rate !== undefined && Number(input.rate) !== Number(previo.rate)) {
    changed.rate = { old: Number(previo.rate), nuevo: input.rate };
  }
  if (input.active !== undefined && input.active !== previo.active) {
    changed.active = { old: previo.active, nuevo: input.active };
  }

  if (Object.keys(changed).length === 0) {
    return { ...previo, rate: Number(previo.rate) };
  }

  const patch: Record<string, unknown> = {};
  for (const [campo, v] of Object.entries(changed)) patch[campo] = v.nuevo;

  const { data, error } = await db
    .from("tax_codes")
    .update(patch)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select(SELECT_COLS)
    .single();

  if (error) {
    console.error("[finanzas] updateTaxCode failed", error);
    throw new MutationError("No se pudo actualizar el impuesto", 400, error);
  }

  // Cambiar una tasa impositiva es de las cosas que después alguien pregunta
  // "¿quién y cuándo?". Que quede registrado no es opcional.
  try {
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
        Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.nuevo]))
      ),
    });
  } catch (err) {
    console.warn("[finanzas] updateTaxCode: audit_log insert falló", err);
  }

  const row = data as unknown as TaxCodeRow;
  return { ...row, rate: Number(row.rate) };
}
