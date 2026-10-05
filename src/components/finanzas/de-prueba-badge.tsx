import { FlaskConical } from "lucide-react";
import { AVISO_DE_PRUEBA, ETIQUETA_DE_PRUEBA } from "@/lib/finanzas/documentos-de-prueba";

/** Badge «Prueba» de un documento marcado (094). No cuenta en ningún reporte. */
export function DePruebaBadge() {
  return (
    <span
      title={AVISO_DE_PRUEBA}
      className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
    >
      <FlaskConical size={12} />
      {ETIQUETA_DE_PRUEBA}
    </span>
  );
}

/** Banda del detalle de un documento marcado de prueba. */
export function DePruebaBanda({ motivo }: { motivo?: string | null }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-gray-300 bg-gray-100 px-4 py-3 text-sm text-gray-800">
      <FlaskConical size={16} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">{AVISO_DE_PRUEBA}</p>
        {motivo && <p className="mt-1 text-gray-600">{motivo}</p>}
      </div>
    </div>
  );
}
