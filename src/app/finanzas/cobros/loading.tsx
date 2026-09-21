import { Loader2 } from "lucide-react";

/** Loading state global para /finanzas/cobros* (lista, detalle, nueva, editar). */
export default function Loading() {
  return (
    <div className="flex items-center justify-center py-16 text-gray-500">
      <Loader2 size={28} className="animate-spin text-integra-gold" />
      <span className="ml-3 text-sm">Cargando cobros…</span>
    </div>
  );
}
