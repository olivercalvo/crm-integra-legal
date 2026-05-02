import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/types/database";

const VALID_ROLES: UserRole[] = ["admin", "abogada", "asistente"];

export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") === "true";

    let query = admin
      .from("users")
      .select("id, full_name, email, role, active, created_at, updated_at")
      .eq("tenant_id", profile.tenant_id)
      .order("full_name", { ascending: true });

    if (!includeInactive) {
      query = query.eq("active", true);
    }

    const { data: users, error: fetchError } = await query;

    if (fetchError) {
      console.error("Error fetching users:", fetchError);
      return NextResponse.json({ error: "Error al obtener usuarios" }, { status: 500 });
    }

    return NextResponse.json({ data: users ?? [] }, { status: 200 });
  } catch (err) {
    console.error("Unexpected error in GET /api/admin/users:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { email, full_name, password, role } = body;

    if (!email?.trim()) {
      return NextResponse.json({ error: "El email es requerido" }, { status: 400 });
    }

    if (!full_name?.trim()) {
      return NextResponse.json({ error: "El nombre completo es requerido" }, { status: 400 });
    }

    if (!password || password.length < 8) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
    }

    if (!role || !VALID_ROLES.includes(role as UserRole)) {
      return NextResponse.json(
        { error: `Rol inválido. Use: ${VALID_ROLES.join(", ")}` },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedFullName = full_name.trim();

    console.log(`[users.create] inicio email=${normalizedEmail} rol=${role}`);

    // Create auth user via admin client.
    // CRITICAL: app_metadata.user_role + app_metadata.tenant_id son los campos
    // que el middleware (src/middleware.ts) lee para autorizar acceso. Si solo
    // se setea user_metadata, el usuario entra en loop /login?error=no-role.
    const { data: authData, error: authCreateError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      app_metadata: {
        user_role: role,
        tenant_id: profile.tenant_id,
      },
      user_metadata: {
        full_name: normalizedFullName,
        role,
        tenant_id: profile.tenant_id,
      },
    });

    if (authCreateError || !authData.user) {
      console.error(`[users.create] fallo auth.users email=${normalizedEmail}`, authCreateError);
      if (authCreateError?.message?.includes("already") || authCreateError?.message?.includes("duplicate")) {
        return NextResponse.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
      }
      return NextResponse.json(
        { error: authCreateError?.message || "Error al crear usuario de autenticación" },
        { status: 500 }
      );
    }

    const authUserId = authData.user.id;
    console.log(`[users.create] auth.users creado id=${authUserId}`);

    // Verificación defensiva: confirmar que app_metadata quedó seteado.
    // Si Supabase cambia su API o el campo no se persistió, abortamos y rollback.
    const appMeta = authData.user.app_metadata as Record<string, unknown> | null;
    if (!appMeta || appMeta.user_role !== role || appMeta.tenant_id !== profile.tenant_id) {
      console.error(
        `[users.create] app_metadata inconsistente tras createUser id=${authUserId} app_metadata=`,
        appMeta
      );
      await admin.auth.admin.deleteUser(authUserId);
      return NextResponse.json(
        { error: "Error al sincronizar metadata de autenticación. Operación revertida." },
        { status: 500 }
      );
    }

    // Create public.users record
    const { data: newUser, error: insertError } = await admin
      .from("users")
      .insert({
        id: authUserId,
        tenant_id: profile.tenant_id,
        email: normalizedEmail,
        full_name: normalizedFullName,
        role: role as UserRole,
        active: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error(`[users.create] fallo public.users id=${authUserId}, rollback auth.users`, insertError);
      await admin.auth.admin.deleteUser(authUserId);
      return NextResponse.json({ error: "Error al crear el perfil del usuario" }, { status: 500 });
    }

    console.log(`[users.create] public.users creado id=${authUserId} email=${normalizedEmail} rol=${role}`);

    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "users",
      entity_id: newUser.id,
      action: "create",
      field: null,
      old_value: null,
      new_value: JSON.stringify({ email: newUser.email, full_name: newUser.full_name, role: newUser.role }),
    });

    return NextResponse.json({ data: newUser }, { status: 201 });
  } catch (err) {
    console.error("Unexpected error in POST /api/admin/users:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
