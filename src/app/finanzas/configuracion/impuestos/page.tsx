import { redirect } from "next/navigation";
import { Percent, Info } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { listTaxCodes } from "@/lib/finanzas/api/tax-codes";
import { TaxCodesManager } from "./_components/tax-codes-manager";

// Ver: los tres roles de finanzas. Editar: admin y contador — mismo criterio
// que la clasificación contable de una cuenta. Ver el encabezado de la ruta PATCH.
const FINANZAS_ROLES = ["admin", "abogada", "contador"];
const ROLES_EDICION = ["admin", "contador"];

export const metadata = {
  title: "Impuestos · Finanzas",
};

export default async function ImpuestosPage() {
  const ctx = await getAuthenticatedContext();
  if (!FINANZAS_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const taxCodes = await listTaxCodes(ctx.db, ctx.tenantId);
  const canEdit = ROLES_EDICION.includes(ctx.userRole);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
          <Percent size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">Impuestos</h1>
          <p className="text-sm text-gray-500">
            {taxCodes.length === 0
              ? "Sin impuestos configurados"
              : `${taxCodes.length} código${taxCodes.length === 1 ? "" : "s"} de impuesto`}
          </p>
        </div>
      </div>

      {/* Lo que hay que decir ANTES de que alguien cambie una tasa y se pregunte
          por qué las facturas viejas no cambiaron. */}
      <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-800">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          La tasa se aplica a los documentos que se creen <strong>a partir del cambio</strong>.
          Las facturas y cotizaciones ya emitidas conservan la tasa que tenían: cada línea
          guarda la suya, y así debe ser — un documento refleja la ley vigente el día que se
          emitió.
        </p>
      </div>

      <TaxCodesManager taxCodes={taxCodes} canEdit={canEdit} />

      {!canEdit && (
        <p className="text-xs text-gray-500">
          Solo el administrador o el contador pueden modificar las tasas.
        </p>
      )}
    </div>
  );
}
