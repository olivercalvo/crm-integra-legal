import { NextResponse } from "next/server";

import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";
import { cargarCuadreAlCorte } from "@/lib/finanzas/api/apertura";
import { excelDelCuadre } from "@/lib/finanzas/contabilidad/apertura-excel";

export const runtime = "nodejs";

/**
 * GET /api/finanzas/asientos/apertura/cuadre/export: el «Cuadre al corte» en
 * Excel. Los mismos roles que la pantalla (/finanzas/asientos/apertura: admin y
 * contador) y el mismo loader. El tenant sale del perfil.
 */
const ROLES = ["admin", "contador"] as const;

export const GET = conManejoDeAuditoria(async function GET() {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES);
  if (denied) return denied;
  const { fecha, cuadre, conApertura } = await cargarCuadreAlCorte(ctx.db, ctx.tenantId);
  const generado = new Date().toLocaleString("es-PA", { timeZone: "America/Panama" });
  return new NextResponse(new Uint8Array(excelDelCuadre(fecha, cuadre, conApertura, generado)), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cuadre-al-corte-${fecha}.xlsx"`,
    },
  });
});
