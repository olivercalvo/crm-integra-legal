import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/payments/[id]/receipt/url — Get a signed URL to view the receipt
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

    const { data: payment } = await admin
      .from("client_payments")
      .select("receipt_url")
      .eq("id", params.id)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!payment?.receipt_url) {
      return NextResponse.json({ error: "Recibo no encontrado" }, { status: 404 });
    }

    const { data: signedUrl } = await admin.storage
      .from("documents")
      .createSignedUrl(payment.receipt_url, 3600); // 1 hour

    if (!signedUrl?.signedUrl) {
      return NextResponse.json({ error: "No se pudo generar URL del recibo" }, { status: 500 });
    }

    return NextResponse.json({ url: signedUrl.signedUrl });
  } catch (err) {
    console.error("Error getting payment receipt URL:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
