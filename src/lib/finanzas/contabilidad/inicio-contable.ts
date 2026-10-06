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
import { MutationError } from "@/lib/finanzas/api/errors";

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

// ---------------------------------------------------------------------------
// 096 (ajuste del 06/10/2026): lo anterior al inicio NO se crea, NO se mueve a
// una fecha anterior, y NO se anula ni se elimina. La base lo vuelve a exigir
// con los mismos textos (triggers de la 096); acá se dice antes de tocar nada,
// y antes de tomar un número.
// ---------------------------------------------------------------------------

export type TipoDeDocumento =
  | "factura"
  | "nota_debito"
  | "nota_credito"
  | "cobro"
  | "compra"
  | "gasto_tramite"
  | "pago_proveedor"
  | "factura_externa"
  | "nota_credito_compra";

/** «la factura», «el cobro»… para armar las frases. */
const NOMBRE: Record<TipoDeDocumento, string> = {
  factura: "la factura",
  nota_debito: "la nota de débito",
  nota_credito: "la nota de crédito",
  cobro: "el cobro",
  compra: "la compra",
  gasto_tramite: "el gasto de trámite",
  pago_proveedor: "el pago al proveedor",
  factura_externa: "la factura emitida fuera",
  nota_credito_compra: "la nota de crédito del proveedor",
};

/**
 * Con qué se corrige un documento contabilizado fuera. Una venta y una compra,
 * con una nota de crédito; un cobro o un pago no tienen nota de crédito: con un
 * asiento de diario (siempre con fecha igual o posterior al inicio).
 */
const SE_CORRIGE_CON: Record<TipoDeDocumento, string> = {
  factura: "una nota de crédito",
  nota_debito: "una nota de crédito",
  nota_credito: "un asiento de diario",
  cobro: "un asiento de diario",
  compra: "una nota de crédito del proveedor",
  gasto_tramite: "una nota de crédito del proveedor",
  pago_proveedor: "un asiento de diario",
  factura_externa: "una nota de crédito",
  nota_credito_compra: "un asiento de diario",
};

/** Los masculinos: «el cobro … está contabilizado fuera». */
const MASCULINO = new Set<TipoDeDocumento>(["cobro", "gasto_tramite", "pago_proveedor"]);

function mayuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** «de la factura» / «del cobro» (de + el = del). */
function deNombre(tipo: TipoDeDocumento): string {
  const n = NOMBRE[tipo];
  return n.startsWith("el ") ? `del ${n.slice(3)}` : `de ${n}`;
}

/** Alta o edición con una fecha anterior al inicio. */
export function mensajeFechaAnteriorAlInicio(tipo: TipoDeDocumento, fecha: string, inicio: string): string {
  return (
    `La fecha ${deNombre(tipo)} (${fechaCorta(fecha)}) es anterior al inicio contable ` +
    `(${fechaCorta(inicio)}). Lo anterior al inicio está en los libros del contador: no se ` +
    `registran documentos con esa fecha.`
  );
}

/** Anular (factura, ND) o eliminar (los demás) un documento contabilizado fuera. */
export function mensajeContabilizadoFueraNoSeAnula(
  tipo: TipoDeDocumento,
  numero: string | null,
  fecha: string,
  inicio: string
): string {
  const verbo = tipo === "factura" || tipo === "nota_debito" || tipo === "factura_externa" ? "anula" : "elimina";
  const doc = numero ? `${NOMBRE[tipo]} ${numero}` : NOMBRE[tipo];
  return (
    `${mayuscula(doc)} (${fechaCorta(fecha)}) está ${MASCULINO.has(tipo) ? "contabilizado" : "contabilizada"} fuera: ` +
    `su fecha es anterior al ` +
    `inicio contable (${fechaCorta(inicio)}). No se ${verbo}: se corrige con ` +
    `${SE_CORRIGE_CON[tipo]} con fecha igual o posterior al inicio.`
  );
}

/**
 * Alta o edición: la fecha del documento no puede ser anterior al inicio. 422,
 * con el error en el campo (`campo`) para que el formulario lo marque.
 */
export async function asegurarFechaDesdeElInicio(
  db: DB,
  tenantId: string,
  tipo: TipoDeDocumento,
  fecha: string | null | undefined,
  campo: string
): Promise<void> {
  if (!fecha) return;
  const inicio = await cargarInicioContable(db, tenantId);
  if (esContabilizadoFuera(fecha, inicio)) {
    const mensaje = mensajeFechaAnteriorAlInicio(tipo, fecha, inicio);
    throw new MutationError(mensaje, 422, undefined, { [campo]: mensaje });
  }
}

/** Anular o eliminar: un documento contabilizado fuera no se toca. 409. */
export async function asegurarQueNoEsContabilizadoFuera(
  db: DB,
  tenantId: string,
  tipo: TipoDeDocumento,
  numero: string | null,
  fecha: string | null | undefined
): Promise<void> {
  if (!fecha) return;
  const inicio = await cargarInicioContable(db, tenantId);
  if (esContabilizadoFuera(fecha, inicio)) {
    throw new MutationError(mensajeContabilizadoFueraNoSeAnula(tipo, numero, fecha, inicio), 409);
  }
}
