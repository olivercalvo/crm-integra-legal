import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { fechaCorta } from "@/lib/finanzas/contabilidad/inicio-contable";
import { rangoDelMes } from "@/lib/finanzas/contabilidad/posteo-retroactivo";
import { listarCobrosSinAsiento } from "@/lib/finanzas/api/asignaciones-documentos";
import { listarCuentasDeBanco } from "@/lib/finanzas/queries/tesoreria-para-asiento";
import { AsignarBancos } from "../_components/asignar-bancos";

export const metadata = { title: "Bancos de los cobros · Documentos existentes" };

/** Admin y contador, como la ruta (ROLES). */
const ROLES = ["admin", "contador"];

export default async function AsignarBancosPage({ searchParams }: { searchParams: { mes?: string; sel?: string } }) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) redirect("/finanzas");
  const mes = /^\d{4}-\d{2}$/.test(searchParams.mes ?? "") ? searchParams.mes! : "2026-07";
  const { desde, hasta } = rangoDelMes(mes);
  const [cobros, bancos] = await Promise.all([
    listarCobrosSinAsiento(ctx.db, ctx.tenantId, desde, hasta),
    listarCuentasDeBanco(ctx.db, ctx.tenantId),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <BackButton fallbackHref={`/finanzas/asientos/documentos-existentes?mes=${mes}`} label="Volver al mes" showLabel />
        <div>
          <div className="flex items-center gap-2">
            <Landmark size={22} className="text-integra-gold" />
            <h1 className="font-serif text-2xl text-integra-navy">Bancos de los cobros</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Cobros del {fechaCorta(desde)} al {fechaCorta(hasta)} que todavía no están en el libro contable. Para contabilizarlos,
            cada uno necesita el banco donde entró la plata. Marca varios y asígnales el mismo banco de una vez. Un cobro que ya
            está en el libro no aparece y no se toca.
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
      <AsignarBancos cobros={cobros} bancos={bancos} seleccionado={searchParams.sel ?? null} />
    </div>
  );
}
