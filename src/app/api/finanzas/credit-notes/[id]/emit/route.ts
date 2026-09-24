import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { emitCreditNoteToEfactura } from "@/lib/finanzas/efactura/orchestration/emit-credit-note-to-efactura";
import { MutationError } from "@/lib/finanzas/api/errors";

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/finanzas/credit-notes/[id]/emit
 *
 * Manda la nota de crédito a la DGI (`tipoDocumento = 04`) con el bloque
 * `documentosFiscalesReferenciados` apuntando al CUFE de la factura que
 * corrige. Hasta que esto corre, la NC es un documento INTERNO (D1).
 *
 * 🔴 Si la factura no tiene CUFE, responde 409 y no toca el correlativo: una
 * NC que no se puede referenciar no es un envío que falla, es un envío que no
 * se hace. El mensaje distingue los dos casos —cargar el CUFE del portal, o
 * consultar con administración— porque son dos acciones distintas de la
 * persona que lo lee.
 *
 * Permisos: admin + abogada, los mismos que emiten la NC contable. El contador
 * la VE y baja su PDF, pero no la emite: misma línea que en todo el módulo.
 *
 * Sin body.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const result = await emitCreditNoteToEfactura(
      ctx.db,
      ctx.tenantId,
      ctx.userId,
      params.id
    );
    // 200 incluso cuando el PAC rechazó: el envío OCURRIÓ y quedó registrado
    // en `fe_emisiones`. El `ok` del cuerpo dice cómo terminó. Un 5xx acá
    // haría que la pantalla lo trate como "no pasó nada", que es falso.
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MutationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api] POST credit-notes/[id]/emit failed", err);
    return NextResponse.json(
      { error: "No se pudo enviar la nota de crédito a la DGI" },
      { status: 500 }
    );
  }
}
