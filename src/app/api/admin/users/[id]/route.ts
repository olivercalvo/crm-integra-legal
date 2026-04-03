import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/types/database";

const VALID_ROLES: UserRole[] = ["admin", "abogada", "asistente"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
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

    if (profile.role !== "admin") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    const targetId = params.id;

    // Verify target user belongs to same tenant
    const { data: targetUser, error: fetchError } = await admin
      .from("users")
      .select("*")
      .eq("id", targetId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (fetchError || !targetUser) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.full_name !== undefined) updates.full_name = body.full_name.trim();
    if (body.active !== undefined) updates.active = body.active;

    if (body.role !== undefined) {
      if (!VALID_ROLES.includes(body.role as UserRole)) {
        return NextResponse.json(
          { error: `Rol inválido. Use: ${VALID_ROLES.join(", ")}` },
          { status: 400 }
        );
      }
      updates.role = body.role as UserRole;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const { data: updatedUser, error: updateError } = await admin
      .from("users")
      .update(updates)
      .eq("id", targetId)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating user:", updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "users",
      entity_id: targetId,
      action: "update",
      field: Object.keys(updates).join(", "),
      old_value: JSON.stringify(
        Object.fromEntries(Object.keys(updates).map((k) => [k, targetUser[k as keyof typeof targetUser]]))
      ),
      new_value: JSON.stringify(updates),
    });

    return NextResponse.json({ data: updatedUser }, { status: 200 });
  } catch (err) {
    console.error("Unexpected error in PATCH /api/admin/users/[id]:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
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

    if (profile.role !== "admin") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    const targetId = params.id;

    // Prevent self-deactivation
    if (targetId === user.id) {
      return NextResponse.json(
        { error: "No puedes desactivar tu propia cuenta" },
        { status: 400 }
      );
    }

    // Verify target user belongs to same tenant
    const { data: targetUser, error: fetchError } = await admin
      .from("users")
      .select("*")
      .eq("id", targetId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (fetchError || !targetUser) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    // Soft deactivate in public.users
    const { data: deactivated, error: updateError } = await admin
      .from("users")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", targetId)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (updateError) {
      console.error("Error deactivating user:", updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "users",
      entity_id: targetId,
      action: "delete",
      field: "active",
      old_value: "true",
      new_value: "false",
    });

    return NextResponse.json({ data: deactivated }, { status: 200 });
  } catch (err) {
    console.error("Unexpected error in DELETE /api/admin/users/[id]:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
