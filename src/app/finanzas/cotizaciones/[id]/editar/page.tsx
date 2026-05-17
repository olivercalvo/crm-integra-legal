import { redirect, notFound } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { getQuoteById } from "@/lib/finanzas/queries/quotes";
import { getTermsTemplate } from "@/lib/finanzas/api/quote-terms";
import {
  listClientsActive,
  listServicesActive,
  listTaxCodesActive,
} from "@/lib/finanzas/queries/catalogs";
import { listObservationTemplatesActive } from "@/lib/finanzas/queries/observation-templates";
import { QuoteForm } from "../../_components/quote-form";
import type { QuoteLineEditorInput } from "../../_components/quote-lines-editor";
import type { CaseOption } from "@/lib/finanzas/types/invoice";

interface PageProps {
  params: { id: string };
}

/**
 * Editar cotización en borrador o emitida.
 *
 * Post-hot-fix QUOTES-FLOW: editable = 'borrador' (legacy) | 'emitida'
 * (default). T5b-quote enforza también server-side la inmutabilidad de
 * líneas cuando el padre está fuera de estos estados. Si la cotización
 * está en otro estado redirigimos al detalle (no usamos toast porque
 * sería un edge inalcanzable desde el flujo normal: el botón Editar
 * solo se renderiza si el estado lo permite).
 */
export default async function EditarCotizacionPage({ params }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada", "contador"].includes(ctx.userRole)) {
    redirect("/finanzas/cotizaciones");
  }
  const { db, tenantId } = ctx;

  const quote = await getQuoteById(db, tenantId, params.id);
  if (!quote) notFound();

  if (quote.status !== "borrador" && quote.status !== "emitida") {
    redirect(`/finanzas/cotizaciones/${params.id}`);
  }

  // Cargar catálogos para el form (no necesitamos el default template
  // porque el quote ya tiene un snapshot de T&C).
  const [clients, services, taxCodes, casesRes, defaultTermsFallback, observationTemplates] =
    await Promise.all([
      listClientsActive(db, tenantId),
      listServicesActive(db, tenantId),
      listTaxCodesActive(db, tenantId),
      db
        .from("cases")
        .select("id, case_code, description, client_id")
        .eq("tenant_id", tenantId)
        .order("case_code"),
      // Fallback por si la cotización tiene terms_and_conditions=null (legacy).
      getTermsTemplate(db, tenantId),
      listObservationTemplatesActive(db, tenantId),
    ]);

  const allCases = (casesRes.data ?? []) as CaseOption[];
  const casesByClient: Record<string, CaseOption[]> = {};
  for (const c of allCases) {
    if (!casesByClient[c.client_id]) casesByClient[c.client_id] = [];
    casesByClient[c.client_id].push(c);
  }

  // Convertir líneas del modelo BD al modelo del editor. El line_order de
  // BD no se preserva — al re-insertar, updateQuote() asigna idx+1 según el
  // orden del array que mandemos. Ordenamos por line_order BD para conservar
  // la secuencia que ve la abogada.
  const initialLines: QuoteLineEditorInput[] = quote.lines.map((ln) => ({
    _key: `existing-${ln.id}`,
    id: ln.id,
    invoice_kind: ln.invoice_kind,
    service_id: ln.service_id ?? null,
    description: ln.description,
    quantity: Number(ln.quantity),
    unit_price: Number(ln.unit_price),
    tax_code_id: ln.tax_code_id ?? "",
    tax_code: ln.tax_code,
    tax_rate: Number(ln.tax_rate),
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton
          fallbackHref={`/finanzas/cotizaciones/${quote.id}`}
          label="Volver al detalle"
          showLabel
        />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">
            Editar{" "}
            <span className="font-mono">{quote.quote_number}</span>
          </h1>
          <p className="text-sm text-gray-500">
            Cambios permitidos en estado borrador o emitida. El cliente no
            se puede cambiar — para eso, cancela y crea una cotización
            nueva.
          </p>
        </div>
      </div>

      <QuoteForm
        mode="edit"
        clients={clients}
        casesByClient={casesByClient}
        services={services}
        taxCodes={taxCodes}
        defaultTerms={defaultTermsFallback}
        observationTemplates={observationTemplates}
        initial={{
          id: quote.id,
          client_id: quote.client_id,
          case_id: quote.case_id,
          issue_date: quote.issue_date,
          valid_until: quote.valid_until,
          title: quote.title,
          notes: quote.notes,
          observations: quote.observations,
          terms_and_conditions: quote.terms_and_conditions ?? defaultTermsFallback,
          lines: initialLines,
        }}
      />
    </div>
  );
}
