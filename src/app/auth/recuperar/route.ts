/**
 * GET /auth/recuperar — aterrizaje del link de "¿Olvidaste tu contraseña?".
 *
 * Verifica el token del email, deja la sesión de recuperación en cookies y
 * manda a /nueva-contrasena, que es donde la persona ESCRIBE la contraseña.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS FORMATOS DE LINK — el bueno y el heredado
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. `?token_hash=<hash>&type=recovery` → **el camino bueno**. Se verifica con
 *    `verifyOtp`, que NO necesita `code_verifier` ni continuidad de navegador:
 *    la licenciada puede pedir el reset en la computadora y abrir el correo en
 *    el celular. Requiere que la plantilla de email use `{{ .TokenHash }}` y que
 *    el reset se pida SIN PKCE (ver /api/auth/reset-password).
 *
 * 2. `?code=<code>` → **heredado**. Es lo que produce el flujo PKCE: GoTrue
 *    valida el token `pkce_…` y redirige acá con un `code` que solo se puede
 *    canjear con el `code_verifier` guardado por el navegador que PIDIÓ el
 *    reset. Se mantiene por los correos ya enviados y porque en el mismo
 *    navegador funciona; si el verifier no está, falla y lo decimos.
 *
 * Cuando ya no queden correos viejos circulando (el token de recuperación
 * caduca; por defecto 24 h) la rama del `code` se puede borrar.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  // Supabase manda ?error=...&error_description=... cuando el link venció o ya
  // se usó. Sin esto el usuario vería "link inválido" sin saber por qué.
  const errorCode = searchParams.get("error") ?? searchParams.get("error_code");
  if (errorCode) {
    return NextResponse.redirect(`${origin}/login?error=recovery_expired`);
  }

  if (!tokenHash && !code) {
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

  // Camino bueno: token_hash + verifyOtp (sirve en cualquier dispositivo).
  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      type: type ?? "recovery",
      token_hash: tokenHash,
    });
    if (error) {
      console.warn("[auth/recuperar] verifyOtp falló", {
        message: error.message,
        // El prefijo delata un token PKCE llegando por la ruta equivocada: la
        // plantilla de email quedó con {{ .TokenHash }} pero el reset se pidió
        // con un cliente PKCE. Sin este dato el diagnóstico es a ciegas.
        pkce_prefijado: tokenHash.startsWith("pkce_"),
      });
      return NextResponse.redirect(`${origin}/login?error=recovery_expired`);
    }
    return NextResponse.redirect(`${origin}/nueva-contrasena`);
  }

  // Camino heredado: PKCE. Solo funciona en el navegador que pidió el reset.
  const { error } = await supabase.auth.exchangeCodeForSession(code!);
  if (error) {
    console.warn("[auth/recuperar] exchangeCodeForSession falló", error.message);
    return NextResponse.redirect(`${origin}/login?error=recovery_otro_navegador`);
  }

  return NextResponse.redirect(`${origin}/nueva-contrasena`);
}
