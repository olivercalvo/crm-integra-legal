import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const caseId = params.id;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const body = await request.json();
    const { text } = body;

    if (!text || !text.trim()) {
      return NextResponse.json({ error: "El comentario no puede estar vacío" }, { status: 400 });
    }

    // Verify the case belongs to this tenant
    const { data: caseRow } = await supabase
      .from("cases")
      .select("id")
      .eq("id", caseId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!caseRow) {
      return NextResponse.json({ error: "Expediente no encontrado" }, { status: 404 });
    }

    const { data: comment, error } = await supabase
      .from("comments")
      .insert({
        tenant_id: profile.tenant_id,
        case_id: caseId,
        user_id: user.id,
        text: text.trim(),
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating comment:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: comment }, { status: 201 });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
