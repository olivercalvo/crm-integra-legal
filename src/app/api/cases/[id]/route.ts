import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const caseId = params.id;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("users")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    // Verify case exists and belongs to tenant
    const { data: existingCase } = await supabase
      .from("cases")
      .select("*")
      .eq("id", caseId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!existingCase) {
      return NextResponse.json({ error: "Expediente no encontrado" }, { status: 404 });
    }

    const body = await request.json();
    const {
      action,
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
    } = body;

    // Handle status change action
    if (action === "change-status") {
      if (!status_id) {
        return NextResponse.json({ error: "El estado es requerido" }, { status: 400 });
      }

      const { data: newStatus } = await supabase
        .from("cat_statuses")
        .select("name")
        .eq("id", status_id)
        .single();

      const { data: oldStatus } = existingCase.status_id
        ? await supabase
            .from("cat_statuses")
            .select("name")
            .eq("id", existingCase.status_id)
            .single()
        : { data: null };

      const { data: updated, error } = await supabase
        .from("cases")
        .update({ status_id, updated_at: new Date().toISOString() })
        .eq("id", caseId)
        .eq("tenant_id", profile.tenant_id)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Audit log for status change
      await supabase.from("audit_log").insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        entity: "cases",
        entity_id: caseId,
        action: "update",
        field: "status_id",
        old_value: (oldStatus as { name: string } | null)?.name ?? existingCase.status_id,
        new_value: (newStatus as { name: string } | null)?.name ?? status_id,
      });

      return NextResponse.json({ data: updated });
    }

    // Regular update
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (client_id !== undefined) updatePayload.client_id = client_id;
    if (description !== undefined) updatePayload.description = description || null;
    if (classification_id !== undefined) updatePayload.classification_id = classification_id || null;
    if (institution_id !== undefined) updatePayload.institution_id = institution_id || null;
    if (responsible_id !== undefined) updatePayload.responsible_id = responsible_id || null;
    if (opened_at !== undefined) updatePayload.opened_at = opened_at;
    if (status_id !== undefined) updatePayload.status_id = status_id || null;
    if (physical_location !== undefined) updatePayload.physical_location = physical_location || null;
    if (observations !== undefined) updatePayload.observations = observations || null;
    if (has_digital_file !== undefined) updatePayload.has_digital_file = has_digital_file;

    const { data: updated, error } = await supabase
      .from("cases")
      .update(updatePayload)
      .eq("id", caseId)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (error) {
      console.error("Error updating case:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log for each changed field
    const trackedFields = [
      "client_id", "description", "classification_id", "institution_id",
      "responsible_id", "opened_at", "status_id", "physical_location",
      "observations", "has_digital_file",
    ];

    const auditEntries = trackedFields
      .filter((field) => updatePayload[field] !== undefined && updatePayload[field] !== existingCase[field as keyof typeof existingCase])
      .map((field) => ({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        entity: "cases",
        entity_id: caseId,
        action: "update" as const,
        field,
        old_value: String(existingCase[field as keyof typeof existingCase] ?? ""),
        new_value: String(updatePayload[field] ?? ""),
      }));

    if (auditEntries.length > 0) {
      await supabase.from("audit_log").insert(auditEntries);
    }

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
