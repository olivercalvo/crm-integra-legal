import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import {
  createSupplierCreditNote,
  validarPedidoDeNcDeCompra,
} from "@/lib/finanzas/api/supplier-credit-notes";
import { MutationError } from "@/lib/finanzas/api/errors";

export const runtime = "nodejs";

/**
 * POST /api/finanzas/supplier-credit-notes
 *
 * Registra la nota de crédito que un PROVEEDOR nos dio sobre una compra (3.5,
 * migración `066`). Número NCP-, NC, líneas y asiento en UNA transacción.
 *
 * Permisos: admin, abogada y contador, los mismos `MUTATING_ROLES` de las
 * compras y sus pagos (el contador tiene CRUD de compras). Asistente → 403.
 */
const MUTATING_ROLES = ["admin", "abogada", "contador"] as const;

export async function POST(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!MUTATING_ROLES.includes(ctx.userRole as (typeof MUTATING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const v = validarPedidoDeNcDeCompra(body);
  if (!v.ok) {
    return NextResponse.json({ error: "Validación fallida", fieldErrors: v.errors }, { status: 400 });
  }

  try {
    const r = await createSupplierCreditNote(
      ctx.db,
      // 🔑 SOP-014: el RPC va con el cliente de SERVICIO; el tenant, del perfil.
      createAdminClient(),
      ctx.tenantId,
      ctx.userId,
      v.data
    );
    return NextResponse.json(r, { status: 201 });
  } catch (err) {
    if (err instanceof MutationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[finanzas] createSupplierCreditNote unexpected error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
