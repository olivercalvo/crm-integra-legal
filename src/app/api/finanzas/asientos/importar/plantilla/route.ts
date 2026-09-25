import { NextResponse } from "next/server";
import { getAuthenticatedContext, requireRole } from "@/lib/supabase/server-query";
import { generarPlantillaDeAsientos } from "@/lib/finanzas/import/asientos-workbook";

export const runtime = "nodejs";

/** GET /api/finanzas/asientos/importar/plantilla: la plantilla, con el plan activo. */
const ROLES_ASIENTO_MANUAL = ["admin", "contador"] as const;

export async function GET() {
  const ctx = await getAuthenticatedContext();
  const denied = requireRole(ctx.userRole, ROLES_ASIENTO_MANUAL);
  if (denied) return denied;
  const { data } = await ctx.db
    .from("chart_of_accounts")
    .select("code, name, account_type")
    .eq("tenant_id", ctx.tenantId)
    .eq("active", true)
    .order("code");
  const buf = generarPlantillaDeAsientos((data ?? []) as { code: string; name: string; account_type: string }[]);
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-asientos.xlsx"',
    },
  });
}
