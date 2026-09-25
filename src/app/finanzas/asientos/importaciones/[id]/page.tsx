import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, XCircle } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { cargarAsientosDeImportacion, getImportacion } from "@/lib/finanzas/api/importacion-asientos";
import { fmtImporte } from "@/lib/utils/importe";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { DeshacerImportacion } from "./_components/deshacer-importacion";

export const metadata = { title: "Importación de asientos · Finanzas" };

const ROLES = ["admin", "contador"];

export default async function ImportacionPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { registrada?: string };
}) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) redirect("/finanzas");
  const imp = await getImportacion(ctx.db, ctx.tenantId, params.id);
  if (!imp) notFound();
  const asientos = await cargarAsientosDeImportacion(ctx.db, ctx.tenantId, params.id);
  const deshecha = imp.status === "reversada";

  return (
    <div className="space-y-5">
      {searchParams?.registrada === "1" && !deshecha && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>
            Importación contabilizada: {imp.entries_count} asiento{imp.entries_count === 1 ? "" : "s"} por B/. {fmtImporte(imp.total_debits)}.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <BackButton fallbackHref="/finanzas/asientos/importaciones" label="Volver a importaciones" showLabel />
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet size={22} className="text-integra-gold" />
              <h1 className="font-serif text-2xl text-integra-navy">{imp.file_name}</h1>
              {deshecha ? (
                <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">Deshecha</span>
              ) : (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Contabilizada</span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Importada el {formatDateTime(imp.created_at)} · identificador <span className="font-mono">{imp.id}</span>
            </p>
          </div>
        </div>
        {!deshecha && <DeshacerImportacion importId={imp.id} cantidad={asientos.filter((a) => a.reversado_por === null).length} />}
      </div>

      {deshecha && (
        <div role="note" className="flex items-start gap-3 rounded-md border-l-4 border-red-500 bg-red-50 p-4 text-sm text-red-900">
          <XCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Importación deshecha el {imp.reversed_at ? formatDateTime(imp.reversed_at) : ""}.</p>
            <p>Cada asiento quedó reversado con la fecha de ese día. Motivo: {imp.reversal_reason}</p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-2">Asiento del libro</th>
              <th className="px-4 py-2">En el Excel</th>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Descripción</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2">Reversión</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {asientos.map((a) => (
              <tr key={a.asiento.id}>
                <td className="px-4 py-2">
                  {/* nav-guard-ok: esta pantalla y el detalle del asiento son de admin y contador. */}
                  <Link href={`/finanzas/asientos/${a.asiento.id}`} className="font-mono text-integra-navy hover:underline">
                    {a.asiento.entry_number}
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-600">
                  {a.group_label} (fila {a.first_row})
                </td>
                <td className="px-4 py-2">{formatDate(a.asiento.transaction_date)}</td>
                <td className="px-4 py-2">{a.asiento.description}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtImporte(a.total)}</td>
                <td className="px-4 py-2 text-xs">
                  {a.reversado_por !== null ? <span className="text-red-700">Asiento {a.reversado_por}</span> : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
