import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();

    // Authenticate
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Get user's tenant_id
    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil de usuario no encontrado" }, { status: 403 });
    }

    const body = await request.json();
    const { case_id, amount, payment_date, payment_type, description } = body;

    if (!case_id || !amount || !payment_date) {
      return NextResponse.json({ error: "Faltan campos requeridos: case_id, amount, payment_date" }, { status: 400 });
    }

    if (typeof amount !== "number" || amount <= 0) {
      return NextResponse.json({ error: "El monto debe ser un número mayor a 0" }, { status: 400 });
    }

    const validType = payment_type === "administrativo" ? "administrativo" : "tramite";

    const { data: payment, error: insertError } = await admin
      .from("client_payments")
      .insert({
        tenant_id: profile.tenant_id,
        case_id,
        amount,
        description: description?.trim() || null,
        payment_date,
        payment_type: validType,
        registered_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting payment:", insertError);
      return NextResponse.json({ error: "Error al registrar el pago" }, { status: 500 });
    }

    return NextResponse.json(payment, { status: 201 });
  } catch (err) {
    console.error("Unexpected error in POST /api/payments:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
