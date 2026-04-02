import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get user profile from public.users table
  const { data: profile } = await supabase
    .from("users")
    .select("full_name, role, tenant_id")
    .eq("id", user.id)
    .single();

  const userName = profile?.full_name || user.email || "Usuario";
  const userRole = profile?.role || "abogada";

  return (
    <DashboardShell userName={userName} userRole={userRole}>
      {children}
    </DashboardShell>
  );
}
