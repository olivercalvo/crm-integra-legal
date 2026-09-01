import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  ADMIN_ONLY_PREFIXES,
  ADMIN_ONLY_ROUTES,
  ASISTENTE_BLOCKED_PATTERNS,
  CONTADOR_FINANZAS_ALLOWED_PREFIXES,
  ROLE_HOME,
  ROLE_ROUTES,
  esRol,
} from "@/lib/auth/route-access";

// Las reglas de acceso por rol NO viven acá: están en
// `src/lib/auth/route-access.ts`, que es la fuente única que además consume
// `nav-guard.test.ts` para verificar que el sidebar no ofrezca rutas que este
// middleware rebota. Ver el encabezado de ese archivo para el porqué.
//
// Este archivo se queda con lo que solo puede pasar acá: leer la sesión,
// resolver el rol del JWT y ejecutar los redirects.

// Redirects 301 desde rutas pre-Fase 1A (vigentes ~4 semanas para preservar
// bookmarks y los emails diarios ya enviados con URLs antiguas).
const LEGACY_REDIRECTS: Array<{ pattern: RegExp; build: (m: RegExpMatchArray) => string }> = [
  // Mapeos antiguos del propio middleware histórico
  { pattern: /^\/abogada\/expedientes(\/.*)?$/, build: (m) => `/legal/casos${m[1] ?? ""}` },
  { pattern: /^\/abogada\/tareas(\/.*)?$/,      build: (m) => `/legal/seguimiento${m[1] ?? ""}` },

  // /abogada/* → /legal/*
  { pattern: /^\/abogada\/clientes(\/.*)?$/,    build: (m) => `/legal/clientes${m[1] ?? ""}` },
  { pattern: /^\/abogada\/casos(\/.*)?$/,       build: (m) => `/legal/casos${m[1] ?? ""}` },
  { pattern: /^\/abogada\/gastos(\/.*)?$/,      build: (m) => `/legal/gastos${m[1] ?? ""}` },
  { pattern: /^\/abogada\/seguimiento(\/.*)?$/, build: (m) => `/legal/seguimiento${m[1] ?? ""}` },
  { pattern: /^\/abogada\/pendientes(\/.*)?$/,  build: (m) => `/legal/pendientes${m[1] ?? ""}` },
  { pattern: /^\/abogada\/prospectos(\/.*)?$/,  build: (m) => `/legal/prospectos${m[1] ?? ""}` },
  { pattern: /^\/abogada\/importar(\/.*)?$/,    build: (m) => `/legal/importar${m[1] ?? ""}` },
  { pattern: /^\/abogada\/?$/,                  build: () => "/legal" },

  // /asistente/* → /legal/*  (tareas se unifica con pendientes)
  { pattern: /^\/asistente\/casos(\/.*)?$/,     build: (m) => `/legal/casos${m[1] ?? ""}` },
  { pattern: /^\/asistente\/gastos(\/.*)?$/,    build: (m) => `/legal/gastos${m[1] ?? ""}` },
  { pattern: /^\/asistente\/tareas(\/.*)?$/,    build: (m) => `/legal/pendientes${m[1] ?? ""}` },
  { pattern: /^\/asistente\/?$/,                build: () => "/legal" },

  // /admin/* → /legal/admin/*
  { pattern: /^\/admin\/usuarios(\/.*)?$/,      build: (m) => `/legal/admin/usuarios${m[1] ?? ""}` },
  { pattern: /^\/admin\/auditoria(\/.*)?$/,     build: () => "/legal/admin/auditoria" },
  { pattern: /^\/admin\/configuracion(\/.*)?$/, build: () => "/legal/admin/configuracion" },
  { pattern: /^\/admin\/?$/,                    build: () => "/legal/admin" },

  // /dashboard → /
  { pattern: /^\/dashboard\/?$/,                build: () => "/" },
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Legacy 301 redirects (pre-Fase 1A) — se evalúan ANTES del auth check para
  // que los bookmarks viejos lleguen al destino aunque la sesión esté caducada
  // (luego el destino aplica su propio gating).
  for (const rule of LEGACY_REDIRECTS) {
    const match = pathname.match(rule.pattern);
    if (match) {
      const url = request.nextUrl.clone();
      url.pathname = rule.build(match);
      return NextResponse.redirect(url, 301);
    }
  }

  // Aterrizaje del link de recuperación de contraseña. Va ANTES del bloque de
  // rutas públicas a propósito: ese bloque rebota al usuario CON sesión a "/",
  // y acá eso rompería el flujo — alguien con la sesión viva que pide recuperar
  // su contraseña nunca llegaría a canjear el código del email.
  if (pathname === "/auth/recuperar") {
    return response;
  }

  // Rutas públicas — sin requerir auth.
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    if (user) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Portal público de cotizaciones (Sprint 2E.3 hotfix): el cliente
  // accede vía link en el email con un token único en la URL. NO
  // requiere auth — la "auth" la da el token impredecible en el path.
  // Si el cliente está ya logueado al CRM (caso raro), igual lo
  // dejamos ver la página pública (NO lo redirigimos al dashboard).
  if (pathname.startsWith("/cotizacion/") || pathname === "/cotizacion") {
    return response;
  }

  // Cron — autenticado por header CRON_SECRET dentro del handler.
  if (pathname.startsWith("/api/cron/")) {
    return response;
  }

  // API pública — endpoints expuestos sin sesión. La autenticación es el
  // token único en el path (Sprint 2E.4 portal de cotizaciones: accept y
  // reject). Cada handler valida el token y la validez del recurso.
  if (pathname.startsWith("/api/public/")) {
    return response;
  }

  // API — auth chequeado dentro de cada handler.
  if (pathname.startsWith("/api/")) {
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    return response;
  }

  // Rutas protegidas — requieren auth.
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Timeout de sesión: 8 horas.
  const sessionCreated = user.last_sign_in_at;
  if (sessionCreated) {
    const sessionAge = Date.now() - new Date(sessionCreated).getTime();
    const EIGHT_HOURS = 8 * 60 * 60 * 1000;
    if (sessionAge > EIGHT_HOURS) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("expired", "true");
      return NextResponse.redirect(url);
    }
  }

  // Cambiar la PROPIA contraseña no depende del rol: cualquier usuario
  // autenticado entra. Va antes de resolver el rol a propósito — el gating por
  // prefijo de ROLE_ROUTES rebotaría esta ruta (no cuelga de /legal ni de
  // /finanzas, y "/" matchea exacto), y hasta un usuario sin rol en el JWT
  // tiene que poder arreglar su contraseña.
  if (pathname === "/nueva-contrasena") {
    return response;
  }

  // Rol del JWT.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userRole = (session?.user?.app_metadata?.user_role as string) ||
    (session?.access_token ? JSON.parse(atob(session.access_token.split(".")[1]))?.user_role : null);

  if (!userRole) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "no-role");
    return NextResponse.redirect(url);
  }

  // Un rol que este código no conoce no tiene permisos definidos, y eso no puede
  // resolverse por defecto: se trata como sesión inválida.
  if (!esRol(userRole)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "no-role");
    return NextResponse.redirect(url);
  }

  // Rutas admin-only sueltas (no cuelgan de un subárbol /admin). Se evalúan
  // primero porque su destino de rebote es distinto: el módulo al que pertenecen.
  if (ADMIN_ONLY_ROUTES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (userRole !== "admin") {
      const url = request.nextUrl.clone();
      url.pathname = "/finanzas/cotizaciones";
      url.searchParams.set("denied", "terms_template");
      return NextResponse.redirect(url);
    }
    return response;
  }

  // /legal/admin/* y /finanzas/admin/* son admin-only.
  const matchedAdminPrefix = ADMIN_ONLY_PREFIXES.find((p) => pathname.startsWith(p));
  if (matchedAdminPrefix) {
    if (userRole !== "admin") {
      const url = request.nextUrl.clone();
      // Si el rol tiene acceso al root del módulo (sin /admin), va ahí; sino
      // cae a su home primaria (ROLE_HOME).
      const moduleRoot = matchedAdminPrefix.replace("/admin", "");
      const allowedPrefixes = ROLE_ROUTES[userRole] ?? [];
      url.pathname = allowedPrefixes.includes(moduleRoot)
        ? moduleRoot
        : ROLE_HOME[userRole] ?? "/";
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Gating extra para el contador dentro de /finanzas: solo /finanzas/reportes/*.
  // /finanzas raíz pasa para que page.tsx haga el redirect dinámico.
  if (
    userRole === "contador" &&
    pathname.startsWith("/finanzas/") &&
    !CONTADOR_FINANZAS_ALLOWED_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(p + "/")
    )
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/finanzas/reportes";
    return NextResponse.redirect(url);
  }

  // Gating extra para el asistente dentro de /legal: el directorio de clientes y
  // las pantallas de alta/edición quedan fuera; la ficha por id sí pasa.
  if (
    userRole === "asistente" &&
    ASISTENTE_BLOCKED_PATTERNS.some((p) => p.test(pathname))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = ROLE_HOME[userRole] ?? "/legal";
    return NextResponse.redirect(url);
  }

  // Gating por rol: el path debe matchear alguno de los prefijos permitidos.
  const allowedPrefixes = ROLE_ROUTES[userRole] ?? [];
  const hasAccess = allowedPrefixes.some((prefix) =>
    prefix === "/"
      ? pathname === "/"
      : pathname === prefix || pathname.startsWith(prefix + "/")
  );

  if (!hasAccess) {
    const url = request.nextUrl.clone();
    url.pathname = ROLE_HOME[userRole] ?? "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
