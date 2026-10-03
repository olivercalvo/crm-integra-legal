import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { getAncla } from "@/lib/finanzas/queries/anclas";
import { generateConstanciaDeCierrePdfBuffer } from "@/lib/finanzas/pdf/generate-constancia-de-cierre-pdf";
import { formatDateTime } from "@/lib/utils/format-date";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";

export const runtime = "nodejs";

/** Los mismos de `/finanzas/periodos` (página y PATCH): admin y contador. */
const ROLES = ["admin", "contador"];

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
  "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/**
 * GET /api/finanzas/periodos/anclas/[id]/pdf
 *
 * La constancia de cierre (075, R-1b) que el contador guarda FUERA del sistema.
 * El tenant sale del perfil; un ancla de otro bufete da 404.
 */
export const GET = conManejoDeAuditoria(async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const ancla = await getAncla(ctx.db, ctx.tenantId, params.id);
  if (!ancla) return NextResponse.json({ error: "Ancla no encontrada" }, { status: 404 });

  const { data: tenant } = await ctx.db.from("tenants").select("name").eq("id", ctx.tenantId).maybeSingle();
  const periodo =
    ancla.origen === "cierre" && ancla.year && ancla.month
      ? `${MESES[ancla.month - 1]} ${ancla.year}`
      : "Ancla inicial (al activar las anclas)";

  const buf = await generateConstanciaDeCierrePdfBuffer({
    bufete: (tenant as { name?: string } | null)?.name ?? "Integra Legal",
    periodo,
    entryNumber: ancla.entry_number,
    hash: ancla.hash,
    ancladoEl: formatDateTime(ancla.anchored_at),
    ancladoPor: null,
    generadoEl: formatDateTime(new Date()),
  });
  const nombre =
    ancla.origen === "cierre" && ancla.year && ancla.month
      ? `constancia-cierre-${ancla.year}-${String(ancla.month).padStart(2, "0")}.pdf`
      : `constancia-ancla-inicial.pdf`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombre}"`,
    },
  });
});
