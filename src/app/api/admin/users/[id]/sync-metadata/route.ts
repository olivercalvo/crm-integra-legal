import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Endpoint idempotente para reparar usuarios cuyo auth.users.app_metadata
// quedó desincronizado respecto a public.users (típicamente porque fueron
// creados antes del fix del flujo de creación que asegura app_metadata).
// El middleware (src/middleware.ts) autoriza por app_metadata.user_role,
// por lo que sin estos campos el usuario entra en loop /login?error=no-role.
// Solo admin del mismo tenant puede invocarlo.
export async function POST(
  _request: NextRequest,
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

    const { data: targetUser, error: fetchError } = await admin
      .from("users")
      .select("id, email, role, tenant_id, active")
      .eq("id", targetId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (fetchError || !targetUser) {
      return NextResponse.json({ error: "Usuario no encontrado en este tenant" }, { status: 404 });
    }

    const { data: authBefore, error: authFetchError } =
      await admin.auth.admin.getUserById(targetId);
    if (authFetchError || !authBefore?.user) {
      return NextResponse.json(
        { error: "Usuario no existe en auth.users (perfil huérfano)" },
        { status: 404 }
      );
    }

    const beforeMeta = (authBefore.user.app_metadata as Record<string, unknown>) ?? {};
    const desiredRole = targetUser.role;
    const desiredTenant = targetUser.tenant_id;

    const alreadySynced =
      beforeMeta.user_role === desiredRole && beforeMeta.tenant_id === desiredTenant;

    console.log(
      `[users.sync-metadata] inicio target=${targetId} email=${targetUser.email} ` +
      `desired_role=${desiredRole} before_role=${beforeMeta.user_role ?? "null"} ` +
      `already_synced=${alreadySynced}`
    );

    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
      targetId,
      {
        app_metadata: {
          ...beforeMeta,
          user_role: desiredRole,
          tenant_id: desiredTenant,
        },
      }
    );

    if (updateError || !updated?.user) {
      console.error(`[users.sync-metadata] fallo updateUserById id=${targetId}`, updateError);
      return NextResponse.json(
        { error: updateError?.message || "Error al sincronizar metadata" },
        { status: 500 }
      );
    }

    const afterMeta = (updated.user.app_metadata as Record<string, unknown>) ?? {};
    if (afterMeta.user_role !== desiredRole || afterMeta.tenant_id !== desiredTenant) {
      console.error(
        `[users.sync-metadata] verificación post-update falló id=${targetId} after=`,
        afterMeta
      );
      return NextResponse.json(
        { error: "Sincronización aplicada pero verificación falló" },
        { status: 500 }
      );
    }

    if (!alreadySynced) {
      await admin.from("audit_log").insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        entity: "users",
        entity_id: targetId,
        action: "update",
        field: "app_metadata.user_role,app_metadata.tenant_id",
        old_value: JSON.stringify({
          user_role: beforeMeta.user_role ?? null,
          tenant_id: beforeMeta.tenant_id ?? null,
        }),
        new_value: JSON.stringify({
          user_role: desiredRole,
          tenant_id: desiredTenant,
        }),
      });
    }

    console.log(`[users.sync-metadata] OK id=${targetId} rol=${desiredRole}`);

    return NextResponse.json(
      {
        data: {
          id: targetId,
          email: targetUser.email,
          synced: true,
          already_synced_before: alreadySynced,
          app_metadata: {
            user_role: afterMeta.user_role,
            tenant_id: afterMeta.tenant_id,
          },
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Unexpected error in POST /api/admin/users/[id]/sync-metadata:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
