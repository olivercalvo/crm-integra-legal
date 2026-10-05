import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { listClientsActive, listServicesActive, listTaxCodesActive } from "@/lib/finanzas/queries/catalogs";
import { FacturaExternaForm } from "../_components/factura-externa-form";

export const metadata = {
  title: "Registrar factura emitida fuera · Finanzas",
};

/**
 * Alta de una factura emitida fuera del CRM (092). Admin y contador: el gate
 * real es ADMIN_CONTADOR_ONLY_PREFIXES; esto es la defensa en profundidad.
 */
export default async function NuevaFacturaExternaPage() {
  const ctx = await getAuthenticatedContext();
  if (!["admin", "contador"].includes(ctx.userRole)) {
    redirect("/finanzas");
  }
  const { db, tenantId } = ctx;
  const [clients, services, taxCodes] = await Promise.all([
    listClientsActive(db, tenantId),
    listServicesActive(db, tenantId),
    listTaxCodesActive(db, tenantId),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/finanzas/facturas-externas" label="Volver" showLabel />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Registrar factura emitida fuera</h1>
          <p className="text-sm text-gray-500">
            Una factura que la DGI ya autorizó desde QuickBooks o el portal de facturación.
          </p>
        </div>
      </div>
      <FacturaExternaForm clients={clients} services={services} taxCodes={taxCodes} />
    </div>
  );
}
