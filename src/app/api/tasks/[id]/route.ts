import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();

    // Authenticate
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Get user's tenant_id
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil de usuario no encontrado" }, { status: 403 });
    }

    const taskId = params.id;
    if (!taskId) {
      return NextResponse.json({ error: "ID de tarea requerido" }, { status: 400 });
    }

    // Verify the task belongs to this tenant
    const { data: existingTask, error: fetchError } = await supabase
      .from("tasks")
      .select("id, status, tenant_id")
      .eq("id", taskId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (fetchError || !existingTask) {
      return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
    }

    const body = await request.json();
    const { status } = body;

    // Only allow transitioning to "cumplida"
    if (status !== "cumplida") {
      return NextResponse.json({ error: "Solo se permite marcar como cumplida" }, { status: 400 });
    }

    if (existingTask.status === "cumplida") {
      return NextResponse.json({ error: "La tarea ya está marcada como cumplida" }, { status: 400 });
    }

    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update({
        status: "cumplida",
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating task:", updateError);
      return NextResponse.json({ error: "Error al actualizar la tarea" }, { status: 500 });
    }

    return NextResponse.json(updatedTask, { status: 200 });
  } catch (err) {
    console.error("Unexpected error in PATCH /api/tasks/[id]:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
