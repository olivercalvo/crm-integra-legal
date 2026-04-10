import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/todos/[id]/documents/register — Save todo document metadata after direct upload
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const body = await request.json();
    const { file_name, storage_path } = body;

    if (!file_name || !storage_path) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: file_name, storage_path" },
        { status: 400 }
      );
    }

    if (!storage_path.startsWith(profile.tenant_id + "/")) {
      return NextResponse.json({ error: "Ruta de storage no válida" }, { status: 403 });
    }

    const { data: doc, error: insertError } = await admin
      .from("todo_documents")
      .insert({
        tenant_id: profile.tenant_id,
        todo_id: params.id,
        file_name,
        file_path: storage_path,
        storage_key: storage_path,
        uploaded_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Todo document register error:", insertError);
      return NextResponse.json({ error: "Error al registrar documento" }, { status: 500 });
    }

    return NextResponse.json(doc, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
