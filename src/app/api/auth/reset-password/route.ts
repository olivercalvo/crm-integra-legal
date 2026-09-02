/**
 * POST /api/auth/reset-password — pide el correo de recuperación de contraseña.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO VIVE EN EL SERVIDOR Y NO EN EL BROWSER
 * ─────────────────────────────────────────────────────────────────────────────
 * Antes el login llamaba `resetPasswordForEmail` con el BROWSER client, que usa
 * flujo PKCE. En PKCE, supabase-js genera un `code_verifier` local y le manda a
 * GoTrue un `code_challenge`; el token que queda guardado —y que la plantilla
 * de email renderiza— sale con prefijo **`pkce_`**. Ese token solo se puede
 * canjear desde el MISMO navegador que pidió el reset, porque el verifier vive
 * ahí. Si la licenciada pide el reset en la computadora y abre el correo en el
 * celular, el canje falla y termina en el login sin poder cambiar nada.
 *
 * Verificado el 15/08/2026: el link real del correo traía
 * `token=pkce_8fc1f1ea…`, mientras que un token generado del lado servidor sale
 * plano (`b058b1cf…`). El prefijo lo determina QUIÉN PIDE el reset, no la
 * plantilla — por eso cambiar solo la plantilla no habría alcanzado.
 *
 * Acá se pide con `flowType: "implicit"`, sin PKCE: el token del correo sale
 * plano y `/auth/recuperar` lo verifica con `verifyOtp`, que no necesita
 * verifier ni continuidad de navegador. Funciona cross-device.
 *
 * BONUS: al pasar por un endpoint propio, este es el punto único donde después
 * se cuelga el rate limiting (Seguridad Fase 0, punto A) y el registro de
 * intentos. Con la llamada directa del browser a Supabase no había dónde.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const email = String((body as { email?: unknown })?.email ?? "").trim();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: "Ingrese un correo válido" },
      { status: 400 }
    );
  }

  // Cliente SIN PKCE y sin sesión: solo dispara el correo. El token que se
  // guarde tiene que ser plano para que verifyOtp lo pueda verificar desde
  // cualquier dispositivo.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false } }
  );

  const origin = new URL(request.url).origin;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/recuperar`,
  });

  if (error) {
    // Se loguea del lado servidor pero NO se le devuelve el detalle al cliente:
    // un error distinto según si el correo existe o no sirve para enumerar
    // usuarios. La respuesta es siempre la misma.
    console.warn("[auth/reset-password] resetPasswordForEmail falló", {
      message: error.message,
      status: error.status,
    });
  }

  // Respuesta uniforme exista o no el usuario.
  return NextResponse.json({ ok: true });
}
