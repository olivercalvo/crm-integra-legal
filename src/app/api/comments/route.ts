import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, requireEntityInTenant } from "@/lib/supabase/server-query";

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
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil de usuario no encontrado" }, { status: 403 });
    }

    // Comentar es acción de admin/abogada/asistente (matriz de roles). Contador
    // no toca recursos legales.
    const denied = requireRole(profile.role, ["admin", "abogada", "asistente"]);
    if (denied) return denied;

    const body = await request.json();
    const { case_id, text, follow_up_date } = body;

    if (!case_id || !text?.trim()) {
      return NextResponse.json({ error: "Faltan campos requeridos: case_id, text" }, { status: 400 });
    }

    // IDOR: verificar que el caso exista y pertenezca al tenant ANTES de
    // insertar. Sin esto, un usuario podría comentar en el caso de otro tenant
    // pasando su case_id. (Mismo patrón que cases/[id]/comments/route.ts.)
    const idor = await requireEntityInTenant(
      admin,
      "cases",
      case_id,
      profile.tenant_id,
      "Caso no encontrado"
    );
    if (idor) return idor;

    const { data: comment, error: insertError } = await admin
      .from("comments")
      .insert({
        tenant_id: profile.tenant_id,
        case_id,
        text: text.trim(),
        user_id: user.id,
        ...(follow_up_date ? { follow_up_date } : {}),
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting comment:", insertError);
      return NextResponse.json({ error: "Error al agregar el comentario" }, { status: 500 });
    }

    return NextResponse.json(comment, { status: 201 });
  } catch (err) {
    console.error("Unexpected error in POST /api/comments:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
