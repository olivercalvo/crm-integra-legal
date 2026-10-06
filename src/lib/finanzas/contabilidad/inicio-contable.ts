/**
 * INICIO CONTABLE: lo anterior está «contabilizado fuera» (migración `096`).
 *
 * Desde el inicio contable cada documento del CRM genera su asiento. Lo anterior
 * ya está en los libros del contador (QuickBooks o los registros de las
 * licenciadas): el CRM no lo vuelve a contabilizar, pero el documento sigue
 * existiendo y sigue contando en la antigüedad, el estado de cuenta y los
 * listados, con la etiqueta «Contabilizado fuera».
 *
 * 🔴 Se compara la FECHA DEL DOCUMENTO, cada uno con la suya (no la de registro,
 *    no el punto de facturación):
 *      factura / ND / NC de venta ... `issue_date`
 *      cobro / pago a proveedor ..... `payment_date`
 *      compra ....................... `expense_date`
 *      gasto de trámite ............. `date`
 *    Un cobro de agosto aplicado a una factura de junio SÍ postea: acredita el
 *    100004 del cliente, cuyo saldo viene del saldo inicial.
 *
 * La base lo vuelve a exigir (trigger `trg_libro_desde_el_inicio`, 096): acá se
 * decide ANTES de armar el asiento, para no postear y no quemar nada.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

/** El valor de la 096 cuando el bufete no tiene fila (y el de la columna). */
export const INICIO_CONTABLE_POR_DEFECTO = "2026-07-01";

export const ETIQUETA_CONTABILIZADO_FUERA = "Contabilizado fuera";

/** `YYYY-MM-DD` de una fecha o timestamp, sin pasar por `Date` (sin husos). */
function dia(fecha: string): string {
  return String(fecha).slice(0, 10);
}

/**
 * ¿El documento es anterior al inicio contable? El mismo día del inicio YA
 * postea: el corte es «anterior a», no «hasta».
 */
export function esContabilizadoFuera(fechaDocumento: string | null | undefined, inicio: string): boolean {
  if (!fechaDocumento) return false;
  return dia(fechaDocumento) < dia(inicio);
}

/** `01/07/2026`. */
export function fechaCorta(fecha: string): string {
  const [a, m, d] = dia(fecha).split("-");
  return `${d}/${m}/${a}`;
}

/** Lo que se le dice a la persona: por qué este documento no tiene asiento. */
export function explicacionContabilizadoFuera(inicio: string): string {
  return (
    `Su fecha es anterior al inicio contable (${fechaCorta(inicio)}): ya está en los libros del ` +
    `contador y el CRM no le genera asiento.`
  );
}

/**
 * La fecha del bufete. 🔴 Leer NUNCA rompe una pantalla: sin la 096, sin fila o
 * con un error, es el valor por defecto (el mismo que pone la base).
 */
export async function cargarInicioContable(db: DB, tenantId: string): Promise<string> {
  const { data, error } = await db
    .from("finanzas_parametros")
    .select("fecha_inicio_contable")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    console.error("[finanzas/inicio-contable] no se pudo leer, se usa el valor por defecto", error);
    return INICIO_CONTABLE_POR_DEFECTO;
  }
  const f = (data as { fecha_inicio_contable?: string | null } | null)?.fecha_inicio_contable;
  return f ? dia(f) : INICIO_CONTABLE_POR_DEFECTO;
}

/** Atajo para los puntos de posteo: ¿este documento queda fuera del libro? */
export async function documentoContabilizadoFuera(
  db: DB,
  tenantId: string,
  fechaDocumento: string | null | undefined
): Promise<boolean> {
  if (!fechaDocumento) return false;
  return esContabilizadoFuera(fechaDocumento, await cargarInicioContable(db, tenantId));
}

/**
 * Validación del valor que manda la pantalla. Módulo puro: la base es la que
 * decide si el cambio cruza documentos (trigger de la 096).
 */
export function validarInicioContable(
  raw: unknown
): { ok: true; fecha: string } | { ok: false; error: string } {
  const v = (raw ?? {}) as Record<string, unknown>;
  const f = typeof v.fecha_inicio_contable === "string" ? v.fecha_inicio_contable.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
    return { ok: false, error: "Indica la fecha de inicio contable (día, mes y año)." };
  }
  const d = new Date(`${f}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== f) {
    return { ok: false, error: "La fecha de inicio contable no es válida." };
  }
  if (f < "2000-01-01" || f > "2100-12-31") {
    return { ok: false, error: "La fecha de inicio contable está fuera de rango." };
  }
  return { ok: true, fecha: f };
}
