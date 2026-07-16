import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  allocateClientNumber,
  formatClientNumber,
  previewNextClientNumber,
} from "@/lib/clients/numbering";
import { validateFiscalFields, validateClientType } from "@/lib/clients/fiscal-fields";
import { requireRole } from "@/lib/supabase/server-query";

// GET — suggest next client_number (lee numbering_sequences sin consumir)
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

    const suggested = await previewNextClientNumber(admin, profile.tenant_id);

    // Si la secuencia no está seedeada (misconfig de migración) caemos al
    // primer número del padding como sugerencia visual; la creación real
    // explotaría en allocateClientNumber con un error explícito.
    return NextResponse.json({ suggested: suggested ?? formatClientNumber(1) });
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
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    // Solo admin y abogada crean clientes (matriz de roles).
    const denied = requireRole(profile.role, ["admin", "abogada"]);
    if (denied) return denied;

    const body = await request.json();
    const { name, ruc, type, contact, phone, email, observations, client_number: customNumber, responsible_lawyer_id, tipo_receptor_fe, digito_verificador, client_type } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
    }

    // OBLIGATORIO: sin client_type la FE explota al mapear el receptor.
    const clientTypeError = validateClientType(client_type);
    if (clientTypeError) {
      return NextResponse.json(
        { error: clientTypeError, fieldErrors: { client_type: clientTypeError } },
        { status: 400 }
      );
    }

    // FE DGI: validar coherencia de campos fiscales (DV obligatorio si 01/03).
    const fiscalErrors = validateFiscalFields({ tipo_receptor_fe, digito_verificador });
    if (Object.keys(fiscalErrors).length > 0) {
      return NextResponse.json(
        { error: Object.values(fiscalErrors)[0], fieldErrors: fiscalErrors },
        { status: 400 }
      );
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
      // Auto-generate via allocator atómico (numbering_sequences + RPC).
      client_number = await allocateClientNumber(admin, profile.tenant_id);
    }

    const { data: newClient, error: insertError } = await admin
      .from("clients")
      .insert({
        tenant_id: profile.tenant_id,
        client_number,
        name: name.trim(),
        ruc: ruc?.trim() || null,
        type: type || null,
        client_type,
        contact: contact?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        observations: observations?.trim() || null,
        responsible_lawyer_id: responsible_lawyer_id || null,
        tipo_receptor_fe: tipo_receptor_fe || null,
        digito_verificador: digito_verificador?.trim() || null,
        client_status: "active",
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
