import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import {
  listClientsActive,
  listServicesActive,
  listTaxCodesActive,
} from "@/lib/finanzas/queries/catalogs";
import { getTermsTemplate } from "@/lib/finanzas/api/quote-terms";
import { listObservationTemplatesActive } from "@/lib/finanzas/queries/observation-templates";
import { QuoteForm } from "../_components/quote-form";
import type { CaseOption } from "@/lib/finanzas/types/invoice";

/**
 * Crear cotización nueva.
 *
 * Permisos: admin, abogada, contador (D8). Asistente queda fuera vía
 * middleware antes de llegar acá; verificamos igual para defensa en
 * profundidad.
 *
 * Cargamos catálogos en paralelo + el template T&C del tenant para
 * pre-poblar el textarea del form.
 */
export default async function NuevaCotizacionPage() {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada", "contador"].includes(ctx.userRole)) {
    redirect("/finanzas/cotizaciones");
  }
  const { db, tenantId } = ctx;

  const [clients, services, taxCodes, casesRes, defaultTerms, observationTemplates] =
    await Promise.all([
      listClientsActive(db, tenantId),
      listServicesActive(db, tenantId),
      listTaxCodesActive(db, tenantId),
      db
        .from("cases")
        .select("id, case_code, description, client_id")
        .eq("tenant_id", tenantId)
        .order("case_code"),
      getTermsTemplate(db, tenantId),
      listObservationTemplatesActive(db, tenantId),
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
        <BackButton fallbackHref="/finanzas/cotizaciones" label="Volver a cotizaciones" showLabel />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Nueva cotización</h1>
          <p className="text-sm text-gray-500">
            Completa los datos del cliente, las líneas y los términos.
            La cotización se emite con un número COT-NNNNNN al guardar.
          </p>
        </div>
      </div>

      <QuoteForm
        mode="create"
        clients={clients}
        casesByClient={casesByClient}
        services={services}
        taxCodes={taxCodes}
        defaultTerms={defaultTerms}
        observationTemplates={observationTemplates}
      />
    </div>
  );
}
