import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UserForm } from "@/components/admin/user-form";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default async function NuevoUsuarioPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/admin/usuarios"
          className="flex items-center gap-1 hover:text-integra-navy transition-colors"
        >
          <ArrowLeft size={14} />
          Usuarios
        </Link>
        <span>/</span>
        <span className="text-integra-navy font-medium">Nuevo Usuario</span>
      </div>

      {/* Page header */}
      <div>
        <h2 className="font-serif text-2xl font-bold text-integra-navy">
          Crear Nuevo Usuario
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Se creará una cuenta de acceso y un perfil en el sistema.
        </p>
      </div>

      <UserForm />
    </div>
  );
}
