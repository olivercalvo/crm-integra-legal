/**
 * UN GASTO DE TRÁMITE EN EL LIBRO NO SE EDITA NI SE ELIMINA (14/10/2026).
 *
 * La base ya lo impide (`reject_expense_mutation_si_asentado`, 038/049/068),
 * pero la pantalla ofrecía el lápiz y la papelera y la ruta devolvía 500. Acá
 * vive la regla que usan las dos, para que el botón deshabilitado y el 409 digan
 * lo mismo:
 *   · «con asiento» = existe un asiento `gasto_tramite` del gasto, el MISMO
 *     criterio de `gasto_tramite_tiene_asiento` en la base (también si después
 *     se reversó: la fila sigue congelada);
 *   · lo congelado es lo que congela el trigger; el comprobante, el proveedor y
 *     completar el N.º de factura vacío se siguen pudiendo (el alta adjunta el
 *     comprobante con un PATCH DESPUÉS de postear el gasto).
 * Corregir un gasto contabilizado (reversa + asiento nuevo) es la próxima
 * iteración, con el criterio de la 103.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const MENSAJE_GASTO_EN_EL_LIBRO_NO_SE_EDITA =
  "Este gasto ya está en el libro contable y no se edita. Si hay un error, el contador lo corrige con un asiento de diario.";

export const MENSAJE_GASTO_EN_EL_LIBRO_NO_SE_ELIMINA =
  "Este gasto ya está en el libro contable y no se elimina. Si hay un error, el contador lo corrige con un asiento de diario.";

export const MENSAJE_NUMERO_DE_FACTURA_CONGELADO =
  "Este gasto ya está en el libro contable: el número de la factura del proveedor ya no se cambia. Si hay un error, el contador lo corrige con un asiento de diario.";

/** Los campos que la ruta deja cambiar y la base congela con el gasto en el libro. */
export const CAMPOS_CONGELADOS = ["amount", "concept", "date", "accounting_date"] as const;

type Valores = Partial<Record<(typeof CAMPOS_CONGELADOS)[number], unknown>>;

const normalizar = (campo: string, v: unknown) =>
  v === undefined ? undefined : campo === "concept" && typeof v === "string" ? v.trim() : campo === "amount" ? Number(v) : v;

/** ¿El pedido cambia algo de lo que la base congela? (los campos que no vienen no cuentan). */
export function tocaCamposCongelados(actual: Valores, pedido: Valores): boolean {
  return CAMPOS_CONGELADOS.some((c) => {
    const nuevo = normalizar(c, pedido[c]);
    if (nuevo === undefined) return false;
    return nuevo !== normalizar(c, actual[c]);
  });
}

/** ¿Cambia un N.º de factura que ya estaba cargado? (completarlo si estaba vacío sí se puede). */
export function cambiaNumeroDeFacturaCargado(actual: string | null | undefined, pedido: unknown): boolean {
  if (pedido === undefined) return false;
  const nuevo = typeof pedido === "string" && pedido.trim() !== "" ? pedido.trim() : null;
  return !!actual && nuevo !== actual;
}

/** Los gastos (de la lista) que tienen asiento en el libro: el criterio de la base. */
export async function gastosConAsiento(db: SupabaseClient, tenantId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await db
    .from("journal_entries")
    .select("source_id")
    .eq("tenant_id", tenantId)
    .eq("source_type", "gasto_tramite")
    .in("source_id", ids);
  // Ante la duda no se asume que no hay asiento: la ruta y la base lo vuelven a mirar.
  if (error) throw new Error("No se pudo verificar si el gasto ya está en el libro contable");
  return new Set(((data ?? []) as { source_id: string }[]).map((r) => r.source_id));
}
