import { NextResponse } from "next/server";
import { MENSAJE_POSTEO_HISTORICO_APAGADO } from "@/lib/finanzas/posteo-historico-mensaje";

export { MENSAJE_POSTEO_HISTORICO_APAGADO };

/**
 * INTERRUPTOR del posteo histórico (Oliver, 07/10/2026).
 *
 * Las dos herramientas que escriben en el libro lo que pasó ANTES de la ventana
 * (contabilizar los documentos existentes por mes, 097; contabilizar y reversar
 * la apertura, 100/101) quedan apagadas hasta que el contador dé el visto bueno.
 * Una variable de entorno de SERVIDOR las prende:
 *
 *     FINANZAS_POSTEO_HISTORICO_HABILITADO=true
 *
 * 🔴 Apagado por defecto: sin la variable (o con cualquier otro valor) está
 *    apagado. En producción se prende en Vercel sólo con el visto bueno de
 *    Josuarth (runbook §7 y §8).
 *
 * Apagado, las pantallas se ven y dejan bajar la plantilla, el Excel en seco y
 * el cuadre al corte; los botones que escriben quedan deshabilitados con
 * `MENSAJE_POSTEO_HISTORICO_APAGADO`, y las rutas responden 403 aunque alguien
 * las llame directo. 🔒 `posteo-historico.test.ts` exige el guard en cada ruta.
 */
export const VARIABLE_POSTEO_HISTORICO = "FINANZAS_POSTEO_HISTORICO_HABILITADO";

/** ¿Está prendido? Sólo con el valor exacto `true`. */
export function posteoHistoricoHabilitado(env: Record<string, string | undefined> = process.env): boolean {
  return (env[VARIABLE_POSTEO_HISTORICO] ?? "").trim().toLowerCase() === "true";
}

/** En una ruta: el 403 si está apagado, o null para seguir. */
export function rechazoSiPosteoHistoricoApagado(): NextResponse | null {
  if (posteoHistoricoHabilitado()) return null;
  return NextResponse.json({ error: MENSAJE_POSTEO_HISTORICO_APAGADO, interruptor: VARIABLE_POSTEO_HISTORICO }, { status: 403 });
}
