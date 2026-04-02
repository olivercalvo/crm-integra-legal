import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardRedirect() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const roleHome: Record<string, string> = {
    admin: "/admin",
    abogada: "/abogada",
    asistente: "/asistente",
  };

  redirect(roleHome[profile?.role || "abogada"] || "/abogada");
}
