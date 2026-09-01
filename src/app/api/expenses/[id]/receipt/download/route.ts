/**
 * GET /api/expenses/[id]/receipt/download
 *
 * El comprobante de un gasto de trámite, servido POR EL DOMINIO DE LA APP.
 * Reemplaza a `/receipt/url`, que entregaba un enlace firmado directo a
 * `*.supabase.co`. Ver `src/lib/storage/serve-file.ts`.
 *
 * PERMISOS: sesión + mismo tenant. El gasto de trámite es del módulo legal, así
 * que el contador —que no entra ahí— queda fuera.
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
    if (profile.role === "contador") {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const { data: expense } = await admin
      .from("expenses")
      .select("receipt_url, receipt_filename")
      .eq("id", params.id)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!expense?.receipt_url) {
      return NextResponse.json({ error: "Recibo no encontrado" }, { status: 404 });
    }

    return await serveStorageFile({
      admin,
      bucket: "documents",
      storageKey: expense.receipt_url,
      fileName: expense.receipt_filename ?? "comprobante",
    });
  } catch (err) {
    console.error("[expenses/receipt/download] error", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
