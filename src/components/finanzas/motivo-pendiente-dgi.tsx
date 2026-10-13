import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { formatDateTime } from "@/lib/utils/format-date";

/**
 * El motivo guardado (085) por el que el documento no se emitió o no llegó a la
 * DGI. Se ve al reabrir el documento, no sólo una vez en pantalla (03/10/2026).
 */
export function MotivoPendienteDgi({ motivo, en }: { motivo: string | null | undefined; en?: string | null }) {
  if (!motivo) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border-l-4 border-red-500 bg-red-50 p-4 text-sm text-red-900">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
      <div className="space-y-1">
        <p className="font-semibold">Pendiente ante la DGI</p>
        <p className="whitespace-pre-line">{motivo}</p>
        <p className="text-xs text-red-700">
          {en ? `Registrado el ${formatDateTime(en)}. ` : ""}
          Todos los pendientes están en{" "}
          <Link href="/finanzas/pendientes-dgi" className="font-semibold underline">
            Pendientes DGI
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
