import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();

    // Verify auth
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Get user profile for tenant_id
    const { data: profile } = await admin
      .from("users")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const body = await request.json();
    const {
      client_id,
      description,
      classification_id,
      institution_id,
      responsible_id,
      opened_at,
      status_id,
      physical_location,
      observations,
      has_digital_file,
      entity,
      procedure_type,
      institution_procedure_number,
      institution_case_number,
      case_start_date,
      procedure_start_date,
      deadline,
    } = body;

    if (!client_id) {
      return NextResponse.json({ error: "El cliente es requerido" }, { status: 400 });
    }

    // Auto-generate case_code: prefix from classification + sequential number
    let prefix = "EXP";
    if (classification_id) {
      const { data: classification } = await admin
        .from("cat_classifications")
        .select("prefix")
        .eq("id", classification_id)
        .single();
      if (classification?.prefix) {
        prefix = classification.prefix;
      }
    }

    // Get current max case_number for this tenant to assign next number
    const { data: maxCase } = await admin
      .from("cases")
      .select("case_number")
      .eq("tenant_id", profile.tenant_id)
      .order("case_number", { ascending: false })
      .limit(1)
      .single();

    const nextNumber = (maxCase?.case_number ?? 0) + 1;
    const paddedNumber = String(nextNumber).padStart(3, "0");
    const case_code = `${prefix}-${paddedNumber}`;

    // Get default status if not provided
    let resolvedStatusId = status_id;
    if (!resolvedStatusId) {
      const { data: firstStatus } = await admin
        .from("cat_statuses")
        .select("id")
        .eq("tenant_id", profile.tenant_id)
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();
      resolvedStatusId = firstStatus?.id ?? null;
    }

    const { data: newCase, error } = await admin
      .from("cases")
      .insert({
        tenant_id: profile.tenant_id,
        client_id,
        case_number: nextNumber,
        case_code,
        description: description || null,
        classification_id: classification_id || null,
        institution_id: institution_id || null,
        responsible_id: responsible_id || null,
        opened_at: opened_at || new Date().toISOString().split("T")[0],
        status_id: resolvedStatusId,
        physical_location: physical_location || null,
        observations: observations || null,
        has_digital_file: has_digital_file ?? false,
        entity: entity || null,
        procedure_type: procedure_type || null,
        institution_procedure_number: institution_procedure_number || null,
        institution_case_number: institution_case_number || null,
        case_start_date: case_start_date || null,
        procedure_start_date: procedure_start_date || null,
        deadline: deadline || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating case:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log
    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "cases",
      entity_id: newCase.id,
      action: "create",
      field: null,
      old_value: null,
      new_value: JSON.stringify({ case_code, client_id, description }),
    });

    return NextResponse.json({ data: newCase }, { status: 201 });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
