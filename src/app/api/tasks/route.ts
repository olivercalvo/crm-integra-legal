import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { case_id, description, deadline, assigned_to } = body;

    if (!case_id || !description?.trim()) {
      return NextResponse.json({ error: "Faltan campos requeridos: case_id, description" }, { status: 400 });
    }

    const { data: task, error: insertError } = await admin
      .from("tasks")
      .insert({
        tenant_id: profile.tenant_id,
        case_id,
        description: description.trim(),
        deadline: deadline ?? null,
        assigned_to: assigned_to ?? null,
        status: "pendiente",
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting task:", insertError);
      return NextResponse.json({ error: "Error al crear la tarea" }, { status: 500 });
    }

    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    console.error("Unexpected error in POST /api/tasks:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
