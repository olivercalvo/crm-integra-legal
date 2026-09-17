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

// ---------------------------------------------------------------------------
// RESOLVER CÓDIGOS POR ID — lo que usa el servidor antes de escribir una línea
// ---------------------------------------------------------------------------

/** Un código resuelto: lo que la línea necesita para su snapshot. */
export interface CodigoDeImpuestoResuelto {
  id: string;
  code: string;
  rate: number;
}

/**
 * Devuelve los códigos de impuesto ACTIVOS de este bufete para un conjunto de
 * ids, o rechaza nombrando el problema.
 *
 * Existe porque la tasa de una línea de gasto (`expense_lines.tax_rate`) es un
 * snapshot de `tax_codes.rate`, y el snapshot lo tiene que tomar el SERVIDOR,
 * no la pantalla: un body puede mandar `tax_code_id` de ITBMS 7% con
 * `tax_rate: 0` y, si se le creyera, la línea guardaría un impuesto que no es
 * el del código que dice haber elegido. Es la doctrina de CLAUDE.md: el
 * servidor es el permiso.
 *
 * ⚠️ Filtra por `tenant_id` aunque el id sea un uuid: la FK de
 * `expense_lines.tax_code_id` es global, así que sin este filtro un id de otro
 * bufete pasaría la base. Y filtra `active`: un código desactivado en
 * Configuración → Impuestos no puede entrar en una línea nueva, aunque siga
 * existiendo para las viejas.
 *
 * Devuelve un Map por id. Si falta alguno (no existe, no es de este tenant, o
 * está inactivo) lanza `MutationError` 400 con los ids que faltaron.
 */
export async function resolverCodigosDeImpuesto(
  db: SupabaseClient,
  tenantId: string,
  ids: readonly string[]
): Promise<Map<string, CodigoDeImpuestoResuelto>> {
  const unicos = Array.from(new Set(ids.filter((id) => id && id.trim() !== "")));
  const resueltos = new Map<string, CodigoDeImpuestoResuelto>();
  if (unicos.length === 0) return resueltos;

  const { data, error } = await db
    .from("tax_codes")
    .select("id, code, rate")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .in("id", unicos);

  if (error) {
    console.error("[finanzas] resolverCodigosDeImpuesto failed", error);
    throw new MutationError("No se pudo leer el catálogo de impuestos", 500, error);
  }

  for (const t of (data ?? []) as { id: string; code: string; rate: number | string }[]) {
    resueltos.set(t.id, { id: t.id, code: t.code, rate: Number(t.rate) });
  }

  const faltan = unicos.filter((id) => !resueltos.has(id));
  if (faltan.length > 0) {
    throw new MutationError(
      "El impuesto elegido en alguna línea no existe o está inactivo en el catálogo " +
        "de este bufete. Vuelva a elegirlo en el desplegable.",
      400,
      { ids: faltan }
    );
  }

  return resueltos;
}
