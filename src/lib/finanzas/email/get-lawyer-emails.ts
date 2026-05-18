/**
 * Resuelve los emails de las abogadas activas del tenant para notificarles
 * acciones del portal público (Sprint 2E.4: aceptación + rechazo).
 *
 * Source of truth: `users WHERE role='abogada' AND active=true`. Si el día
 * de mañana se quiere notificar también a admins, se agrega el role acá.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

export interface LawyerRecipient {
  id: string;
  email: string;
  full_name: string | null;
}

/**
 * Devuelve la lista de abogadas activas del tenant. Filtra emails NULL o
 * vacíos. Si la consulta falla o no hay nadie, devuelve array vacío — el
 * caller decide si loggear o seguir (la notificación es best-effort).
 */
export async function getLawyerEmails(
  db: DB,
  tenantId: string
): Promise<LawyerRecipient[]> {
  const { data, error } = await db
    .from("users")
    .select("id, email, full_name")
    .eq("tenant_id", tenantId)
    .eq("role", "abogada")
    .eq("active", true);

  if (error) {
    console.error("[finanzas/email] getLawyerEmails failed", error);
    return [];
  }

  return (data ?? [])
    .filter(
      (u): u is { id: string; email: string; full_name: string | null } =>
        typeof u.email === "string" && u.email.trim().length > 0
    )
    .map((u) => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
    }));
}
