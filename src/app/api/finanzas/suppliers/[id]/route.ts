import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { validateUpdateSupplier } from "@/lib/finanzas/validators/supplier";
import { updateSupplier, deleteSupplier } from "@/lib/finanzas/api/suppliers";
import { getSupplier } from "@/lib/finanzas/queries/suppliers";
import { MutationError } from "@/lib/finanzas/api/errors";

const ROLES = ["admin", "abogada", "contador"] as const;

function sinPermiso(rol: string): boolean {
  return !ROLES.includes(rol as (typeof ROLES)[number]);
}

/** GET /api/finanzas/suppliers/[id] */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  if (sinPermiso(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  // El permiso se verifica acá, no se confía en que el id sea difícil de adivinar:
  // getSupplier filtra por tenant_id, así que el id de otro bufete da 404.
  const supplier = await getSupplier(ctx.db, ctx.tenantId, params.id);
  if (!supplier) {
    return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }
  return NextResponse.json(supplier, { status: 200 });
}

/** PATCH /api/finanzas/suppliers/[id] */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  if (sinPermiso(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const validation = validateUpdateSupplier(
    body as Parameters<typeof validateUpdateSupplier>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await updateSupplier(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      params.id,
      validation.data
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] updateSupplier failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] updateSupplier unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

/** DELETE /api/finanzas/suppliers/[id] */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  if (sinPermiso(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const result = await deleteSupplier(ctx.db, ctx.tenantId, ctx.userId, params.id);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof MutationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] deleteSupplier unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
