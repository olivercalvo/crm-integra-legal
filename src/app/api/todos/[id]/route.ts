import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// PATCH — update todo (mark complete, edit description/deadline)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin.from("users").select("tenant_id").eq("id", user.id).single();
    if (!profile) return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });

    // Verify ownership
    const { data: todo } = await admin
      .from("personal_todos")
      .select("id, user_id")
      .eq("id", params.id)
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", user.id)
      .single();

    if (!todo) {
      return NextResponse.json({ error: "Pendiente no encontrado" }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.description !== undefined) updates.description = body.description;
    if (body.deadline !== undefined) updates.deadline = body.deadline || null;
    if (body.status === "cumplida") {
      updates.status = "cumplida";
      updates.completed_at = new Date().toISOString();
    }
    if (body.status === "pendiente") {
      updates.status = "pendiente";
      updates.completed_at = null;
    }

    const { data, error } = await admin
      .from("personal_todos")
      .update(updates)
      .eq("id", params.id)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// DELETE — remove a todo
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin.from("users").select("tenant_id").eq("id", user.id).single();
    if (!profile) return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });

    const { error } = await admin
      .from("personal_todos")
      .delete()
      .eq("id", params.id)
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
