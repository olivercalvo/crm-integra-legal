import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DashboardShell } from "@/components/layout/dashboard-shell";

/**
 * Layout del módulo Finanzas. Reusamos DashboardShell para que las abogadas
 * sientan que es el mismo CRM (sidebar + header consistentes con /legal).
 *
 * El gating de roles a /finanzas (asistentes redirigidos) lo hace el
 * middleware — acá solo aseguramos auth + cargamos perfil para el shell.
 */
export default async function FinanzasLayout({
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

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  const userName = profile?.full_name || user.email || "Usuario";
  const userRole = (profile?.role as string) || "abogada";

  return (
    <DashboardShell userName={userName} userRole={userRole}>
      {children}
    </DashboardShell>
  );
}
