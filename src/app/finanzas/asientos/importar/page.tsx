import { redirect } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { ImportarAsientos } from "./_components/importar-asientos";

export const metadata = { title: "Importar asientos · Finanzas" };

/** 7.5: importar asientos desde Excel. Admin y contador, como el asiento manual. */
const ROLES = ["admin", "contador"];

export default async function ImportarAsientosPage() {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) redirect("/finanzas");
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <BackButton fallbackHref="/finanzas/asientos" label="Volver a asientos" showLabel />
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={22} className="text-integra-gold" />
            <h1 className="font-serif text-2xl text-integra-navy">Importar asientos desde Excel</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Descarga la plantilla, complétala y súbela. Nada se registra hasta que confirmes la vista previa, y si
            hay un solo error no se registra nada.
          </p>
        </div>
      </div>
      <ImportarAsientos />
    </div>
  );
}
