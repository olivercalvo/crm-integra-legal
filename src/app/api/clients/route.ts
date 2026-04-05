import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET — suggest next client_number
export async function GET() {
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

    const { data: lastClient } = await admin
      .from("clients")
      .select("client_number")
      .eq("tenant_id", profile.tenant_id)
      .order("client_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextNumber = 1;
    if (lastClient?.client_number) {
      const match = lastClient.client_number.match(/CLI-(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    return NextResponse.json({ suggested: `CLI-${String(nextNumber).padStart(3, "0")}` });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

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

    // Get tenant_id from user profile
    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const body = await request.json();
    const { name, ruc, type, contact, phone, email, observations, client_number: customNumber } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
    }

    let client_number: string;

    if (customNumber && typeof customNumber === "string" && customNumber.trim()) {
      // Validate uniqueness of custom number
      const { data: existing } = await admin
        .from("clients")
        .select("id")
        .eq("tenant_id", profile.tenant_id)
        .eq("client_number", customNumber.trim())
        .maybeSingle();

      if (existing) {
        return NextResponse.json(
          { error: `El número de cliente "${customNumber.trim()}" ya existe. Elige otro.` },
          { status: 409 }
        );
      }
      client_number = customNumber.trim();
    } else {
      // Auto-generate client_number: CLI-NNN
      const { data: lastClient } = await admin
        .from("clients")
        .select("client_number")
        .eq("tenant_id", profile.tenant_id)
        .order("client_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      let nextNumber = 1;
      if (lastClient?.client_number) {
        const match = lastClient.client_number.match(/CLI-(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1], 10) + 1;
        }
      }
      client_number = `CLI-${String(nextNumber).padStart(3, "0")}`;
    }

    const { data: newClient, error: insertError } = await admin
      .from("clients")
      .insert({
        tenant_id: profile.tenant_id,
        client_number,
        name: name.trim(),
        ruc: ruc?.trim() || null,
        type: type || null,
        contact: contact?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        observations: observations?.trim() || null,
        active: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating client:", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Audit log
    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "clients",
      entity_id: newClient.id,
      action: "create",
      field: null,
      old_value: null,
      new_value: JSON.stringify(newClient),
    });

    return NextResponse.json(newClient, { status: 201 });
  } catch (error) {
    console.error("Unexpected error in POST /api/clients:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
