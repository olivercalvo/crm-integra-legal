import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET — suggest next case_code for a given classification
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const classificationId = searchParams.get("classification_id");

    let prefix = "EXP";
    if (classificationId) {
      const { data: classification } = await admin
        .from("cat_classifications")
        .select("prefix")
        .eq("id", classificationId)
        .single();
      if (classification?.prefix) {
        prefix = classification.prefix;
      }
    }

    // Query cases with this prefix to find the max number for THIS classification
    const { data: prefixCases } = await admin
      .from("cases")
      .select("case_code")
      .eq("tenant_id", profile.tenant_id)
      .ilike("case_code", `${prefix}-%`);

    let maxNum = 0;
    if (prefixCases) {
      for (const c of prefixCases) {
        const match = c.case_code?.match(new RegExp(`^${prefix}-(\\d+)$`));
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
    }

    const nextNumber = maxNum + 1;
    const suggested = `${prefix}-${String(nextNumber).padStart(3, "0")}`;

    return NextResponse.json({ suggested });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

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
      procedure_type,
      new_institution_name,
      institution_procedure_number,
      institution_case_number,
      case_start_date,
      procedure_start_date,
      deadline,
    } = body;

    if (!client_id) {
      return NextResponse.json({ error: "El cliente es requerido" }, { status: 400 });
    }

    // Resolve classification prefix
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

    // Get current max case_number for this tenant (for the DB serial field)
    const { data: maxCase } = await admin
      .from("cases")
      .select("case_number")
      .eq("tenant_id", profile.tenant_id)
      .order("case_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextNumber = (maxCase?.case_number ?? 0) + 1;

    let case_code: string;
    const customCode = body.case_code;

    if (customCode && typeof customCode === "string" && customCode.trim()) {
      // Validate uniqueness of custom code
      const { data: existing } = await admin
        .from("cases")
        .select("id")
        .eq("tenant_id", profile.tenant_id)
        .eq("case_code", customCode.trim())
        .maybeSingle();

      if (existing) {
        return NextResponse.json(
          { error: `El código de expediente "${customCode.trim()}" ya existe. Elige otro.` },
          { status: 409 }
        );
      }
      case_code = customCode.trim();
    } else {
      // Auto-generate based on max number for this prefix
      const { data: prefixCases } = await admin
        .from("cases")
        .select("case_code")
        .eq("tenant_id", profile.tenant_id)
        .ilike("case_code", `${prefix}-%`);

      let maxPrefixNum = 0;
      if (prefixCases) {
        for (const c of prefixCases) {
          const match = c.case_code?.match(new RegExp(`^${prefix}-(\\d+)$`));
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxPrefixNum) maxPrefixNum = num;
          }
        }
      }
      const paddedNumber = String(maxPrefixNum + 1).padStart(3, "0");
      case_code = `${prefix}-${paddedNumber}`;
    }

    // If creating a new institution inline, insert it first
    let resolvedInstitutionId = institution_id;
    if (new_institution_name && typeof new_institution_name === "string" && new_institution_name.trim()) {
      const { data: newInst, error: instErr } = await admin
        .from("cat_institutions")
        .insert({ tenant_id: profile.tenant_id, name: new_institution_name.trim(), active: true })
        .select("id")
        .single();
      if (instErr) {
        return NextResponse.json({ error: `Error creando institución: ${instErr.message}` }, { status: 500 });
      }
      resolvedInstitutionId = newInst.id;
    }

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
        institution_id: resolvedInstitutionId || null,
        responsible_id: responsible_id || null,
        opened_at: opened_at || new Date().toISOString().split("T")[0],
        status_id: resolvedStatusId,
        physical_location: physical_location || null,
        observations: observations || null,
        has_digital_file: has_digital_file ?? false,
        entity: null,
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
