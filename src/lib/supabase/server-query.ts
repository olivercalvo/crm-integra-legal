import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

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
