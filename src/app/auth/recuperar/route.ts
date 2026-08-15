/**
 * GET /auth/recuperar — aterrizaje del link de "¿Olvidaste tu contraseña?".
 *
 * Canjea el `code` del email por una sesión y manda a /nueva-contrasena, que es
 * donde la persona ESCRIBE la contraseña nueva.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES UNA RUTA PROPIA Y NO /api/auth/callback
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. URL limpia, sin query string. Supabase matchea el `redirectTo` contra la
 *    allowlist de Redirect URLs con globs donde `/` es separador, así que un
 *    `?next=/algo` obligaría a registrar un patrón con comodines. Con una ruta
 *    dedicada la entrada de la allowlist es exacta, que es lo que Supabase
 *    recomienda para producción.
 * 2. /api/auth/* está en la rama del middleware que REBOTA al usuario logueado
 *    a "/" — un usuario con sesión viva que pide recuperar su contraseña nunca
 *    llegaría a canjear el código. Esta ruta se exceptúa explícitamente.
 *
 * El duplicado del boilerplate de cookies respecto de /api/auth/callback es
 * deliberado: esa ruta atiende el resto de los flujos de auth y no se toca.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Supabase manda ?error=...&error_description=... cuando el link venció o ya
  // se usó. Sin esto el usuario vería "link inválido" sin saber por qué.
  const errorCode = searchParams.get("error") ?? searchParams.get("error_code");
  if (errorCode) {
    return NextResponse.redirect(`${origin}/login?error=recovery_expired`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=recovery`);
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.delete({ name, ...options });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.warn("[auth/recuperar] exchangeCodeForSession falló", error.message);
    return NextResponse.redirect(`${origin}/login?error=recovery`);
  }

  return NextResponse.redirect(`${origin}/nueva-contrasena`);
}
