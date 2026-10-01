import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { listClientsActive, listServicesActive, listTaxCodesActive } from "@/lib/finanzas/queries/catalogs";
import { facturasAbiertasParaNc } from "@/lib/finanzas/queries/notas-credito";
import { NotaDeCreditoForm } from "../_components/nota-de-credito-form";

export const metadata = {
  title: "Nueva nota de crédito · Finanzas",
};

interface PageProps {
  searchParams: { factura?: string };
}

/**
 * `/finanzas/notas-credito/nueva`: el alta de una NC de venta (E8). Es la MISMA
 * pantalla a la que lleva el botón «Nota de crédito» del detalle de la factura,
 * con `?factura=ID` para traerla precargada: un solo formulario.
 *
 * Admin y abogada (`POST /api/finanzas/credit-notes` tiene la misma lista).
 */
export default async function NuevaNotaDeCreditoPage({ searchParams }: PageProps) {
  const { db, tenantId, userRole } = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(userRole)) {
    redirect("/finanzas");
  }

  const [clients, services, taxCodes, facturas, periodos] = await Promise.all([
    listClientsActive(db, tenantId),
    listServicesActive(db, tenantId),
    listTaxCodesActive(db, tenantId),
    facturasAbiertasParaNc(db, tenantId),
    db.from("accounting_periods").select("year, month").eq("tenant_id", tenantId).eq("status", "cerrado"),
  ]);

  // D4: si el mes de REGISTRO de la factura está cerrado, la pantalla lo dice.
  const cerrados = new Set(
    ((periodos.data ?? []) as { year: number; month: number }[]).map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`)
  );
  const mesesCerrados = facturas.filter((f) => cerrados.has(f.accounting_date.slice(0, 7))).map((f) => f.id);

  // Un cliente con una factura abierta pero ya inactivo igual tiene que poder
  // recibir su NC: se suma a la lista.
  const ids = new Set(clients.map((c) => c.id));
  const faltan = Array.from(new Set(facturas.map((f) => f.client_id).filter((id) => !ids.has(id))));
  let todos = clients;
  if (faltan.length > 0) {
    const { data } = await db
      .from("clients")
      .select("id, name, client_number, default_payment_terms_days, ruc")
      .eq("tenant_id", tenantId)
      .in("id", faltan);
    todos = [...clients, ...((data ?? []) as typeof clients)];
  }

  const facturaInicial = searchParams.factura && facturas.some((f) => f.id === searchParams.factura) ? searchParams.factura : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton
          fallbackHref={facturaInicial ? `/finanzas/facturas/${facturaInicial}` : "/finanzas/notas-credito"}
          label={facturaInicial ? "Volver a la factura" : "Volver a notas de crédito"}
          showLabel
        />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Nueva nota de crédito</h1>
          <p className="text-sm text-gray-500">
            Elige el cliente y la factura que corrige. Sus líneas se cargan y las puedes editar.
          </p>
        </div>
      </div>

      <NotaDeCreditoForm
        clients={todos}
        services={services}
        taxCodes={taxCodes}
        facturas={facturas}
        facturaInicial={facturaInicial}
        mesesCerrados={mesesCerrados}
      />
    </div>
  );
}
