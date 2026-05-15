import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Prefijos que cada rol puede acceder.
//   "/"          — selector de módulos, abierto a todo rol autenticado.
//   "/legal/*"   — módulo Legal: abogada, asistente y admin (NO contador).
//   "/finanzas/*" — módulo Finanzas: abogada, admin y contador (NO asistente).
// Los subárboles /legal/admin/* y /finanzas/admin/* son admin-only y se gatean
// aparte (ADMIN_ONLY_PREFIXES). El contador queda confinado a un sub-subset
// de /finanzas via CONTADOR_FINANZAS_ALLOWED_PREFIXES (ver más abajo).
const ROLE_ROUTES: Record<string, string[]> = {
  admin:     ["/", "/legal", "/finanzas"],
  abogada:   ["/", "/legal", "/finanzas"],
  asistente: ["/", "/legal"],
  contador:  ["/", "/finanzas"],
};

const ADMIN_ONLY_PREFIXES = ["/legal/admin", "/finanzas/admin"];

// El contador es un rol especializado en cierre contable.
// Dentro de /finanzas puede ver /finanzas/reportes/* (hub + sub-páginas) y
// /finanzas/gastos-bufete/* (carga de compras del bufete con ITBMS recuperable;
// Sprint 2F Parte 3a). El root /finanzas se permite porque tiene un redirect
// interno por rol (page.tsx lo manda a /finanzas/reportes cuando rol=contador).
const CONTADOR_FINANZAS_ALLOWED_PREFIXES = [
  "/finanzas/reportes",
  "/finanzas/gastos-bufete",
];

// Home primaria por rol — destino fallback cuando el rol no tiene acceso a la
// ruta solicitada. Admin/abogada caen al selector general; asistente cae a
// Legal; contador cae directo al hub de reportes (su única vista útil).
const ROLE_HOME: Record<string, string> = {
  admin:     "/",
  abogada:   "/",
  asistente: "/legal",
  contador:  "/finanzas/reportes",
};

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
