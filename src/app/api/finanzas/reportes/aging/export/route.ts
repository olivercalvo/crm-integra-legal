import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { loadAntiguedad, type TipoAntiguedad } from "@/lib/finanzas/reports/antiguedad-source";
import { buildAntiguedad } from "@/lib/finanzas/reports/antiguedad";
import { resolverTercerosDeDocumentos, resolverTercerosDeLineas } from "@/lib/finanzas/reports/tercero-fiscal";
import { hojaDeAntiguedad } from "@/lib/finanzas/reports/mayor-export";
import { generarXlsx, nombreDeArchivo } from "@/lib/finanzas/reports/exportar-xlsx";
import { REPORT_FIRM_NAME, formatGeneratedAt } from "@/app/finanzas/reportes/_components/report-meta";
import { conManejoDeAuditoria } from "@/lib/auditoria/error-de-auditoria";

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

export const GET = conManejoDeAuditoria(async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const tipo: TipoAntiguedad = sp.get("tipo") === "pagar" ? "pagar" : "cobrar";

  try {
    const { documentos, control } = await loadAntiguedad(ctx.db, ctx.tenantId, tipo);
    const reporte = buildAntiguedad(documentos, control);

    // E9: una partida de diario no es un documento (su id es "asiento:tercero",
    // no un uuid) y se resuelve por el tercero de la línea, con la misma
    // función del Mayor. Mezclarla con los documentos rompería esa consulta.
    const partidas = documentos.filter((d) => d.entryId);
    const prefijo = tipo === "cobrar" ? "cliente:" : "proveedor:";
    const [terceros, deLineas] = await Promise.all([
      resolverTercerosDeDocumentos(
        ctx.db,
        ctx.tenantId,
        tipo,
        documentos.filter((d) => !d.entryId).map((d) => d.id)
      ),
      resolverTercerosDeLineas(
        ctx.db,
        ctx.tenantId,
        partidas.map((d) => (d.terceroId ? `${prefijo}${d.terceroId}` : null))
      ),
    ]);
    for (const d of partidas) {
      const t = d.terceroId ? deLineas.get(`${prefijo}${d.terceroId}`) : undefined;
      if (t) terceros.set(d.id, t);
    }

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
});
