import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { getCreditNoteById } from "@/lib/finanzas/api/credit-notes";
import { generateCreditNotePdfBuffer } from "@/lib/finanzas/pdf/generate-credit-note-pdf";
import type { CreditNoteDocumentProps } from "@/lib/finanzas/pdf/CreditNoteDocument";

interface RouteParams {
  params: { id: string };
}

// React-PDF requiere runtime nodejs.
export const runtime = "nodejs";
// La generación puede tardar 1-2 segundos.
export const maxDuration = 30;

const ALLOWED_ROLES = ["admin", "abogada", "contador"] as const;

/**
 * GET /api/finanzas/credit-notes/[id]/pdf
 *
 * Genera el PDF de la nota de crédito on-demand y lo devuelve inline. NO
 * cachea (volumen bajo, regenerar es barato).
 *
 * Permisos: admin/abogada/contador del tenant. Asistente queda fuera.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const ctx = await getAuthenticatedContext();
  if (!ALLOWED_ROLES.includes(ctx.userRole as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const cn = await getCreditNoteById(ctx.db, ctx.tenantId, params.id);
  if (!cn) {
    return NextResponse.json(
      { error: "Nota de crédito no encontrada" },
      { status: 404 }
    );
  }

  // Cast: getCreditNoteById devuelve un objeto plano sin tipado estricto.
  const cnData = cn as unknown as {
    credit_note_number: string;
    issue_date: string;
    reason: string;
    subtotal_total: string | number;
    tax_total: string | number;
    grand_total: string | number;
    invoice: {
      invoice_number: string;
      invoice_kind: "HONORARIOS" | "REEMBOLSO";
      issue_date: string;
    } | null;
    client: {
      name: string;
      client_number: string;
      ruc: string | null;
    } | null;
    lines: Array<{
      line_order: number;
      description: string;
      quantity: string | number;
      unit_price: string | number;
      tax_code: string;
      tax_rate: string | number;
      line_total: string | number;
    }>;
  };

  if (!cnData.invoice || !cnData.client) {
    return NextResponse.json(
      { error: "Datos de NC inconsistentes (falta factura o cliente)" },
      { status: 500 }
    );
  }

  const props: CreditNoteDocumentProps = {
    credit_note_number: cnData.credit_note_number,
    issue_date: cnData.issue_date,
    reason: cnData.reason,
    client: {
      name: cnData.client.name,
      client_number: cnData.client.client_number,
      ruc: cnData.client.ruc,
    },
    invoice: {
      invoice_number: cnData.invoice.invoice_number,
      invoice_kind: cnData.invoice.invoice_kind,
      issue_date: cnData.invoice.issue_date,
    },
    lines: cnData.lines.map((ln) => ({
      line_order: ln.line_order,
      description: ln.description,
      qty: Number(ln.quantity),
      unit_price: Number(ln.unit_price),
      tax_code: ln.tax_code,
      tax_rate: Number(ln.tax_rate),
      line_total: Number(ln.line_total),
    })),
    subtotal_total: Number(cnData.subtotal_total),
    tax_total: Number(cnData.tax_total),
    grand_total: Number(cnData.grand_total),
    generated_at_label: new Date().toLocaleString("es-PA", {
      timeZone: "America/Panama",
    }),
    generated_by_label: ctx.userName ?? "",
  };

  try {
    const buffer = await generateCreditNotePdfBuffer(props);
    const fileName = `${cnData.credit_note_number}.pdf`;
    // Convertimos el Node Buffer a Uint8Array (BodyInit-compatible).
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[finanzas/pdf] credit-note generate failed", err);
    return NextResponse.json(
      { error: "No se pudo generar el PDF" },
      { status: 500 }
    );
  }
}
