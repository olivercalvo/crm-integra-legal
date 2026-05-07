import { redirect, notFound } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import {
  listClientsActive,
  listServicesActive,
  listTaxCodesActive,
} from "@/lib/finanzas/queries/catalogs";
import { getInvoiceById } from "@/lib/finanzas/queries/invoices";
import { isEditable, type CaseOption, type InvoiceLineInput } from "@/lib/finanzas/types/invoice";
import { InvoiceForm } from "../../_components/invoice-form";

interface PageProps {
  params: { id: string };
}

/**
 * Editar factura. Solo borradores; otros estados redirigen al detalle.
 * Reusa InvoiceForm con mode='edit' y carga las líneas existentes con su
 * id real para que el diff de updateInvoice funcione.
 */
export default async function EditarFacturaPage({ params }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    redirect("/finanzas/facturas");
  }
  const { db, tenantId } = ctx;

  const invoice = await getInvoiceById(db, tenantId, params.id);
  if (!invoice) notFound();
  if (!isEditable(invoice.status)) {
    redirect(`/finanzas/facturas/${invoice.id}`);
  }

  const [clients, services, taxCodes, casesRes] = await Promise.all([
    listClientsActive(db, tenantId),
    listServicesActive(db, tenantId),
    listTaxCodesActive(db, tenantId),
    db
      .from("cases")
      .select("id, case_code, description, client_id")
      .eq("tenant_id", tenantId)
      .order("case_code"),
  ]);

  const allCases = (casesRes.data ?? []) as CaseOption[];
  const casesByClient: Record<string, CaseOption[]> = {};
  for (const c of allCases) {
    if (!casesByClient[c.client_id]) casesByClient[c.client_id] = [];
    casesByClient[c.client_id].push(c);
  }

  // Mapear las líneas persistidas al shape del form (con _key client-side).
  const formLines: InvoiceLineInput[] = invoice.lines.map((ln, idx) => ({
    _key: `existing-${ln.id}`,
    id: ln.id,
    service_id: ln.service_id,
    description: ln.description,
    quantity: Number(ln.quantity),
    unit_price: Number(ln.unit_price),
    tax_code_id: ln.tax_code_id ?? "",
    tax_code: ln.tax_code,
    tax_rate: Number(ln.tax_rate),
    // line_order se reasigna en updateInvoice por idx, no lo trackeamos
    // como parte del input.
    ...{ line_order: idx },
  })) as InvoiceLineInput[];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton
          fallbackHref={`/finanzas/facturas/${invoice.id}`}
          label="Volver al detalle"
          showLabel
        />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Editar factura</h1>
          <p className="text-sm text-gray-500">
            Modifica los datos del borrador. Al guardar, los totales se
            recalculan automáticamente.
          </p>
        </div>
      </div>

      <InvoiceForm
        mode="edit"
        clients={clients}
        casesByClient={casesByClient}
        services={services}
        taxCodes={taxCodes}
        initial={{
          id: invoice.id,
          invoice_kind: invoice.invoice_kind,
          client_id: invoice.client_id,
          case_id: invoice.case_id,
          issue_date: invoice.issue_date,
          due_date: invoice.due_date,
          notes: invoice.notes,
          lines: formLines,
        }}
      />
    </div>
  );
}
