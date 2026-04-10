import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  _request: NextRequest,
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
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    // Only admin and abogada can delete documents
    if (profile.role !== "admin" && profile.role !== "abogada") {
      return NextResponse.json({ error: "No tienes permisos para eliminar documentos" }, { status: 403 });
    }

    const docId = params.id;

    // Fetch the document to verify it exists and belongs to this tenant
    const { data: doc } = await admin
      .from("documents")
      .select("id, file_name, storage_key, entity_type, entity_id, created_at")
      .eq("id", docId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!doc) {
      return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
    }

    // Delete file from Supabase Storage
    if (doc.storage_key) {
      await admin.storage.from("documents").remove([doc.storage_key]);
    }

    // Delete record from DB
    const { error: deleteError } = await admin
      .from("documents")
      .delete()
      .eq("id", docId)
      .eq("tenant_id", profile.tenant_id);

    if (deleteError) {
      console.error("Error deleting document:", deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Audit log
    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "documents",
      entity_id: docId,
      action: "delete",
      field: null,
      old_value: JSON.stringify({
        file_name: doc.file_name,
        entity_type: doc.entity_type,
        entity_id: doc.entity_id,
      }),
      new_value: null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Unexpected error deleting document:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
