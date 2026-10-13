import { redirect } from "next/navigation";
import { Truck } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { fechaCorta } from "@/lib/finanzas/contabilidad/inicio-contable";
import { rangoDelMes } from "@/lib/finanzas/contabilidad/posteo-retroactivo";
import { listarGastosSinAsiento } from "@/lib/finanzas/api/asignaciones-documentos";
import { cuentasClasificables, cuentasSugeridasParaTramite } from "@/lib/finanzas/contabilidad/cuentas-de-gasto";
import type { AccountType } from "@/lib/finanzas/types/chart-of-account";
import { AsignarGastos } from "../_components/asignar-gastos";

export const metadata = { title: "Proveedores y cuentas · Documentos existentes" };

/** Admin y contador, como la ruta (ROLES). */
const ROLES = ["admin", "contador"];

export default async function AsignarGastosPage({ searchParams }: { searchParams: { mes?: string; sel?: string } }) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) redirect("/finanzas");
  const mes = /^\d{4}-\d{2}$/.test(searchParams.mes ?? "") ? searchParams.mes! : "2026-07";
  const { desde, hasta } = rangoDelMes(mes);

  const [gastos, proveedores, cuentas] = await Promise.all([
    listarGastosSinAsiento(ctx.db, ctx.tenantId, desde, hasta),
    ctx.db.from("suppliers").select("id, legal_name, supplier_number").eq("tenant_id", ctx.tenantId).eq("active", true).order("legal_name"),
    ctx.db.from("chart_of_accounts").select("code, name, account_type, active").eq("tenant_id", ctx.tenantId).eq("active", true).order("code"),
  ]);
  const plan = (cuentas.data ?? []) as { code: string; name: string; account_type: AccountType; active: boolean }[];
  const sugeridas = cuentasSugeridasParaTramite(plan).map((c) => c.code);
  const opcionesCuenta = cuentasClasificables(plan).map((c) => ({ code: c.code, name: c.name, sugerida: sugeridas.includes(c.code) }));

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <BackButton fallbackHref={`/finanzas/asientos/documentos-existentes?mes=${mes}`} label="Volver al mes" showLabel />
        <div>
          <div className="flex items-center gap-2">
            <Truck size={22} className="text-integra-gold" />
            <h1 className="font-serif text-2xl text-integra-navy">Proveedores y cuentas de los gastos de trámite</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Gastos de trámite del {fechaCorta(desde)} al {fechaCorta(hasta)} que todavía no están en el libro contable. Para
            contabilizarlos, cada uno necesita su proveedor y cada línea su cuenta. Marca varios y asígnales lo mismo de una vez.
            Un gasto que ya está en el libro no aparece y no se toca.
          </p>
        </div>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="mes" className="mb-1 block text-xs font-medium">Mes</label>
          <input id="mes" name="mes" type="month" defaultValue={mes} className="min-h-[44px] rounded-md border border-gray-300 px-3 text-sm" />
        </div>
        <button type="submit" className="min-h-[44px] rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-integra-navy">Ver el mes</button>
      </form>
      <AsignarGastos
        gastos={gastos}
        proveedores={((proveedores.data ?? []) as { id: string; legal_name: string; supplier_number: string | null }[]).map((p) => ({
          id: p.id, nombre: `${p.legal_name}${p.supplier_number ? ` (${p.supplier_number})` : ""}`,
        }))}
        cuentas={opcionesCuenta}
        seleccionado={searchParams.sel ?? null}
      />
    </div>
  );
}
