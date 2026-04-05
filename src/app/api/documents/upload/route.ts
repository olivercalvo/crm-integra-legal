import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
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

    const formData = await request.formData();
    const entityType = formData.get("entity_type") as string;
    const entityId = formData.get("entity_id") as string;
    const files = formData.getAll("files") as File[];

    if (!entityType || !entityId || files.length === 0) {
      return NextResponse.json(
        { error: "Faltan datos requeridos" },
        { status: 400 }
      );
    }

    const uploaded = [];
    for (const file of files) {
      const ext = file.name.split(".").pop() ?? "bin";
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${profile.tenant_id}/${entityType}/${entityId}/${Date.now()}_${safeName}`;

      const buffer = new Uint8Array(await file.arrayBuffer());

      const { error: uploadError } = await admin.storage
        .from("documents")
        .upload(storagePath, buffer, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) {
        console.error("Storage upload error:", uploadError);
        // Continue with remaining files, but log the error
        continue;
      }

      // Save metadata to documents table
      const { data: doc, error: insertError } = await admin
        .from("documents")
        .insert({
          tenant_id: profile.tenant_id,
          entity_type: entityType,
          entity_id: entityId,
          file_name: file.name,
          file_path: storagePath,
          storage_key: storagePath,
          uploaded_by: user.id,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Document insert error:", insertError);
        continue;
      }

      uploaded.push(doc);
    }

    if (uploaded.length === 0) {
      return NextResponse.json(
        { error: "No se pudo subir ningún archivo. Verifica que Supabase Storage esté configurado." },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: uploaded }, { status: 201 });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
