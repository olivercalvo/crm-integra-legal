/**
 * La fecha de registro contra la base: averigua si el período está cerrado y
 * aplica la regla pura de `contabilidad/fecha-de-registro.ts`.
 *
 * Se llama ANTES de tomar un correlativo o de llamar a un RPC, para contestar
 * con un 422 legible y sin quemar número. No reemplaza a la base: el período lo
 * vuelve a exigir `post_journal_entry`, y "no antes del original" cada RPC de
 * reversión.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import {
  errorDeFechaDeRegistro,
  esFechaIso,
  periodoDe,
} from "@/lib/finanzas/contabilidad/fecha-de-registro";
import { hoyEnPanama } from "@/lib/utils/hoy-en-panama";

type DB = SupabaseClient;

/** `true` si el período de `fecha` existe y está cerrado. */
export async function periodoCerrado(db: DB, tenantId: string, fecha: string): Promise<boolean> {
  const { year, month } = periodoDe(fecha);
  const { data, error } = await db
    .from("accounting_periods")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  if (error) {
    throw new MutationError(pgErrorToMessage(error), 500, error);
  }
  // Un período que no existe no está cerrado: `post_journal_entry` lo crea si es
  // del año en curso o del siguiente, y si no lo rechaza con su propio mensaje.
  return (data as { status?: string } | null)?.status === "cerrado";
}

/**
 * Devuelve la fecha de registro a usar (la pedida o, si no vino, hoy en Panamá)
 * o lanza 422 con el mensaje de la regla.
 */
export async function resolverFechaDeRegistro(
  db: DB,
  tenantId: string,
  pedida: unknown,
  opciones: {
    noAntesDe?: { fecha: string; etiqueta: string } | null;
    que?: string;
    /** Clave del error de campo (para que el formulario lo pinte en su input). */
    campo?: string;
  } = {}
): Promise<string> {
  const hoy = hoyEnPanama();
  const fecha = pedida === undefined || pedida === null || pedida === "" ? hoy : pedida;
  const cerrado = esFechaIso(fecha) ? await periodoCerrado(db, tenantId, fecha) : false;
  const error = errorDeFechaDeRegistro({
    fecha,
    hoy,
    periodoCerrado: cerrado,
    noAntesDe: opciones.noAntesDe ?? null,
    que: opciones.que,
  });
  if (error) {
    throw new MutationError(
      error,
      422,
      undefined,
      opciones.campo ? { [opciones.campo]: error } : undefined
    );
  }
  return fecha as string;
}
