import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET — list user's personal todos
export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin.from("users").select("tenant_id").eq("id", user.id).single();
    if (!profile) return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });

    // Fetch todos created by user OR assigned to user
    const { data: owned, error: err1 } = await admin
      .from("personal_todos")
      .select("*, creator:users!personal_todos_user_id_fkey(full_name), assignee:users!personal_todos_assigned_to_fkey(full_name)")
      .eq("tenant_id", profile.tenant_id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    const { data: assigned, error: err2 } = await admin
      .from("personal_todos")
      .select("*, creator:users!personal_todos_user_id_fkey(full_name), assignee:users!personal_todos_assigned_to_fkey(full_name)")
      .eq("tenant_id", profile.tenant_id)
      .eq("assigned_to", user.id)
      .neq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (err1 || err2) {
      return NextResponse.json({ error: (err1 || err2)!.message }, { status: 500 });
    }

    // Merge and dedupe
    const allTodos = [...(owned ?? []), ...(assigned ?? [])];
    return NextResponse.json(allTodos);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// POST — create a new personal todo
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin.from("users").select("tenant_id").eq("id", user.id).single();
    if (!profile) return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });

    const body = await request.json();
    const { description, deadline, assigned_to } = body;

    if (!description?.trim()) {
      return NextResponse.json({ error: "Descripción requerida" }, { status: 400 });
    }

    const { data, error } = await admin
      .from("personal_todos")
      .insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        description: description.trim(),
        deadline: deadline || null,
        assigned_to: assigned_to || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
