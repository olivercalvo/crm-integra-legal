import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { getTermsTemplateRow } from "@/lib/finanzas/api/quote-terms";
import { TermsTemplateEditor } from "./_components/terms-template-editor";

/**
 * Pantalla de configuración del módulo Cotizaciones — editor de la plantilla
 * de Términos y Condiciones (D6, D9).
 *
 * Permisos: SOLO admin. Cualquier otro rol → redirect a /finanzas/cotizaciones
 * con toast "Sin permiso" (parámetro ?denied=terms_template).
 *
 * El gate del PUT lo hace el route handler. Acá lo replicamos para no
 * mostrar la pantalla siquiera.
 */
export default async function CotizacionesConfiguracionPage() {
  const ctx = await getAuthenticatedContext();
  if (ctx.userRole !== "admin") {
    redirect("/finanzas/cotizaciones?denied=terms_template");
  }

  const tpl = await getTermsTemplateRow(ctx.db, ctx.tenantId);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton
          fallbackHref="/finanzas/cotizaciones"
          label="Volver a cotizaciones"
          showLabel
        />
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
            <FileText size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-integra-navy">
              Plantilla de Términos y Condiciones
            </h1>
            <p className="text-sm text-gray-500">
              Esta plantilla se aplica automáticamente a cada nueva cotización.
              La abogada puede ajustarla por cotización si lo necesita.
            </p>
          </div>
        </div>
      </div>

      <TermsTemplateEditor
        initialContent={tpl.content}
        initialUpdatedAt={tpl.updated_at}
      />
    </div>
  );
}
