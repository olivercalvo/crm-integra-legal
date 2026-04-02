import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes accessible by each role
const ROLE_ROUTES: Record<string, string[]> = {
  admin: ["/dashboard", "/admin", "/abogada", "/asistente"],
  abogada: ["/dashboard", "/abogada"],
  asistente: ["/dashboard", "/asistente"],
};

// Default redirect per role after login
const ROLE_HOME: Record<string, string> = {
  admin: "/admin",
  abogada: "/abogada",
  asistente: "/asistente",
};

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

  // Public routes — no auth required
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    if (user) {
      // Already logged in, redirect to dashboard
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Protected routes — require auth
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Check session age (8 hours timeout)
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

  // Get user role from JWT claims
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userRole = (session?.user?.app_metadata?.user_role as string) ||
    (session?.access_token ? JSON.parse(atob(session.access_token.split(".")[1]))?.user_role : null);

  if (!userRole) {
    // No role assigned — redirect to login
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "no-role");
    return NextResponse.redirect(url);
  }

  // /dashboard redirects to role-specific home
  if (pathname === "/dashboard") {
    const url = request.nextUrl.clone();
    url.pathname = ROLE_HOME[userRole] || "/login";
    return NextResponse.redirect(url);
  }

  // Role-based route protection
  const allowedRoutes = ROLE_ROUTES[userRole] || [];
  const hasAccess = allowedRoutes.some((route) => pathname.startsWith(route));

  if (!hasAccess) {
    const url = request.nextUrl.clone();
    url.pathname = ROLE_HOME[userRole] || "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
