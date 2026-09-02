import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { loadAntiguedad, type TipoAntiguedad } from "@/lib/finanzas/reports/antiguedad-source";
import { buildAntiguedad } from "@/lib/finanzas/reports/antiguedad";
import { resolverTercerosDeDocumentos } from "@/lib/finanzas/reports/tercero-fiscal";
import { hojaDeAntiguedad } from "@/lib/finanzas/reports/mayor-export";
import { generarXlsx, nombreDeArchivo } from "@/lib/finanzas/reports/exportar-xlsx";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "@/app/finanzas/reportes/_components/report-meta";

/**
 * GET /api/finanzas/reportes/aging/export?tipo=cobrar|pagar
 *
 * La antigüedad en Excel, con el mismo motor que el mayor. Salió gratis: el
 * reporte ya estaba detallado por documento, que es la forma en que una planilla
 * sirve para algo, y las columnas de tercero son las mismas.
 *
 * 🔒 Mismos tres candados que el export del mayor: el rol se verifica acá, el
 * `tenant_id` sale del perfil y no del request, y se exporta exactamente lo que
 * arma la pantalla, con su mismo loader y su mismo builder.
 */
export const runtime = "nodejs";

const ROLES = ["admin", "abogada", "contador"] as const;

export async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const tipo: TipoAntiguedad = sp.get("tipo") === "pagar" ? "pagar" : "cobrar";

  try {
    const { documentos, control } = await loadAntiguedad(ctx.db, ctx.tenantId, tipo);
    const reporte = buildAntiguedad(documentos, control);

    const terceros = await resolverTercerosDeDocumentos(
      ctx.db,
      ctx.tenantId,
      tipo,
      documentos.map((d) => d.id)
    );

    const buffer = generarXlsx([
      hojaDeAntiguedad(reporte, tipo, terceros, {
        bufete: REPORT_FIRM_NAME,
        generadoEl: formatGeneratedAt(),
      }),
    ]);

    const filename = `${nombreDeArchivo([
      "Antiguedad",
      tipo === "cobrar" ? "Cuentas_por_Cobrar" : "Cuentas_por_Pagar",
      new Date().toISOString().slice(0, 10),
    ])}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("[finanzas] export de la antigüedad falló:", err);
    return NextResponse.json({ error: "Error al generar el archivo" }, { status: 500 });
  }
}
