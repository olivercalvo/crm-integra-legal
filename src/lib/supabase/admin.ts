import { createClient } from "@supabase/supabase-js";

/**
 * Cliente de SERVICIO (salta RLS). Sólo en el servidor.
 *
 * `actorId` es el usuario que hace el cambio. Viaja en el header `x-actor-id`, y
 * la base lo usa para saber quién escribe en las bitácoras de auditoría (migraciones
 * 086 y 087): con la clave de servicio `auth.uid()` es NULL, así que sin el header
 * cada cambio quedaría como «sistema».
 *
 * `null` es sólo para lo que no tiene un usuario detrás: el cron, el portal público
 * de cotizaciones. 🔒 `bitacora-actor.test.ts` falla si una ruta que escribe pasa
 * `null` o no pasa nada.
 *
 * La base sólo cree el header cuando la llamada viene con la clave de servicio,
 * que nunca sale del servidor.
 */
export function createAdminClient(actorId: string | null) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      ...(actorId ? { global: { headers: { "x-actor-id": actorId } } } : {}),
    }
  );
}
