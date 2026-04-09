import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/jpg",
  "application/pdf",
];

// POST /api/expenses/[id]/receipt — Upload receipt for an expense
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
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

    if (profile.role !== "admin" && profile.role !== "abogada") {
      return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
    }

    const expenseId = params.id;

    // Verify expense exists and belongs to tenant
    const { data: expense } = await admin
      .from("expenses")
      .select("id, case_id, receipt_url, tenant_id")
      .eq("id", expenseId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!expense) {
      return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No se envió ningún archivo" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "El archivo excede el tamaño máximo de 10MB" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo de archivo no permitido. Use JPG, PNG o PDF." },
        { status: 400 }
      );
    }

    // Delete old receipt if exists
    if (expense.receipt_url) {
      await admin.storage.from("documents").remove([expense.receipt_url]);
    }

    // Upload new receipt
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${profile.tenant_id}/gastos/${expense.case_id}/${expenseId}/${Date.now()}_${safeName}`;

    const buffer = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from("documents")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Receipt upload error:", uploadError);
      return NextResponse.json({ error: "Error al subir el archivo" }, { status: 500 });
    }

    // Update expense with receipt reference
    const { error: updateError } = await admin
      .from("expenses")
      .update({
        receipt_url: storagePath,
        receipt_filename: file.name,
      })
      .eq("id", expenseId)
      .eq("tenant_id", profile.tenant_id);

    if (updateError) {
      console.error("Error updating expense with receipt:", updateError);
      return NextResponse.json({ error: "Error al guardar referencia del recibo" }, { status: 500 });
    }

    // Audit
    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "expenses",
      entity_id: expenseId,
      action: "update",
      field: "receipt",
      old_value: expense.receipt_url ?? null,
      new_value: storagePath,
    });

    return NextResponse.json({ receipt_url: storagePath, receipt_filename: file.name }, { status: 201 });
  } catch (err) {
    console.error("Unexpected error uploading receipt:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE /api/expenses/[id]/receipt — Remove receipt from an expense
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
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

    if (profile.role !== "admin" && profile.role !== "abogada") {
      return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
    }

    const expenseId = params.id;

    const { data: expense } = await admin
      .from("expenses")
      .select("id, receipt_url, tenant_id")
      .eq("id", expenseId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!expense) {
      return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
    }

    if (!expense.receipt_url) {
      return NextResponse.json({ error: "Este gasto no tiene recibo adjunto" }, { status: 400 });
    }

    // Remove from storage
    await admin.storage.from("documents").remove([expense.receipt_url]);

    // Clear references
    await admin
      .from("expenses")
      .update({ receipt_url: null, receipt_filename: null })
      .eq("id", expenseId)
      .eq("tenant_id", profile.tenant_id);

    // Audit
    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "expenses",
      entity_id: expenseId,
      action: "update",
      field: "receipt",
      old_value: expense.receipt_url,
      new_value: null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Unexpected error deleting receipt:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
