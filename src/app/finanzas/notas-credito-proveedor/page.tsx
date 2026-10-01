import Link from "next/link";
import { redirect } from "next/navigation";
import { FileMinus, Plus } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { listarNcDeProveedor } from "@/lib/finanzas/queries/notas-credito";
import { formatDate } from "@/lib/utils/format-date";
import { fmtImporte } from "@/lib/utils/importe";

export const metadata = {
  title: "Notas de crédito de proveedores · Finanzas",
};

/**
 * `/finanzas/notas-credito-proveedor`: las notas de crédito que nos dieron los
 * proveedores (E8). Admin, abogada y contador, los mismos que registran
 * compras (prefijo en `route-access.ts`).
 */
export default async function NcDeProveedoresPage() {
  const { db, tenantId, userRole } = await getAuthenticatedContext();
  if (!["admin", "abogada", "contador"].includes(userRole)) {
    redirect("/finanzas");
  }
  const notas = await listarNcDeProveedor(db, tenantId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-integra-navy">
            <FileMinus size={22} className="text-integra-gold" /> Notas de crédito de proveedores
          </h1>
          <p className="text-sm text-gray-500">Las que registró el bufete, de la más nueva a la más vieja.</p>
        </div>
        <Link
          href="/finanzas/notas-credito-proveedor/nueva"
          className="inline-flex min-h-[48px] items-center gap-2 rounded-md bg-integra-navy px-4 text-sm font-semibold text-white hover:bg-integra-navy/90"
        >
          <Plus size={16} /> Registrar nota de crédito
        </Link>
      </div>

      {notas.length === 0 ? (
        <div className="rounded-xl border bg-white px-6 py-12 text-center text-sm text-gray-500">
          Todavía no hay notas de crédito de proveedores.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2">Número</th>
                <th className="px-3 py-2">Proveedor</th>
                <th className="px-3 py-2">Documento</th>
                <th className="px-3 py-2">Compra</th>
                <th className="px-3 py-2">Registro</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {notas.map((n) => (
                <tr key={n.id} className={n.status === "anulada" ? "text-gray-400 line-through" : ""}>
                  <td className="px-3 py-2">
                    <Link href={`/finanzas/notas-credito-proveedor/${n.id}`} className="font-mono font-semibold text-integra-navy hover:underline">
                      {n.credit_note_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{n.supplier_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{n.supplier_document_number}</td>
                  <td className="px-3 py-2 text-xs">{n.compra ?? "Sin compra"}</td>
                  <td className="px-3 py-2">{formatDate(n.issue_date)}</td>
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
