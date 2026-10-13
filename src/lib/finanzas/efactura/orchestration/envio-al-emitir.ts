/**
 * «Enviar a la DGI» o «Interna (no se envía)», elegido AL EMITIR una nota de
 * crédito o de débito (03/10/2026).
 *
 *   · "dgi": el documento se emite (libro) y en seguida se manda al PAC con el
 *     orquestador de siempre. Si el PAC rechaza o no contesta, el documento ya
 *     está emitido: queda en `error` y se reintenta desde su tarjeta, igual que
 *     hoy. Un rechazo del PAC NO deshace el asiento.
 *   · "interna": el documento se emite igual (mismo asiento) y queda
 *     `fe_estado = 'interna'`, que la base hace terminal (083): nunca llama al
 *     PAC y la pantalla ya no ofrece enviarlo.
 *
 * Sin elección (`null`), todo sigue como antes: emitido y «Sin enviar».
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MutationError, pgErrorToMessage } from "@/lib/finanzas/api/errors";
import { enviarFacturaALaDgi, enviarNotaDeCreditoALaDgi } from "./enviar-a-la-dgi";

type DB = SupabaseClient;

export type ModoDeEnvio = "dgi" | "interna";

/** Lee la elección del cuerpo del request. Cualquier otro valor es un 400. */
export function leerModoDeEnvio(v: unknown): ModoDeEnvio | null {
  if (v === undefined || v === null || v === "") return null;
  if (v === "dgi" || v === "interna") return v;
  throw new MutationError("El envío tiene que ser «dgi» o «interna».", 400, undefined, {
    envio: "Elige «Enviar a la DGI» o «Interna».",
  });
}

export interface ResultadoDelEnvio {
  envio: ModoDeEnvio;
  /** Con "dgi": cómo terminó el envío (`ok`, `feEstado`, mensaje). */
  fe?: { ok: boolean; feEstado: string; mensaje: string | null };
}

/** Marca un documento recién emitido como interno. Sólo desde `no_emitida`. */
export async function marcarComoInterna(
  db: DB,
  tenantId: string,
  tabla: "invoices" | "credit_notes",
  id: string
): Promise<void> {
  const { count, error } = await db
    .from(tabla)
    .update({ fe_estado: "interna" }, { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("fe_estado", "no_emitida");
  if (error) throw new MutationError(pgErrorToMessage(error), 500, error);
  if (!count) {
    throw new MutationError("El documento ya no está «sin enviar»: no se puede marcar como interno.", 409);
  }
}

/**
 * Aplica la elección sobre un documento YA emitido. Nunca lanza por un rechazo
 * del PAC: el documento existe y el resultado lo dice.
 */
export async function aplicarEnvioAlEmitir(
  db: DB,
  tenantId: string,
  userId: string,
  doc: { tabla: "invoices" | "credit_notes"; id: string },
  modo: ModoDeEnvio
): Promise<ResultadoDelEnvio> {
  if (modo === "interna") {
    await marcarComoInterna(db, tenantId, doc.tabla, doc.id);
    return { envio: "interna" };
  }
  try {
    if (doc.tabla === "invoices") {
      const r = await enviarFacturaALaDgi(db, tenantId, userId, doc.id);
      const ok = r.feEstado === "authorized";
      return { envio: "dgi", fe: { ok, feEstado: r.feEstado, mensaje: ok ? null : r.errorMessage } };
    }
    const r = await enviarNotaDeCreditoALaDgi(db, tenantId, userId, doc.id);
    return { envio: "dgi", fe: { ok: r.ok, feEstado: r.feEstado, mensaje: r.ok ? null : r.mensaje } };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    return { envio: "dgi", fe: { ok: false, feEstado: "no_emitida", mensaje } };
  }
}
