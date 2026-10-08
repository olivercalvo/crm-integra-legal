import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import {
  listClientsActive,
  listServicesActive,
  listTaxCodesActive,
} from "@/lib/finanzas/queries/catalogs";
import { InvoiceForm } from "../_components/invoice-form";
import { facturasAjustables } from "@/lib/finanzas/queries/invoices";
import type { CaseOption } from "@/lib/finanzas/types/invoice";


/**
 * El título de la pestaña. Sin esto el navegador muestra "CRM Integra Legal" en
 * todas, y con seis pestañas abiertas no se distingue cuál es cuál.
 */
export const metadata = {
  title: "Nueva factura · Finanzas",
};
interface PageProps {
  searchParams: { client_id?: string; case_id?: string };
}

/**
 * Crear factura nueva. Pre-fill desde searchParams (útil para deep-link
 * desde detalle de cliente o caso).
 *
 * Cargamos TODOS los casos del tenant agrupados por client_id — son ~pocas
 * decenas, y queremos UX instantánea al cambiar de cliente sin nuevo fetch.
 */
export default async function NuevaFacturaPage({ searchParams }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    redirect("/finanzas/facturas");
  }
  const { db, tenantId } = ctx;

  const [clients, services, taxCodes, casesRes, ajustables] = await Promise.all([
    listClientsActive(db, tenantId),
    listServicesActive(db, tenantId),
    listTaxCodesActive(db, tenantId),
    db
      .from("cases")
      .select("id, case_code, description, client_id")
      .eq("tenant_id", tenantId)
      .order("case_code"),
    facturasAjustables(db, tenantId),
  ]);

  const allCases = (casesRes.data ?? []) as CaseOption[];
  const casesByClient: Record<string, CaseOption[]> = {};
  for (const c of allCases) {
    if (!casesByClient[c.client_id]) casesByClient[c.client_id] = [];
    casesByClient[c.client_id].push(c);
  }

  // «Facturar este caso» (requerimiento 13): ?case_id= precarga el caso y su
  // cliente; ?client_id= sólo el cliente. Sólo si el cliente está activo (los
  // que se pueden facturar) y el caso es suyo; si no, el formulario arranca vacío.
  const casoPedido = searchParams.case_id ? allCases.find((c) => c.id === searchParams.case_id) ?? null : null;
  const clientePedido = casoPedido?.client_id ?? searchParams.client_id ?? null;
  const clienteValido = clientePedido && clients.some((c) => c.id === clientePedido) ? clientePedido : null;
  const inicial = { clientId: clienteValido, caseId: clienteValido && casoPedido ? casoPedido.id : null };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/finanzas/facturas" label="Volver a facturas" showLabel />
      </div>

      <InvoiceForm
        mode="create"
        subtitulo="Completa los datos y guarda como borrador. La numeración se asigna al emitir."
        inicial={inicial}
        clients={clients}
        casesByClient={casesByClient}
        services={services}
        taxCodes={taxCodes}
        facturasAjustables={ajustables}
      />

    </div>
  );
}
