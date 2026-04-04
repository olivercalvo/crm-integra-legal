import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET — list comments for a todo
export async function GET(
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

    const { data, error } = await admin
      .from("todo_comments")
      .select("id, text, created_at, user_id")
      .eq("todo_id", params.id)
      .eq("tenant_id", profile.tenant_id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// POST — add comment to a todo
export async function POST(
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

    const body = await request.json();
    if (!body.text?.trim()) {
      return NextResponse.json({ error: "Texto requerido" }, { status: 400 });
    }

    const { data, error } = await admin
      .from("todo_comments")
      .insert({
        tenant_id: profile.tenant_id,
        todo_id: params.id,
        text: body.text.trim(),
        user_id: user.id,
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
