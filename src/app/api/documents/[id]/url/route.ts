import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
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
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const { data: doc } = await admin
      .from("documents")
      .select("storage_key")
      .eq("id", params.id)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!doc || !doc.storage_key) {
      return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
    }

    const { data: signedUrl, error } = await admin.storage
      .from("documents")
      .createSignedUrl(doc.storage_key, 300); // 5 minutes

    if (error || !signedUrl) {
      return NextResponse.json({ error: "No se pudo generar la URL" }, { status: 500 });
    }

    return NextResponse.json({ url: signedUrl.signedUrl });
  } catch (err) {
    console.error("Error generating signed URL:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
