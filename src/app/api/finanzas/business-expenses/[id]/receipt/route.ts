import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/jpg",
  "application/pdf",
];

const MUTATING_ROLES = ["admin", "contador"] as const;

/**
 * POST /api/finanzas/business-expenses/[id]/receipt
 *
 * Sube un comprobante para un gasto del bufete. Reusa el bucket "documents"
 * con prefix "business-expenses/{id}/{timestamp}_{filename}".
 * Si ya había un receipt, lo borra antes de subir el nuevo.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole as (typeof MUTATING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const expenseId = params.id;

  const { data: expense } = await ctx.db
    .from("business_expenses")
    .select("id, receipt_url, tenant_id")
    .eq("id", expenseId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  if (!expense) {
    return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No se envió ningún archivo" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "El archivo excede el tamaño máximo de 10MB" },
      { status: 400 }
    );
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Tipo de archivo no permitido. Use JPG, PNG o PDF." },
      { status: 400 }
    );
  }

  // Borrar el receipt anterior si existe (consistente con expenses legacy).
  if (expense.receipt_url) {
    await ctx.db.storage.from("documents").remove([expense.receipt_url as string]);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${ctx.tenantId}/business-expenses/${expenseId}/${Date.now()}_${safeName}`;

  const buffer = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await ctx.db.storage
    .from("documents")
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[finanzas] business-expense receipt upload failed:", uploadError);
    return NextResponse.json({ error: "Error al subir el archivo" }, { status: 500 });
  }

  const { error: updateError } = await ctx.db
    .from("business_expenses")
    .update({
      receipt_url: storagePath,
      receipt_filename: file.name,
    })
    .eq("id", expenseId)
    .eq("tenant_id", ctx.tenantId);

  if (updateError) {
    console.error("[finanzas] business-expense receipt update failed:", updateError);
    return NextResponse.json(
      { error: "Error al guardar la referencia del comprobante" },
      { status: 500 }
    );
  }

  await ctx.db.from("audit_log").insert({
    tenant_id: ctx.tenantId,
    user_id: ctx.userId,
    entity: "business_expenses",
    entity_id: expenseId,
    action: "update",
    field: "receipt",
    old_value: (expense.receipt_url as string | null) ?? null,
    new_value: storagePath,
  });

  return NextResponse.json(
    { receipt_url: storagePath, receipt_filename: file.name },
    { status: 201 }
  );
}

/**
 * DELETE /api/finanzas/business-expenses/[id]/receipt
 *
 * Elimina el comprobante asociado (storage + referencia en la fila).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole as (typeof MUTATING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const expenseId = params.id;

  const { data: expense } = await ctx.db
    .from("business_expenses")
    .select("id, receipt_url, tenant_id")
    .eq("id", expenseId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  if (!expense) {
    return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
  }
  if (!expense.receipt_url) {
    return NextResponse.json(
      { error: "Este gasto no tiene comprobante adjunto" },
      { status: 400 }
    );
  }

  await ctx.db.storage.from("documents").remove([expense.receipt_url as string]);

  await ctx.db
    .from("business_expenses")
    .update({ receipt_url: null, receipt_filename: null })
    .eq("id", expenseId)
    .eq("tenant_id", ctx.tenantId);

  await ctx.db.from("audit_log").insert({
    tenant_id: ctx.tenantId,
    user_id: ctx.userId,
    entity: "business_expenses",
    entity_id: expenseId,
    action: "update",
    field: "receipt",
    old_value: expense.receipt_url as string,
    new_value: null,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
