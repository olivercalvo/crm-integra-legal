import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Truck, AlertTriangle } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Button } from "@/components/ui/button";
import { listSuppliers, proveedoresConRucRepetido } from "@/lib/finanzas/queries/suppliers";
import { previewNextSupplierNumber } from "@/lib/finanzas/numbering/supplier-numbering";
import { SupplierList } from "./_components/supplier-list";
import { SupplierFilters } from "./_components/supplier-filters";

const ROLES = ["admin", "abogada", "contador"];

export const metadata = {
  title: "Proveedores · Finanzas",
};

interface PageProps {
  searchParams: { q?: string; active?: string };
}

export default async function ProveedoresPage({ searchParams }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const search = searchParams.q?.trim() ?? "";
  const active =
    searchParams.active === "true" ? true : searchParams.active === "false" ? false : null;

  const [proveedores, rucRepetidos, proximoNumero] = await Promise.all([
    listSuppliers(ctx.db, ctx.tenantId, { active, search }),
    proveedoresConRucRepetido(ctx.db, ctx.tenantId),
    previewNextSupplierNumber(ctx.db, ctx.tenantId),
  ]);

  const conRucRepetido = proveedores.filter((p) => rucRepetidos.has(p.id)).length;
  const sinRuc = proveedores.filter((p) => !p.ruc).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-integra-navy">
            <Truck size={24} />
            Proveedores
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {proveedores.length} proveedor{proveedores.length === 1 ? "" : "es"}
            {proximoNumero && (
              <>
                {" · "}el próximo será <span className="font-mono">{proximoNumero}</span>
              </>
            )}
          </p>
        </div>

        <Button asChild className="min-h-[48px]">
          <Link href="/finanzas/proveedores/nuevo">
            <Plus size={18} className="mr-1.5" />
            Nuevo proveedor
          </Link>
        </Button>
      </div>

      {/* ───────────────────────────────────────────────────────────────────
          Por qué el RUC importa tanto acá, con las palabras de Josuarth.
          Quien entra a esta pantalla a cargar datos tiene que saber para qué
          sirven, o los deja incompletos.
          ─────────────────────────────────────────────────────────────────── */}
      <p className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-800">
        El <strong>RUC y el DV van en columnas separadas</strong> porque así los pide el
        formulario de la DGI: los anexos de la declaración de renta se arman con el RUC de cada
        proveedor en una columna y su dígito verificador en otra. El{" "}
        <strong>plazo de pago</strong> es lo que define el vencimiento de cada gasto, y de ahí
        salen los tramos de la antigüedad de cuentas por pagar.
      </p>

      {(sinRuc > 0 || conRucRepetido > 0) && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {sinRuc > 0 && (
              <>
                <strong>
                  {sinRuc} proveedor{sinRuc === 1 ? "" : "es"} sin RUC cargado
                </strong>
                . Los anexos de renta lo necesitan.
              </>
            )}
            {sinRuc > 0 && conRucRepetido > 0 && " "}
            {conRucRepetido > 0 && (
              <>
                <strong>{conRucRepetido} comparten RUC con otro</strong>. Puede ser el mismo
                proveedor cargado dos veces: el sistema no los une solo porque unir de más no
                tiene vuelta atrás.
              </>
            )}
          </span>
        </div>
      )}

      <SupplierFilters search={search} active={searchParams.active ?? ""} />

      {proveedores.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <p className="text-base font-medium text-integra-navy">
            {search ? "Ningún proveedor coincide con la búsqueda" : "Todavía no hay proveedores"}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {search
              ? "Probá con otro texto o limpiá el filtro."
              : "Los proveedores se crean acá y después se eligen al cargar un gasto del bufete."}
          </p>
        </div>
      ) : (
        <SupplierList proveedores={proveedores} rucRepetidos={rucRepetidos} />
      )}
    </div>
  );
}
