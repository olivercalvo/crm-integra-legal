import Link from "next/link";
import { redirect } from "next/navigation";
import { FileMinus, Plus } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { listarNotasDeCredito } from "@/lib/finanzas/queries/notas-credito";
import { NcFeEstadoBadge } from "@/components/finanzas/nc-fe-estado-badge";
import { formatDate } from "@/lib/utils/format-date";
import { fmtImporte } from "@/lib/utils/importe";

export const metadata = {
  title: "Notas de crédito · Finanzas",
};

/**
 * `/finanzas/notas-credito`: el listado de notas de crédito de venta (E8,
 * 01/10/2026). Admin y abogada, los que facturan. El contador sigue entrando
 * sólo al DETALLE de cada una (patrón exacto en `route-access.ts`), desde el
 * Mayor o el Diario.
 */
export default async function NotasDeCreditoPage() {
  const { db, tenantId, userRole } = await getAuthenticatedContext();
  if (!["admin", "abogada"].includes(userRole)) {
    redirect("/finanzas");
  }
  const notas = await listarNotasDeCredito(db, tenantId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-integra-navy">
            <FileMinus size={22} className="text-integra-gold" /> Notas de crédito
          </h1>
          <p className="text-sm text-gray-500">Las notas de crédito de venta, de la más nueva a la más vieja.</p>
        </div>
        <Link
          href="/finanzas/notas-credito/nueva"
          className="inline-flex min-h-[48px] items-center gap-2 rounded-md bg-integra-navy px-4 text-sm font-semibold text-white hover:bg-integra-navy/90"
        >
          <Plus size={16} /> Nueva nota de crédito
        </Link>
      </div>

      {notas.length === 0 ? (
        <div className="rounded-xl border bg-white px-6 py-12 text-center text-sm text-gray-500">
          Todavía no hay notas de crédito.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2">Número</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Factura</th>
                <th className="px-3 py-2">Registro</th>
                <th className="px-3 py-2">DGI</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {notas.map((n) => (
                <tr key={n.id} className={n.status === "anulada" ? "text-gray-400 line-through" : ""}>
                  <td className="px-3 py-2">
                    <Link href={`/finanzas/notas-credito/${n.id}`} className="font-mono font-semibold text-integra-navy hover:underline">
                      {n.credit_note_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{n.client_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{n.invoice_number ?? "Sin factura"}</td>
                  <td className="px-3 py-2">{formatDate(n.accounting_date)}</td>
                  <td className="px-3 py-2">
                    <NcFeEstadoBadge estado={n.fe_estado} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">B/. {fmtImporte(n.grand_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
