import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateFiscalFields } from "@/lib/clients/fiscal-fields";
import { requireRole } from "@/lib/supabase/server-query";

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

    const admin = createAdminClient();

    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    // Solo admin y abogada editan/desactivan clientes (matriz de roles).
    const denied = requireRole(profile.role, ["admin", "abogada"]);
    if (denied) return denied;

    const { id } = params;

    // Fetch existing client (ensures tenant isolation)
    const { data: existing, error: fetchError } = await admin
      .from("clients")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const body = await request.json();
    const {
      name,
      ruc,
      type,
      contact,
      phone,
      email,
      observations,
      responsible_lawyer_id,
      // Sprint 2E.1 — campos para soporte de prospects (D11, D12)
      client_status,
      client_type,
      tax_id,
      tax_id_type,
      // FE DGI — datos fiscales del receptor
      tipo_receptor_fe,
      digito_verificador,
    } = body;

    if (name !== undefined && (!name || !String(name).trim())) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
    }

    // Validar valores válidos de client_status / client_type si vienen
    if (
      client_status !== undefined &&
      !["prospect", "active", "inactive"].includes(client_status)
    ) {
      return NextResponse.json(
        { error: "client_status inválido (valores válidos: prospect, active, inactive)" },
        { status: 400 }
      );
    }
    if (
      client_type !== undefined &&
      client_type !== null &&
      !["persona_natural", "persona_juridica"].includes(client_type)
    ) {
      return NextResponse.json(
        { error: "client_type inválido (valores válidos: persona_natural, persona_juridica)" },
        { status: 400 }
      );
    }

    // FE DGI: validar coherencia de campos fiscales sobre la "vista combinada"
    // (valor del body si viene, sino el existente). Solo si se toca alguno de
    // los dos campos fiscales, para no bloquear updates ajenos.
    if (tipo_receptor_fe !== undefined || digito_verificador !== undefined) {
      const finalTipo =
        tipo_receptor_fe !== undefined ? tipo_receptor_fe : existing.tipo_receptor_fe;
      const finalDV =
        digito_verificador !== undefined ? digito_verificador : existing.digito_verificador;
      const fiscalErrors = validateFiscalFields({
        tipo_receptor_fe: finalTipo,
        digito_verificador: finalDV,
      });
      if (Object.keys(fiscalErrors).length > 0) {
        return NextResponse.json(
          { error: Object.values(fiscalErrors)[0], fieldErrors: fiscalErrors },
          { status: 400 }
        );
      }
    }

    // Gate de promoción prospect → active (D12). Si el cliente está en
    // prospect y se intenta pasar a active, exigimos campos obligatorios
    // para facturación. Comparamos la "vista combinada": valor del body si
    // viene, sino el valor existente en BD.
    if (existing.client_status === "prospect" && client_status === "active") {
      const finalTaxId =
        tax_id !== undefined ? (tax_id ? String(tax_id).trim() : "") : (existing.tax_id ?? "");
      const finalTaxIdType =
        tax_id_type !== undefined
          ? (tax_id_type ? String(tax_id_type).trim() : "")
          : (existing.tax_id_type ?? "");
      const finalEmail =
        email !== undefined ? (email ? String(email).trim() : "") : (existing.email ?? "");

      const missing: string[] = [];
      if (!finalTaxId) missing.push("tax_id");
      if (!finalTaxIdType) missing.push("tax_id_type");
      if (!finalEmail) missing.push("email");

      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: `Para promover el cliente a activo, debes completar: ${missing.join(", ")}.`,
            fieldErrors: missing.reduce<Record<string, string>>((acc, f) => {
              acc[f] = "Requerido para promover a activo";
              return acc;
            }, {}),
          },
          { status: 400 }
        );
      }
    }

    const updates: Record<string, string | null> = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (ruc !== undefined) updates.ruc = ruc?.trim() || null;
    if (type !== undefined) updates.type = type || null;
    if (contact !== undefined) updates.contact = contact?.trim() || null;
    if (phone !== undefined) updates.phone = phone?.trim() || null;
    if (email !== undefined) updates.email = email?.trim() || null;
    if (observations !== undefined) updates.observations = observations?.trim() || null;
    if (responsible_lawyer_id !== undefined) updates.responsible_lawyer_id = responsible_lawyer_id || null;
    if (client_status !== undefined) updates.client_status = client_status;
    if (client_type !== undefined) updates.client_type = client_type || null;
    if (tax_id !== undefined) updates.tax_id = tax_id?.trim() || null;
    if (tax_id_type !== undefined) updates.tax_id_type = tax_id_type || null;
    if (tipo_receptor_fe !== undefined) updates.tipo_receptor_fe = tipo_receptor_fe || null;
    if (digito_verificador !== undefined) updates.digito_verificador = digito_verificador?.trim() || null;

    const { data: updated, error: updateError } = await admin
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
        await admin.from("audit_log").insert({
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

    const admin = createAdminClient();

    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    // Solo admin y abogada editan/desactivan clientes (matriz de roles).
    const denied = requireRole(profile.role, ["admin", "abogada"]);
    if (denied) return denied;

    const { id } = params;

    // Verify client belongs to tenant
    const { data: existing, error: fetchError } = await admin
      .from("clients")
      .select("id, name, client_status")
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    // Soft delete: set client_status = 'inactive'. La columna `active`
    // es GENERATED ALWAYS desde client_status, no se setea directamente.
    const { error: deleteError } = await admin
      .from("clients")
      .update({ client_status: "inactive" })
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id);

    if (deleteError) {
      console.error("Error deactivating client:", deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Audit log
    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "clients",
      entity_id: id,
      action: "delete",
      field: "client_status",
      old_value: (existing.client_status as string) ?? "active",
      new_value: "inactive",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unexpected error in DELETE /api/clients/[id]:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
