import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * El aviso «N documentos sin autorización de la DGI» (03/10/2026). Va arriba de
 * todo y no se muestra en cero: es una alarma, no una columna. Lo usan el
 * listado de facturas, el hub de reportes y el dashboard Legal (la abogada ve
 * sólo los suyos).
 */
export function AvisoPendientesDgi({ cantidad, soloMios = false }: { cantidad: number; soloMios?: boolean }) {
  if (cantidad <= 0) return null;
  const plural = cantidad !== 1;
  return (
    <Link
      href="/finanzas/pendientes-dgi"
      className="flex items-center gap-3 rounded-lg border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-900 hover:bg-red-100"
    >
      <AlertTriangle size={18} className="shrink-0 text-red-600" />
      <span className="flex-1">
        <span className="font-semibold">
          {cantidad} documento{plural ? "s" : ""} {soloMios ? (plural ? "tuyos " : "tuyo ") : ""}sin autorización de la DGI:
        </span>
        <span className="ml-1">
          {plural ? "están emitidos y no llegaron" : "está emitido y no llegó"} a la DGI, o la DGI no {plural ? "los aceptó" : "lo aceptó"}.
        </span>
      </span>
      <span className="shrink-0 font-semibold underline">Ver cuáles</span>
    </Link>
  );
}
