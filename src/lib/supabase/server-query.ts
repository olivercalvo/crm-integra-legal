import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Role gate for API route handlers. Returns a standardized 403 `NextResponse`
 * (`{ error: "Sin permiso" }`, status 403) when `role` is NOT in `allowed`, or
 * `null` when the role is allowed.
 *
 * Reusable by handlers on either auth pattern:
 *   - `getAuthenticatedContext` (finanzas):
 *       const denied = requireRole(ctx.userRole, ["admin", "abogada"]);
 *       if (denied) return denied;
 *   - inline legal pattern (createClient + getUser + select role):
 *       const denied = requireRole(profile.role, ["admin", "abogada"]);
 *       if (denied) return denied;
 *
 * Lowest-risk shape by design: it is purely additive — it never alters the
 * allowed-role flow, it only short-circuits denied roles with a 403. A missing
 * / unknown role (null/undefined) is treated as denied (fail closed).
 */
export function requireRole(
  role: string | null | undefined,
  allowed: readonly string[]
): NextResponse | null {
  if (!role || !allowed.includes(role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  return null;
}

/**
 * IDOR guard for API route handlers. Verifies that a referenced row (`id`)
 * exists AND belongs to the caller's tenant, BEFORE the handler writes anything
 * that links to it. Returns a 404 `NextResponse` when the row is missing or
 * belongs to another tenant, or `null` when ownership checks out.
 *
 * Uses the admin client with an explicit `tenant_id` filter (same convention as
 * the rest of the server code, which bypasses RLS). Mirrors the correct inline
 * pattern already used in cases/[id]/comments/route.ts.
 *
 *   const idor = await requireEntityInTenant(admin, "cases", caseId, tenantId, "Caso no encontrado");
 *   if (idor) return idor;
 */
export async function requireEntityInTenant(
  db: SupabaseClient,
  table: string,
  id: string,
  tenantId: string,
  notFoundMessage = "Recurso no encontrado"
): Promise<NextResponse | null> {
  const { data } = await db
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ error: notFoundMessage }, { status: 404 });
  }
  return null;
}

/**
 * Returns an authenticated context (user info + tenant) and an admin
 * Supabase client that bypasses RLS for server-side data queries.
 *
 * This works around a known issue where the RLS helper functions
 * (auth.tenant_id / auth.user_role) read JWT claims at the wrong
 * nesting level. Once the DB functions are patched the regular
 * `createClient()` will honour RLS correctly, but server components
 * can safely use the admin client with explicit tenant_id filtering.
 */
export async function getAuthenticatedContext() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("users")
    .select("full_name, role, tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/login");
  }

  return {
    user,
    profile,
    userId: user.id,
    tenantId: profile.tenant_id as string,
    userRole: profile.role as string,
    userName: profile.full_name as string,
    /** Admin client — use for data queries, always filter by tenantId */
    db: admin,
  };
}
