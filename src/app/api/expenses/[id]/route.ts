import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// PATCH /api/expenses/[id] — Update an expense
export async function PATCH(
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

    // Only admin and abogada can edit expenses
    if (profile.role !== "admin" && profile.role !== "abogada") {
      return NextResponse.json({ error: "No tienes permisos para editar gastos" }, { status: 403 });
    }

    const expenseId = params.id;

    // Fetch existing expense
    const { data: existing } = await admin
      .from("expenses")
      .select("id, amount, concept, date, expense_type, tenant_id, receipt_url, receipt_filename")
      .eq("id", expenseId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
    }

    const body = await request.json();
    const { amount, concept, date, receipt_url, receipt_filename } = body;

    const updates: Record<string, unknown> = {};
    const auditEntries: { field: string; old_value: string | null; new_value: string | null }[] = [];

    if (amount !== undefined && amount !== existing.amount) {
      if (typeof amount !== "number" || amount <= 0) {
        return NextResponse.json({ error: "El monto debe ser mayor a 0" }, { status: 400 });
      }
      updates.amount = amount;
      auditEntries.push({ field: "amount", old_value: String(existing.amount), new_value: String(amount) });
    }

    if (concept !== undefined && concept.trim() !== existing.concept) {
      if (!concept.trim()) {
        return NextResponse.json({ error: "El concepto es requerido" }, { status: 400 });
      }
      updates.concept = concept.trim();
      auditEntries.push({ field: "concept", old_value: existing.concept, new_value: concept.trim() });
    }

    if (date !== undefined && date !== existing.date) {
      updates.date = date;
      auditEntries.push({ field: "date", old_value: existing.date, new_value: date });
    }

    if (receipt_url !== undefined && receipt_url !== existing.receipt_url) {
      updates.receipt_url = receipt_url;
      updates.receipt_filename = receipt_filename ?? null;
      auditEntries.push({ field: "receipt_url", old_value: existing.receipt_url, new_value: receipt_url });
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ message: "Sin cambios" });
    }

    const { data: updated, error: updateError } = await admin
      .from("expenses")
      .update(updates)
      .eq("id", expenseId)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating expense:", updateError);
      return NextResponse.json({ error: "Error al actualizar el gasto" }, { status: 500 });
    }

    // Audit log entries
    for (const entry of auditEntries) {
      await admin.from("audit_log").insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        entity: "expenses",
        entity_id: expenseId,
        action: "update",
        field: entry.field,
        old_value: entry.old_value,
        new_value: entry.new_value,
      });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Unexpected error in PATCH /api/expenses/[id]:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE /api/expenses/[id] — Delete an expense
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

    // Only admin and abogada can delete expenses
    if (profile.role !== "admin" && profile.role !== "abogada") {
      return NextResponse.json({ error: "No tienes permisos para eliminar gastos" }, { status: 403 });
    }

    const expenseId = params.id;

    // Fetch existing expense (for audit + receipt cleanup)
    const { data: existing } = await admin
      .from("expenses")
      .select("id, amount, concept, date, expense_type, tenant_id, receipt_url, receipt_filename")
      .eq("id", expenseId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
    }

    // If expense has a receipt in storage, delete it
    if (existing.receipt_url) {
      await admin.storage.from("documents").remove([existing.receipt_url]);
    }

    // Delete the expense
    const { error: deleteError } = await admin
      .from("expenses")
      .delete()
      .eq("id", expenseId)
      .eq("tenant_id", profile.tenant_id);

    if (deleteError) {
      console.error("Error deleting expense:", deleteError);
      return NextResponse.json({ error: "Error al eliminar el gasto" }, { status: 500 });
    }

    // Audit log
    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "expenses",
      entity_id: expenseId,
      action: "delete",
      field: null,
      old_value: JSON.stringify({
        amount: existing.amount,
        concept: existing.concept,
        date: existing.date,
        expense_type: existing.expense_type,
      }),
      new_value: null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Unexpected error in DELETE /api/expenses/[id]:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
