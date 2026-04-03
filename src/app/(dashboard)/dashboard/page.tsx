import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";

export default async function DashboardRedirect() {
  const { userRole } = await getAuthenticatedContext();

  const roleHome: Record<string, string> = {
    admin: "/admin",
    abogada: "/abogada",
    asistente: "/asistente",
  };

  redirect(roleHome[userRole] || "/abogada");
}
