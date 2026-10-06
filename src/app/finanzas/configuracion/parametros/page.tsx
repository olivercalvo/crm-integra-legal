import { redirect } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { cargarInicioContable } from "@/lib/finanzas/contabilidad/inicio-contable";
import { InicioContableCard } from "./_components/inicio-contable-card";

// Ver: los tres roles de finanzas. Editar: admin y contador, el mismo criterio
// que las tasas y la clasificación contable de una cuenta. Tiene que coincidir
// con `ROLES_ESCRITURA` de `/api/finanzas/configuracion/inicio-contable`.
const FINANZAS_ROLES = ["admin", "abogada", "contador"];
const ROLES_EDICION = ["admin", "contador"];

export const metadata = {
  title: "Parámetros contables · Finanzas",
};

export default async function ParametrosContablesPage() {
  const ctx = await getAuthenticatedContext();
  if (!FINANZAS_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }
  const fecha = await cargarInicioContable(ctx.db, ctx.tenantId);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
          <SlidersHorizontal size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Parámetros contables</h1>
          <p className="text-sm text-gray-500">Datos del bufete que deciden qué entra al libro</p>
        </div>
      </div>

      <InicioContableCard fecha={fecha} canEdit={ROLES_EDICION.includes(ctx.userRole)} />
    </div>
  );
}
