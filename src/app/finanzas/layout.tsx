import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HomeHeader } from "@/components/home/home-header";

/**
 * Layout placeholder de Finanzas. Auth + header simple sin sidebar (el módulo
 * todavía no existe — se construye en Fase 1B). Cuando el módulo tenga
 * navegación propia, se reemplazará por un FinanzasShell con sidebar.
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
    <div className="min-h-screen bg-gray-50">
      <HomeHeader userName={userName} userRole={userRole} />
      <main className="px-4 py-8 lg:py-12">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
