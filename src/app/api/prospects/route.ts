import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await admin.from("users").select("tenant_id").eq("id", user.id).single();
    if (!profile) return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });

    const { data, error } = await admin
      .from("prospects")
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .order("updated_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await admin.from("users").select("tenant_id").eq("id", user.id).single();
    if (!profile) return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });

    const body = await request.json();
    if (!body.name?.trim()) return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });

    const { data, error } = await admin
      .from("prospects")
      .insert({
        tenant_id: profile.tenant_id,
        name: body.name.trim(),
        phone: body.phone || null,
        email: body.email || null,
        service_interest: body.service_interest || null,
        notes: body.notes || null,
        contact_date: body.contact_date || new Date().toISOString().split("T")[0],
        created_by: user.id,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
