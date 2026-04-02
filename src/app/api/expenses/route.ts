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
    const { case_id, amount, concept, date } = body;

    if (!case_id || !amount || !concept || !date) {
      return NextResponse.json({ error: "Faltan campos requeridos: case_id, amount, concept, date" }, { status: 400 });
    }

    if (typeof amount !== "number" || amount <= 0) {
      return NextResponse.json({ error: "El monto debe ser un número mayor a 0" }, { status: 400 });
    }

    const { data: expense, error: insertError } = await supabase
      .from("expenses")
      .insert({
        tenant_id: profile.tenant_id,
        case_id,
        amount,
        concept: concept.trim(),
        date,
        registered_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting expense:", insertError);
      return NextResponse.json({ error: "Error al registrar el gasto" }, { status: 500 });
    }

    return NextResponse.json(expense, { status: 201 });
  } catch (err) {
    console.error("Unexpected error in POST /api/expenses:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
