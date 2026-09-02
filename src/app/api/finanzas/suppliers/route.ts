import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { validateCreateSupplier } from "@/lib/finanzas/validators/supplier";
import { createSupplier } from "@/lib/finanzas/api/suppliers";
import { listSuppliers } from "@/lib/finanzas/queries/suppliers";
import { previewNextSupplierNumber } from "@/lib/finanzas/numbering/supplier-numbering";
import { MutationError } from "@/lib/finanzas/api/errors";

/**
 * Proveedores. Mismos roles que gastos del bufete: admin, abogada y contador.
 * El asistente ya queda fuera de /finanzas por middleware; se rechaza igual acá
 * por defensa en profundidad, que es la regla del repo.
 */
const ROLES = ["admin", "abogada", "contador"] as const;

function sinPermiso(rol: string): boolean {
  return !ROLES.includes(rol as (typeof ROLES)[number]);
}

/** GET /api/finanzas/suppliers */
export async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (sinPermiso(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const activeRaw = sp.get("active");
  const active = activeRaw === "true" ? true : activeRaw === "false" ? false : null;

  const rows = await listSuppliers(ctx.db, ctx.tenantId, {
    active,
    search: sp.get("q") || null,
  });

  return NextResponse.json(
    { rows, nextNumber: await previewNextSupplierNumber(ctx.db, ctx.tenantId) },
    { status: 200 }
  );
}

/** POST /api/finanzas/suppliers */
export async function POST(request: NextRequest) {
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

  const validation = validateCreateSupplier(
    body as Parameters<typeof validateCreateSupplier>[0]
  );
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validación fallida", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  try {
    const result = await createSupplier(ctx.db, ctx.tenantId, ctx.userId, validation.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof MutationError) {
      console.error("[finanzas] createSupplier failed:", err.message, err.detail);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] createSupplier unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
