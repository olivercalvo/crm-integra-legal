import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const { id } = params;

    // Fetch existing client (ensures tenant isolation)
    const { data: existing, error: fetchError } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const body = await request.json();
    const { name, ruc, type, contact, phone, email, observations } = body;

    if (name !== undefined && (!name || !String(name).trim())) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
    }

    const updates: Record<string, string | null> = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (ruc !== undefined) updates.ruc = ruc?.trim() || null;
    if (type !== undefined) updates.type = type || null;
    if (contact !== undefined) updates.contact = contact?.trim() || null;
    if (phone !== undefined) updates.phone = phone?.trim() || null;
    if (email !== undefined) updates.email = email?.trim() || null;
    if (observations !== undefined) updates.observations = observations?.trim() || null;

    const { data: updated, error: updateError } = await supabase
      .from("clients")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating client:", updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Audit log — record each changed field
    const changedFields = Object.keys(updates);
    for (const field of changedFields) {
      const oldVal = String(existing[field] ?? "");
      const newVal = String(updates[field] ?? "");
      if (oldVal !== newVal) {
        await supabase.from("audit_log").insert({
          tenant_id: profile.tenant_id,
          user_id: user.id,
          entity: "clients",
          entity_id: id,
          action: "update",
          field,
          old_value: oldVal || null,
          new_value: newVal || null,
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Unexpected error in PATCH /api/clients/[id]:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const { id } = params;

    // Verify client belongs to tenant
    const { data: existing, error: fetchError } = await supabase
      .from("clients")
      .select("id, name")
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    // Soft delete: set active = false
    const { error: deleteError } = await supabase
      .from("clients")
      .update({ active: false })
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id);

    if (deleteError) {
      console.error("Error deactivating client:", deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Audit log
    await supabase.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "clients",
      entity_id: id,
      action: "delete",
      field: "active",
      old_value: "true",
      new_value: "false",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unexpected error in DELETE /api/clients/[id]:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
