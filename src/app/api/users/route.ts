import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/types/database";

const VALID_ROLES: UserRole[] = ["admin", "abogada", "asistente"];

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();

    // Authenticate
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Get user's tenant_id
    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil de usuario no encontrado" }, { status: 403 });
    }

    // Optional role filter via query param e.g. ?role=asistente
    const { searchParams } = new URL(request.url);
    const roleFilter = searchParams.get("role") as UserRole | null;

    let query = admin
      .from("users")
      .select("id, full_name, email, role, active")
      .eq("tenant_id", profile.tenant_id)
      .eq("active", true)
      .order("full_name", { ascending: true });

    if (roleFilter && VALID_ROLES.includes(roleFilter)) {
      query = query.eq("role", roleFilter);
    }

    const { data: users, error: fetchError } = await query;

    if (fetchError) {
      console.error("Error fetching users:", fetchError);
      return NextResponse.json({ error: "Error al obtener usuarios" }, { status: 500 });
    }

    return NextResponse.json(users ?? [], { status: 200 });
  } catch (err) {
    console.error("Unexpected error in GET /api/users:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
