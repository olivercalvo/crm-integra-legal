/**
 * GET /api/documents/[id]/download
 *
 * Devuelve el archivo POR EL DOMINIO DE LA APP. Reemplaza a
 * `/api/documents/[id]/url`, que le entregaba al navegador un enlace firmado
 * directo a `*.supabase.co` — y eso rompía en cualquier red donde ese dominio no
 * resolviera. Ver `src/lib/storage/serve-file.ts` para el incidente completo.
 *
 * PERMISOS
 *   1. Sesión válida.
 *   2. El documento tiene que ser del MISMO tenant que el usuario. Es el filtro
 *      que ya existía y se conserva: sin él, conocer un uuid alcanzaría para
 *      bajarse el archivo de otro bufete.
 *   3. Si el documento cuelga de un caso, el usuario tiene que poder ver ese
 *      caso. Esto NO estaba antes.
 */
import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serveStorageFile } from "@/lib/storage/serve-file";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
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
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const { data: doc } = await admin
      .from("documents")
      .select("storage_key, file_name, entity_type, entity_id")
      .eq("id", params.id)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!doc || !doc.storage_key) {
      return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
    }

    // El contador no trabaja con expedientes: los documentos del módulo legal no
    // son suyos. Los que cuelgan de una cotización o una factura sí (los PDFs
    // que genera el sistema), porque los ve desde Finanzas.
    const ENTIDADES_LEGALES = ["case", "client", "task", "comment"];
    if (profile.role === "contador" && ENTIDADES_LEGALES.includes(doc.entity_type)) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    return await serveStorageFile({
      admin,
      bucket: "documents",
      storageKey: doc.storage_key,
      // El nombre real con el que se subió, no el uuid del storage.
      fileName: doc.file_name ?? "documento",
    });
  } catch (err) {
    console.error("[documents/download] error", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
