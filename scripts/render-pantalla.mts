/**
 * RENDERIZA UNA PANTALLA DEL CRM Y DEVUELVE SU TEXTO VISIBLE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * PARA QUÉ
 * ═════════════════════════════════════════════════════════════════════════════
 * Para verificar lo que el usuario VE, no lo que el código dice.
 *
 * El 02/09/2026 se metieron tres errores en una sola pantalla —un texto que
 * anticipaba código inexistente, una frase vieja contradiciendo a la nueva, y un
 * bloque que se dibujaba con todo en cero— y los tres pasaron el `grep`. Los
 * encontró Oliver mirando la pantalla. Un `grep` prueba que una cadena está en
 * un archivo; no prueba qué se renderiza, ni bajo qué condición, ni si hay dos
 * párrafos que se contradicen.
 *
 * Este script existe porque la extensión de Chrome se cae seguido y sin ella no
 * había forma de mirar. Se autentica contra Supabase por HTTP, arma la cookie
 * que espera `@supabase/ssr` y trae el HTML servido por el dev server.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 NINGUNA CREDENCIAL VIVE EN ESTE ARCHIVO
 * ═════════════════════════════════════════════════════════════════════════════
 * Usuario y contraseña salen de `.env.local`, que está en `.gitignore`. Ni
 * siquiera las de staging se commitean: una credencial en el repo es una
 * credencial filtrada, sin importar a qué ambiente apunte.
 *
 * En `.env.local`:
 *   STAGING_UI_EMAIL=...
 *   STAGING_UI_PASSWORD=...
 *
 * Y como todo lo que toca la base, tiene candado anti-producción.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USO
 * ─────────────────────────────────────────────────────────────────────────────
 *   # contra el dev server local
 *   npm run dev                    (en otra terminal)
 *   npx tsx scripts/render-pantalla.mts /finanzas/reportes/aging?tipo=cobrar
 *   npx tsx scripts/render-pantalla.mts /finanzas/reportes/balance --html
 *
 *   # contra un deploy de Vercel (necesita el bypass de Deployment Protection)
 *   RENDER_BASE_URL=https://...vercel.app npx tsx scripts/render-pantalla.mts /finanzas/reportes
 *
 *   --html   imprime el HTML crudo en vez del texto visible
 */

import { readFileSync } from "node:fs";

const PROD_REF = "uqmmkklbhzxqybljiecs";
const STAGING_REF = "xtyenhakplrkyifbcaow";
const BASE = process.env.RENDER_BASE_URL ?? "http://localhost:3000";

function leerEnvLocal(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
    );
  } catch {
    console.error("\n🛑 No se pudo leer .env.local desde la raíz del repo.");
    console.error("   Corré el script parado en la raíz: npx tsx scripts/render-pantalla.mts <ruta>\n");
    process.exit(1);
  }
}

const env = leerEnvLocal();

/** Falta un dato: se dice CUÁL y dónde ponerlo, no un error genérico. */
function requerido(clave: string, comoConseguirlo: string): string {
  const v = process.env[clave] ?? env[clave];
  if (!v || v.trim() === "") {
    console.error(`\n🛑 Falta ${clave}.`);
    console.error(`   ${comoConseguirlo}`);
    console.error(`   Agregalo a .env.local (que está en .gitignore) o exportalo en el shell.\n`);
    process.exit(1);
  }
  return v.trim();
}

const URL_SB = requerido(
  "NEXT_PUBLIC_SUPABASE_URL",
  "Es la URL del proyecto Supabase de staging."
);
const ANON = requerido(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "Es la anon key del proyecto Supabase de staging."
);
const EMAIL = requerido(
  "STAGING_UI_EMAIL",
  "Correo del usuario de staging con el que renderizar (ej. el del rol contador)."
);
const PASSWORD = requerido(
  "STAGING_UI_PASSWORD",
  "Contraseña de ese usuario de staging. NUNCA la de un usuario de producción."
);

// ---- CANDADO: nunca contra producción -------------------------------------
if (URL_SB.includes(PROD_REF)) {
  console.error("\n🛑 ABORTADO: NEXT_PUBLIC_SUPABASE_URL apunta a PRODUCCIÓN.\n");
  process.exit(1);
}
if (!URL_SB.includes(STAGING_REF)) {
  console.error(`\n🛑 ABORTADO: URL inesperada (${URL_SB}). Solo staging.\n`);
  process.exit(1);
}

const ruta = process.argv[2] ?? "/finanzas/reportes";
const comoHtml = process.argv.includes("--html");

// ---------------------------------------------------------------------------
// 1) Sesión
// ---------------------------------------------------------------------------
const auth = await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});

if (!auth.ok) {
  console.error(`\n🛑 No se pudo autenticar como ${EMAIL} (${auth.status}).`);
  console.error(`   ${(await auth.text()).slice(0, 200)}\n`);
  process.exit(1);
}
const sesion = await auth.json();

// ---------------------------------------------------------------------------
// 2) La cookie que espera @supabase/ssr
// ---------------------------------------------------------------------------
// Formato: `base64-<base64 del JSON de la sesión>`, partido en trozos si es
// largo. Si un día la librería cambia el formato, esto deja de autenticar y el
// script devuelve un 307 al login — que es un fallo ruidoso, no silencioso.
const ref = URL_SB.match(/https:\/\/([^.]+)\./)?.[1] ?? STAGING_REF;
const valor = "base64-" + Buffer.from(JSON.stringify(sesion)).toString("base64");
const TROZO = 3180;

const cookies: string[] = [];
if (valor.length <= TROZO) {
  cookies.push(`sb-${ref}-auth-token=${valor}`);
} else {
  for (let i = 0, n = 0; i < valor.length; i += TROZO, n += 1) {
    cookies.push(`sb-${ref}-auth-token.${n}=${valor.slice(i, i + TROZO)}`);
  }
}

// ---------------------------------------------------------------------------
// 3) La pantalla
// ---------------------------------------------------------------------------
// Los deploys de preview de Vercel están detrás de Deployment Protection (SSO),
// que redirige a vercel.com/sso-api antes de llegar a la app. El bypass para
// automatización se pasa por header; el secreto sale de
// VERCEL_AUTOMATION_BYPASS_SECRET (Vercel → Settings → Deployment Protection →
// Protection Bypass for Automation). Contra localhost no hace falta.
const cabeceras: Record<string, string> = { cookie: cookies.join("; ") };
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (bypass) cabeceras["x-vercel-protection-bypass"] = bypass;

let res: Response;
try {
  res = await fetch(`${BASE}${ruta}`, {
    headers: cabeceras,
    redirect: "manual",
  });
} catch {
  console.error(`\n🛑 No se pudo conectar a ${BASE}. ¿Está corriendo \`npm run dev\`?\n`);
  process.exit(1);
}

console.log(`GET ${ruta} → ${res.status}\n`);

if (res.status >= 300 && res.status < 400) {
  console.error(`🛑 Redirigió a ${res.headers.get("location")}.`);
  console.error(`   Puede ser que ${EMAIL} no tenga permiso sobre esa ruta, o que la sesión no se`);
  console.error(`   haya aceptado (si @supabase/ssr cambió el formato de la cookie).\n`);
  process.exit(1);
}

const html = await res.text();

if (comoHtml) {
  console.log(html);
} else {
  console.log(
    html
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&ldquo;|&rdquo;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n")
  );
}
