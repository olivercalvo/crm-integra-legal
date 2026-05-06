import { Receipt } from "lucide-react";

/**
 * Placeholder Fase 1 — la lista real con filtros se implementa en Fase 2.
 * Mantenido para que `/finanzas/facturas` no devuelva 404 mientras se itera.
 */
export default function FacturasIndexPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-integra-gold/40 bg-white p-12 text-center">
      <Receipt size={40} className="mb-3 text-integra-gold" />
      <h1 className="text-2xl font-bold text-integra-navy">Facturas</h1>
      <p className="mt-2 text-sm text-gray-500">
        El listado se habilita en la siguiente fase.
      </p>
    </div>
  );
}
