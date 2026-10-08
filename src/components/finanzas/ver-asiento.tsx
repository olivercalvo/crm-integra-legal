import Link from "next/link";
import { BookOpenCheck } from "lucide-react";
import type { AsientoDelDocumento } from "@/lib/finanzas/queries/asiento-del-documento";

/**
 * «Ver asiento» en el detalle de un documento (requerimiento 5, 07/10/2026):
 * el asiento que generó, con enlace al detalle del asiento.
 *
 * El enlace sólo para admin y contador: /finanzas/asientos es de ellos
 * (ADMIN_CONTADOR_ONLY_PREFIXES). La abogada ve el número sin enlace, que es
 * lo mismo que ya ve en el Diario. Sin asiento no se muestra nada: cada detalle
 * ya explica por qué (contabilizado fuera, de prueba, borrador…).
 */
export function VerAsiento({ asiento, puedeAbrir }: { asiento: AsientoDelDocumento | null; puedeAbrir: boolean }) {
  if (!asiento) return null;
  const texto = `Asiento N.º ${asiento.entryNumber}`;
  return puedeAbrir ? (
    <>
      {/* nav-guard-ok: `puedeAbrir` es admin|contador, los mismos del prefijo
          /finanzas/asientos en route-access.ts. */}
      <Link
        href={`/finanzas/asientos/${asiento.id}`}
        className="inline-flex min-h-[48px] items-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-integra-navy hover:border-integra-navy"
        title="Abrir el asiento que generó este documento"
      >
        <BookOpenCheck size={16} />
        Ver asiento
        <span className="font-mono text-xs text-gray-500">N.º {asiento.entryNumber}</span>
      </Link>
    </>
  ) : (
    <span className="inline-flex min-h-[48px] items-center gap-2 text-sm text-gray-600">
      <BookOpenCheck size={16} />
      {texto}
    </span>
  );
}
