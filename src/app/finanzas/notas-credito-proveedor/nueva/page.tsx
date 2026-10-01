import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { listExpenseAccountOptions } from "@/lib/finanzas/queries/business-expenses";
import { listSupplierOptions } from "@/lib/finanzas/queries/suppliers";
import { listTaxCodesActive } from "@/lib/finanzas/queries/catalogs";
import { comprasAbiertasParaNc } from "@/lib/finanzas/queries/notas-credito";
import { cargarCatalogosParaNcDeCompra } from "@/lib/finanzas/api/supplier-credit-notes";
import { NcDeProveedorForm } from "../_components/nc-de-proveedor-form";

export const metadata = {
  title: "Nueva nota de crédito de proveedor · Finanzas",
};

interface PageProps {
  searchParams: { compra?: string };
}

/**
 * `/finanzas/notas-credito-proveedor/nueva`: registrar la NC que dio un
 * proveedor (E8). Es la MISMA pantalla a la que lleva el botón del detalle de
 * la compra, con `?compra=ID`.
 *
 * Admin, abogada y contador (`POST /api/finanzas/supplier-credit-notes`).
 */
export default async function NuevaNcDeProveedorPage({ searchParams }: PageProps) {
  const { db, tenantId, userRole } = await getAuthenticatedContext();
  if (!["admin", "abogada", "contador"].includes(userRole)) {
    redirect("/finanzas");
  }

  const [cuentas, proveedores, taxCodes, compras, catalogos] = await Promise.all([
    listExpenseAccountOptions(db, tenantId),
    listSupplierOptions(db, tenantId),
    listTaxCodesActive(db, tenantId),
    comprasAbiertasParaNc(db, tenantId),
    cargarCatalogosParaNcDeCompra(db, tenantId),
  ]);

  const compraInicial = searchParams.compra && compras.some((c) => c.id === searchParams.compra) ? searchParams.compra : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton
          fallbackHref={compraInicial ? `/finanzas/gastos-bufete/${compraInicial}` : "/finanzas/notas-credito-proveedor"}
          label={compraInicial ? "Volver a la compra" : "Volver a notas de crédito"}
          showLabel
        />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Nueva nota de crédito de proveedor</h1>
          <p className="text-sm text-gray-500">
            Elige el proveedor y, si corresponde, la compra que corrige. Sus líneas se cargan y las puedes editar.
          </p>
        </div>
      </div>

      <NcDeProveedorForm
        proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.trade_name?.trim() || p.legal_name }))}
        compras={compras}
        compraInicial={compraInicial}
        cuentas={cuentas.map((c) => ({ code: c.code, name: c.name, account_type: c.account_type ?? "expense" }))}
        taxCodes={taxCodes}
        tasas={Array.from(catalogos.tasas.entries())}
        cuentasValidas={Array.from(catalogos.cuentasValidas)}
      />
    </div>
  );
}
