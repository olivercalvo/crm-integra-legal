import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { case_id, text } = body;

    if (!case_id || !text?.trim()) {
      return NextResponse.json({ error: "Faltan campos requeridos: case_id, text" }, { status: 400 });
    }

    const { data: comment, error: insertError } = await supabase
      .from("comments")
      .insert({
        tenant_id: profile.tenant_id,
        case_id,
        text: text.trim(),
        user_id: user.id,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting comment:", insertError);
      return NextResponse.json({ error: "Error al agregar el comentario" }, { status: 500 });
    }

    return NextResponse.json(comment, { status: 201 });
  } catch (err) {
    console.error("Unexpected error in POST /api/comments:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
