import Link from "next/link";
import { redirect } from "next/navigation";
import { FileInput, Plus } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { listarFacturasExternas } from "@/lib/finanzas/api/facturas-externas";
import { NOMBRE_DE_PUNTO } from "@/lib/finanzas/efactura/cufe/leer-cufe";
import { InvoiceStatusBadge } from "@/components/finanzas/invoice-status-badge";
import { formatDate } from "@/lib/utils/format-date";
import { fmtImporte } from "@/lib/utils/importe";

export const metadata = {
  title: "Facturas emitidas fuera · Finanzas",
};

/**
 * `/finanzas/facturas-externas`: las facturas que la DGI autorizó desde otro
 * punto (QuickBooks 050, portal 100) y se registraron en el CRM con su CUFE
 * (migración `092`). Admin y contador (ADMIN_CONTADOR_ONLY_PREFIXES).
 * El detalle de cada una es el de cualquier factura.
 */
export default async function FacturasExternasPage() {
  const { db, tenantId, userRole } = await getAuthenticatedContext();
  if (!["admin", "contador"].includes(userRole)) {
    redirect("/finanzas");
  }
  const facturas = await listarFacturasExternas(db, tenantId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-integra-navy">
            <FileInput size={22} className="text-integra-gold" /> Facturas emitidas fuera del CRM
          </h1>
          <p className="text-sm text-gray-500">
            Autorizadas por la DGI desde QuickBooks o el portal de facturación, y registradas acá con su CUFE.
            No se envían a la DGI desde el CRM.
          </p>
        </div>
        <Link
          href="/finanzas/facturas-externas/nueva"
          className="inline-flex min-h-[48px] items-center gap-2 rounded-md bg-integra-navy px-4 text-sm font-semibold text-white hover:bg-integra-navy/90"
        >
          <Plus size={16} /> Registrar factura emitida fuera
        </Link>
      </div>

      {facturas.length === 0 ? (
        <div className="rounded-xl border bg-white px-6 py-12 text-center text-sm text-gray-500">
          Todavía no hay facturas emitidas fuera registradas.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2">Número</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Documento ante la DGI</th>
                <th className="px-3 py-2">Fecha del documento</th>
                <th className="px-3 py-2">Fecha de registro</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {facturas.map((f) => (
                <tr key={f.id}>
                  <td className="px-3 py-2">
                    <Link href={`/finanzas/facturas/${f.id}`} className="font-mono font-semibold text-integra-navy hover:underline">
                      {f.invoice_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{f.client_name}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="font-mono">
                      {f.punto_facturacion}-{f.numero_documento}
                    </span>
                    {f.punto_facturacion && NOMBRE_DE_PUNTO[f.punto_facturacion] ? (
                      <span className="text-gray-500"> · {NOMBRE_DE_PUNTO[f.punto_facturacion]}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{formatDate(f.issue_date)}</td>
                  <td className="px-3 py-2">{formatDate(f.accounting_date)}</td>
                  <td className="px-3 py-2">
                    <InvoiceStatusBadge status={f.status as never} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">B/. {fmtImporte(f.grand_total)}</td>
                  <td className="px-3 py-2 text-right font-mono">B/. {fmtImporte(f.balance_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
