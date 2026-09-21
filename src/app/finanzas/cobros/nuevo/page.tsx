import { redirect } from "next/navigation";
import { HandCoins } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { listInvoicesCobrables } from "@/lib/finanzas/queries/payments";
import { listarCuentasDeBanco } from "@/lib/finanzas/queries/tesoreria-para-asiento";
import { previewNextReceiptNumber } from "@/lib/finanzas/numbering/receipt-numbering";
import { NuevoCobroForm } from "./_components/nuevo-cobro-form";

export const metadata = {
  title: "Registrar cobro · Finanzas",
};

interface PageProps {
  searchParams: { client_id?: string; invoice_id?: string };
}

/**
 * `/finanzas/cobros/nuevo` — registrar un recibo de caja sin pasar por la
 * factura. Dos pasos (máximo 5 campos por pantalla): 1) cliente y factura,
 * 2) los datos del cobro. El paso 2 son los MISMOS campos que el diálogo del
 * detalle de la factura (`PaymentFormFields`), y el POST va a la misma ruta.
 *
 * Se cargan de una vez todas las facturas cobrables del bufete: el selector
 * de clientes ofrece solo a quienes tienen algo que cobrar, y cambiar de
 * cliente no hace otro fetch.
 */
export default async function NuevoCobroPage({ searchParams }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(ctx.userRole)) {
    redirect("/finanzas/cobros");
  }
  const { db, tenantId } = ctx;

  const [cobrables, bancos, proximo] = await Promise.all([
    listInvoicesCobrables(db, tenantId),
    listarCuentasDeBanco(db, tenantId),
    previewNextReceiptNumber(db, tenantId),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/finanzas/cobros" label="Volver a cobros" showLabel />
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
            <HandCoins size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-integra-navy">Registrar cobro</h1>
            <p className="text-sm text-gray-500">
              {proximo ? `Próximo recibo: ${proximo}` : "Recibo de caja"}
            </p>
          </div>
        </div>
      </div>

      <NuevoCobroForm
        cobrables={cobrables}
        bancos={bancos}
        initialClientId={searchParams.client_id ?? ""}
        initialInvoiceId={searchParams.invoice_id ?? ""}
      />
    </div>
  );
}
