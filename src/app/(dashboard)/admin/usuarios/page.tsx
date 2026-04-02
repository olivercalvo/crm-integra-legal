import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { UserTable } from "@/components/admin/user-table";
import { UserPlus, Users } from "lucide-react";
import type { UserRole } from "@/types/database";

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}

export default async function UsuariosPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  // Fetch all users (active + inactive) for this tenant
  const { data: users, error } = await supabase
    .from("users")
    .select("id, full_name, email, role, active, created_at")
    .eq("tenant_id", profile.tenant_id)
    .order("full_name", { ascending: true });

  const userList: UserRow[] = (users ?? []) as UserRow[];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-serif text-2xl font-bold text-integra-navy">
            Gestión de Usuarios
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Administra los usuarios del sistema, sus roles y accesos.
          </p>
        </div>
        <Button
          asChild
          className="min-h-[48px] bg-integra-navy text-white hover:bg-integra-navy/90 sm:w-auto w-full"
        >
          <Link href="/admin/usuarios/nuevo">
            <UserPlus size={18} />
            Crear Usuario
          </Link>
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-2xl font-bold text-integra-navy">
            {userList.filter((u) => u.active).length}
          </p>
          <p className="text-xs text-gray-500">Usuarios activos</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-2xl font-bold text-integra-navy">
            {userList.filter((u) => u.role === "abogada" && u.active).length}
          </p>
          <p className="text-xs text-gray-500">Abogadas</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-2xl font-bold text-integra-navy">
            {userList.filter((u) => u.role === "asistente" && u.active).length}
          </p>
          <p className="text-xs text-gray-500">Asistentes</p>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Error al cargar usuarios: {error.message}
        </div>
      )}

      {/* Empty state */}
      {!error && userList.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Users size={40} className="mb-3 text-gray-300" />
          <p className="font-medium text-gray-500">No hay usuarios aún</p>
          <p className="mt-1 text-sm text-gray-400">
            Crea el primer usuario con el botón de arriba.
          </p>
        </div>
      )}

      {/* Users table */}
      {userList.length > 0 && (
        <UserTable users={userList} currentUserId={user.id} />
      )}
    </div>
  );
}
