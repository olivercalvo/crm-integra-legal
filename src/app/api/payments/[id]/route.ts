import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// PATCH /api/payments/[id] — Update a payment
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

    if (profile.role !== "admin" && profile.role !== "abogada") {
      return NextResponse.json({ error: "No tienes permisos para editar pagos" }, { status: 403 });
    }

    const paymentId = params.id;

    const { data: existing } = await admin
      .from("client_payments")
      .select("id, amount, description, payment_date, payment_type, tenant_id, receipt_url, receipt_filename")
      .eq("id", paymentId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
    }

    const body = await request.json();
    const { amount, description, payment_date, receipt_url, receipt_filename } = body;

    const updates: Record<string, unknown> = {};
    const auditEntries: { field: string; old_value: string | null; new_value: string | null }[] = [];

    if (amount !== undefined && amount !== existing.amount) {
      if (typeof amount !== "number" || amount <= 0) {
        return NextResponse.json({ error: "El monto debe ser mayor a 0" }, { status: 400 });
      }
      updates.amount = amount;
      auditEntries.push({ field: "amount", old_value: String(existing.amount), new_value: String(amount) });
    }

    if (description !== undefined && (description ?? "").trim() !== (existing.description ?? "")) {
      updates.description = description ? description.trim() : null;
      auditEntries.push({ field: "description", old_value: existing.description, new_value: updates.description as string | null });
    }

    if (payment_date !== undefined && payment_date !== existing.payment_date) {
      updates.payment_date = payment_date;
      auditEntries.push({ field: "payment_date", old_value: existing.payment_date, new_value: payment_date });
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
      .from("client_payments")
      .update(updates)
      .eq("id", paymentId)
      .eq("tenant_id", profile.tenant_id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating payment:", updateError);
      return NextResponse.json({ error: "Error al actualizar el pago" }, { status: 500 });
    }

    for (const entry of auditEntries) {
      await admin.from("audit_log").insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        entity: "client_payments",
        entity_id: paymentId,
        action: "update",
        field: entry.field,
        old_value: entry.old_value,
        new_value: entry.new_value,
      });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Unexpected error in PATCH /api/payments/[id]:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE /api/payments/[id] — Delete a payment
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
      return NextResponse.json({ error: "No tienes permisos para eliminar pagos" }, { status: 403 });
    }

    const paymentId = params.id;

    const { data: existing } = await admin
      .from("client_payments")
      .select("id, amount, description, payment_date, payment_type, tenant_id, receipt_url")
      .eq("id", paymentId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
    }

    // If payment has a receipt in storage, delete it
    if (existing.receipt_url) {
      await admin.storage.from("documents").remove([existing.receipt_url]);
    }

    const { error: deleteError } = await admin
      .from("client_payments")
      .delete()
      .eq("id", paymentId)
      .eq("tenant_id", profile.tenant_id);

    if (deleteError) {
      console.error("Error deleting payment:", deleteError);
      return NextResponse.json({ error: "Error al eliminar el pago" }, { status: 500 });
    }

    await admin.from("audit_log").insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      entity: "client_payments",
      entity_id: paymentId,
      action: "delete",
      field: null,
      old_value: JSON.stringify({
        amount: existing.amount,
        description: existing.description,
        payment_date: existing.payment_date,
        payment_type: existing.payment_type,
      }),
      new_value: null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Unexpected error in DELETE /api/payments/[id]:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
