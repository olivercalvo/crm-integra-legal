/**
 * DESACTIVAR A UN USUARIO LE QUITA EL ACCESO (05/10/2026).
 *
 * Hasta ese día «Desactivar» en Admin > Usuarios sólo ponía
 * `public.users.active = false`. Ni el login ni el middleware miran esa
 * columna: el middleware autoriza con `app_metadata.user_role` del JWT. Medido
 * en staging: un contador desactivado volvía a entrar con su contraseña y
 * `/finanzas/reportes` le respondía 200. Lo encontró el ensayo del paso
 * «Accesos» de la ventana (desactivar contador.test@integra-panama.com).
 *
 * La regla: el usuario inactivo queda BLOQUEADO en Supabase Auth (`ban_duration`),
 * que rechaza el login y la renovación de la sesión. Reactivar lo desbloquea.
 * El bloqueo va ANTES de tocar `public.users`: si Auth falla, la pantalla no
 * dice «inactivo» sobre alguien que todavía puede entrar.
 *
 * ⚠️ Una sesión ya abierta dura hasta que vence su token de acceso (1 h por
 * defecto en Supabase): el bloqueo corta la renovación, no el token vigente.
 */

/** ~100 años: GoTrue no tiene «para siempre»; se levanta con "none". */
export const BLOQUEO_DE_USUARIO_INACTIVO = "876000h";

/** El `ban_duration` que corresponde a un usuario activo o inactivo. */
export function banDurationPara(activo: boolean): string {
  return activo ? "none" : BLOQUEO_DE_USUARIO_INACTIVO;
}

type AuthAdmin = {
  auth: {
    admin: {
      updateUserById: (
        id: string,
        attrs: { ban_duration: string }
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

/**
 * Bloquea (inactivo) o desbloquea (activo) al usuario en Supabase Auth.
 * Devuelve el mensaje de error, o null si quedó como se pidió.
 */
export async function sincronizarAccesoEnAuth(
  admin: AuthAdmin,
  userId: string,
  activo: boolean
): Promise<string | null> {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: banDurationPara(activo),
  });
  return error ? error.message : null;
}
