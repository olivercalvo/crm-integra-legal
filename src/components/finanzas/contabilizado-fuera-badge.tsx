import { Archive } from "lucide-react";
import {
  ETIQUETA_CONTABILIZADO_FUERA,
  explicacionContabilizadoFuera,
} from "@/lib/finanzas/contabilidad/inicio-contable";

/**
 * Badge «Contabilizado fuera» (096): documento anterior al inicio contable. Está
 * en los libros del contador (QuickBooks), no en el libro del CRM. Sigue
 * contando en la antigüedad y el estado de cuenta.
 */
export function ContabilizadoFueraBadge({ inicio }: { inicio: string }) {
  return (
    <span
      title={explicacionContabilizadoFuera(inicio)}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
    >
      <Archive size={12} />
      {ETIQUETA_CONTABILIZADO_FUERA}
    </span>
  );
}

/** Banda del detalle: dice por qué el documento no tiene asiento. */
export function ContabilizadoFueraBanda({ inicio }: { inicio: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800">
      <Archive size={16} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">{ETIQUETA_CONTABILIZADO_FUERA}</p>
        <p className="mt-1 text-slate-600">
          {explicacionContabilizadoFuera(inicio)} Sigue contando en la antigüedad de saldos y en el
          estado de cuenta.
        </p>
      </div>
    </div>
  );
}
