import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();

    // Authenticate
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Get user profile and verify admin role
    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    if (profile.role !== "admin") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const entity = searchParams.get("entity") ?? "";
    const userId = searchParams.get("user_id") ?? "";
    const action = searchParams.get("action") ?? "";
    const dateFrom = searchParams.get("date_from") ?? "";
    const dateTo = searchParams.get("date_to") ?? "";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Build query — fetch audit_log joined with users for name
    let query = admin
      .from("audit_log")
      .select(
        `
        id,
        tenant_id,
        user_id,
        entity,
        entity_id,
        action,
        field,
        old_value,
        new_value,
        created_at,
        users:user_id (
          full_name,
          email
        )
      `,
        { count: "exact" }
      )
      .eq("tenant_id", profile.tenant_id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (entity) {
      query = query.eq("entity", entity);
    }
    if (userId) {
      query = query.eq("user_id", userId);
    }
    if (action && ["create", "update", "delete"].includes(action)) {
      query = query.eq("action", action as "create" | "update" | "delete");
    }
    if (dateFrom) {
      query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    }
    if (dateTo) {
      query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
    }

    const { data, count, error } = await query;

    if (error) {
      console.error("Error fetching audit log:", error);
      return NextResponse.json({ error: "Error al obtener registros de auditoría" }, { status: 500 });
    }

    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return NextResponse.json({
      data: data ?? [],
      total,
      page,
      totalPages,
      limit,
    });
  } catch (err) {
    console.error("Unexpected error in GET /api/admin/audit:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
