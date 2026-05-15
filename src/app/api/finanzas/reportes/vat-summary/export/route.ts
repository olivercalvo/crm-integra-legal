import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import {
  getVatSummary,
  isValidMonthParam,
} from "@/lib/finanzas/reports/vat-summary";
import { generateVatSummaryXlsxBuffer } from "@/lib/finanzas/reports/vat-summary-xlsx";
import { generateVatSummaryPdfBuffer } from "@/lib/finanzas/pdf/generate-vat-summary-pdf";

/**
 * GET /api/finanzas/reportes/vat-summary/export?month=YYYY-MM&format=xlsx|pdf
 *
 * Permisos: admin + abogada + contador (mismo gating que la página de VAT
 * Summary). Asistente queda fuera de /finanzas por middleware.
 *
 * El runtime es Node.js porque tanto @react-pdf/renderer como xlsx requieren
 * APIs que no están en edge runtime.
 */
export const runtime = "nodejs";

const READING_ROLES = ["admin", "abogada", "contador"] as const;

export async function GET(request: NextRequest) {
  const ctx = await getAuthenticatedContext();
  if (!READING_ROLES.includes(ctx.userRole as (typeof READING_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const month = sp.get("month")?.trim() ?? "";
  const format = (sp.get("format") ?? "xlsx").toLowerCase();

  if (!isValidMonthParam(month)) {
    return NextResponse.json(
      { error: "Parámetro 'month' inválido o futuro (esperado YYYY-MM)" },
      { status: 400 }
    );
  }

  if (format !== "xlsx" && format !== "pdf") {
    return NextResponse.json(
      { error: "Parámetro 'format' inválido (use xlsx o pdf)" },
      { status: 400 }
    );
  }

  try {
    const result = await getVatSummary(ctx.db, {
      tenantId: ctx.tenantId,
      month,
    });

    const filename = `VAT_Summary_${month}.${format}`;

    if (format === "xlsx") {
      const buffer = generateVatSummaryXlsxBuffer(result);
      const body = new Uint8Array(buffer);
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store, max-age=0",
        },
      });
    }

    // format === "pdf"
    const buffer = await generateVatSummaryPdfBuffer({ result });
    const body = new Uint8Array(buffer);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("[finanzas] vat-summary export failed:", err);
    return NextResponse.json(
      { error: "Error al generar el reporte" },
      { status: 500 }
    );
  }
}
