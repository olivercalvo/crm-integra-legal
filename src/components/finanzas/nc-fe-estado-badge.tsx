import { Badge } from "@/components/ui/badge";
import { FE_ESTADO_LABEL, type FeEstado } from "@/lib/finanzas/types/invoice";

/**
 * El estado fiscal de una NOTA DE CRÉDITO (Bloque 5, D1).
 *
 * Igual que `FeEstadoBadge` de la factura, con una diferencia deliberada: en
 * `no_emitida` la NC no dice "Sin enviar" en gris, dice **"Sin emitir a la
 * DGI"** en ámbar. Una factura sin enviar es lo normal mientras se prepara;
 * una NC contable sin autorización de la DGI es un documento INTERNO que no
 * vale como comprobante fiscal, y la pantalla tiene que decirlo donde se lea.
 */
export function NcFeEstadoBadge({ estado }: { estado: string }) {
  if (estado === "no_emitida") {
    return (
      <Badge
        variant="outline"
        className="border-amber-300 bg-amber-50 font-medium text-amber-800"
        title="Documento interno: la DGI todavía no autorizó esta nota de crédito"
      >
        Sin emitir a la DGI
      </Badge>
    );
  }
  const cls =
    estado === "authorized"
      ? "bg-green-50 text-green-700 border-green-200"
      : estado === "pending"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : estado === "error"
          ? "bg-red-50 text-red-700 border-red-200"
          : "bg-gray-50 text-gray-500 border-gray-200";
  return (
    <Badge variant="outline" className={`${cls} font-medium`}>
      {FE_ESTADO_LABEL[estado as FeEstado] ?? estado}
    </Badge>
  );
}
