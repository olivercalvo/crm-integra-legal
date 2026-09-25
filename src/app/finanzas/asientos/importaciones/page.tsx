import Link from "next/link";
import { redirect } from "next/navigation";
import { History } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { listarImportaciones } from "@/lib/finanzas/api/importacion-asientos";
import { fmtImporte } from "@/lib/utils/importe";
import { formatDateTime } from "@/lib/utils/format-date";

export const metadata = { title: "Importaciones de asientos · Finanzas" };

const ROLES = ["admin", "contador"];

export default async function ImportacionesPage() {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) redirect("/finanzas");
  const lista = await listarImportaciones(ctx.db, ctx.tenantId);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <BackButton fallbackHref="/finanzas/asientos" label="Volver a asientos" showLabel />
        <div>
          <div className="flex items-center gap-2">
            <History size={22} className="text-integra-gold" />
            <h1 className="font-serif text-2xl text-integra-navy">Importaciones de asientos</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">Cada archivo importado, con sus asientos. Una importación se deshace completa.</p>
        </div>
      </div>

      {lista.length === 0 ? (
        <p className="rounded-xl border bg-white p-6 text-sm text-gray-500">Todavía no se importó ningún archivo.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Archivo</th>
                <th className="px-4 py-2 text-right">Asientos</th>
                <th className="px-4 py-2 text-right">Débitos</th>
                <th className="px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lista.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(i.created_at)}</td>
                  <td className="px-4 py-2">
                    <Link href={`/finanzas/asientos/importaciones/${i.id}`} className="text-integra-navy hover:underline">
                      {i.file_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right">{i.entries_count}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmtImporte(i.total_debits)}</td>
                  <td className="px-4 py-2">
                    {i.status === "reversada" ? (
                      <span className="text-red-700">Deshecha</span>
                    ) : (
                      <span className="text-emerald-700">Contabilizada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
