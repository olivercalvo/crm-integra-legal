import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import {
  listClientsActive,
  listServicesActive,
  listTaxCodesActive,
} from "@/lib/finanzas/queries/catalogs";
import { InvoiceForm } from "../_components/invoice-form";
import type { CaseOption } from "@/lib/finanzas/types/invoice";

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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/finanzas/facturas" label="Volver a facturas" showLabel />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Nueva factura</h1>
          <p className="text-sm text-gray-500">
            Completa los datos y guarda como borrador. La numeración se asigna al emitir.
          </p>
        </div>
      </div>

      <InvoiceForm
        mode="create"
        clients={clients}
        casesByClient={casesByClient}
        services={services}
        taxCodes={taxCodes}
      />

      {/* Pre-fill suave desde searchParams.
          Reemplazo aquí sería pasar valores iniciales — lo dejo simple en
          este MVP: el usuario selecciona manualmente. Evita prop drilling
          con un wrapper inicial. */}
      {(searchParams.client_id || searchParams.case_id) && null}
    </div>
  );
}
