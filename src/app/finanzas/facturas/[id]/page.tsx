import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Receipt, User, FolderOpen, Calendar, FileText } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";
import { InvoiceStatusBadge } from "@/components/finanzas/invoice-status-badge";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { getInvoiceById } from "@/lib/finanzas/queries/invoices";
import { previewNextInvoiceNumber } from "@/lib/finanzas/api/invoices";
import {
  INVOICE_KIND_LABEL,
  isEditable,
  isEmittable,
  isDeletable,
} from "@/lib/finanzas/types/invoice";
import { EmitInvoiceDialog } from "../_components/emit-invoice-dialog";
import { DeleteInvoiceButton } from "../_components/delete-invoice-button";

interface PageProps {
  params: { id: string };
}

export default async function FacturaDetallePage({ params }: PageProps) {
  const { db, tenantId } = await getAuthenticatedContext();
  const invoice = await getInvoiceById(db, tenantId, params.id);

  if (!invoice) notFound();

  const editable = isEditable(invoice.status);
  const emittable = isEmittable(invoice.status);
  const deletable = isDeletable(invoice.status);

  const numberPreview = emittable
    ? await previewNextInvoiceNumber(db, tenantId, invoice.invoice_kind)
    : null;

  // Label para el header — si está en borrador no mostramos el slug DRAFT-…
  const displayNumber =
    invoice.status === "borrador"
      ? `Borrador · ${INVOICE_KIND_LABEL[invoice.invoice_kind]}`
      : invoice.invoice_number;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <BackButton fallbackHref="/finanzas/facturas" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Receipt size={20} className="text-integra-gold shrink-0" />
              <h1 className="text-2xl font-bold text-integra-navy truncate">
                {displayNumber}
              </h1>
              <InvoiceStatusBadge status={invoice.status} />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Creada el {formatDateTime(invoice.created_at)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <Link href={`/finanzas/facturas/${invoice.id}/editar`}>
              <Button variant="outline" className="min-h-[48px]">
                <Pencil size={16} className="mr-2" />
                Editar
              </Button>
            </Link>
          )}
          {deletable && (
            <DeleteInvoiceButton
              invoiceId={invoice.id}
              invoiceLabel={displayNumber}
            />
          )}
          {emittable && (
            <EmitInvoiceDialog
              invoiceId={invoice.id}
              invoiceKind={invoice.invoice_kind}
              nextNumberPreview={numberPreview}
              grandTotal={Number(invoice.grand_total)}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        {/* Cuerpo principal */}
        <div className="space-y-5">
          {/* Datos cabecera */}
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-integra-navy mb-4">
              Datos generales
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500">Tipo</dt>
                <dd className="mt-1 font-medium text-gray-900">
                  {INVOICE_KIND_LABEL[invoice.invoice_kind]}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500">Moneda</dt>
                <dd className="mt-1 font-medium text-gray-900">{invoice.currency}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                  <User size={12} /> Cliente
                </dt>
                <dd className="mt-1 font-medium text-gray-900">
                  {invoice.client ? (
                    <Link
                      href={`/legal/clientes/${invoice.client.id}`}
                      className="hover:underline"
                    >
                      {invoice.client.name}
                      <span className="text-gray-500 ml-2 text-xs font-normal">
                        {invoice.client.client_number}
                        {invoice.client.ruc ? ` · RUC ${invoice.client.ruc}` : ""}
                      </span>
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              {invoice.case && (
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                    <FolderOpen size={12} /> Caso
                  </dt>
                  <dd className="mt-1 font-medium text-gray-900">
                    <Link
                      href={`/legal/casos/${invoice.case.id}`}
                      className="hover:underline"
                    >
                      <span className="font-mono text-xs text-gray-700">
                        {invoice.case.case_code}
                      </span>
                      {invoice.case.description && (
                        <span className="text-gray-500 ml-2 text-xs font-normal">
                          {invoice.case.description}
                        </span>
                      )}
                    </Link>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                  <Calendar size={12} /> Emisión
                </dt>
                <dd className="mt-1 font-medium text-gray-900">
                  {formatDate(invoice.issue_date)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                  <Calendar size={12} /> Vence
                </dt>
                <dd className="mt-1 font-medium text-gray-900">
                  {formatDate(invoice.due_date)}
                </dd>
              </div>
              {invoice.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                    <FileText size={12} /> Notas
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-gray-700">
                    {invoice.notes}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* Líneas */}
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-integra-navy mb-4">Líneas</h2>
            {invoice.lines.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                Esta factura no tiene líneas.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="pb-2 pr-3 font-semibold">#</th>
                      <th className="pb-2 pr-3 font-semibold">Descripción</th>
                      <th className="pb-2 pr-3 font-semibold text-right">Cant.</th>
                      <th className="pb-2 pr-3 font-semibold text-right">Precio</th>
                      <th className="pb-2 pr-3 font-semibold">Imp.</th>
                      <th className="pb-2 font-semibold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {invoice.lines.map((ln) => (
                      <tr key={ln.id}>
                        <td className="py-2 pr-3 text-gray-500">{ln.line_order + 1}</td>
                        <td className="py-2 pr-3 text-gray-900">{ln.description}</td>
                        <td className="py-2 pr-3 text-right font-mono">
                          {Number(ln.quantity).toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">
                          ${Number(ln.unit_price).toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-gray-600">
                          {ln.tax_code} ({(Number(ln.tax_rate) * 100).toFixed(0)}%)
                        </td>
                        <td className="py-2 text-right font-mono font-medium">
                          ${Number(ln.line_total).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Sidebar: totales */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border border-integra-gold/40 bg-integra-navy/[0.03] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-integra-navy mb-3">
              Resumen
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-600">Subtotal</dt>
                <dd className="font-mono font-medium text-gray-900">
                  ${Number(invoice.subtotal_total).toFixed(2)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Impuestos</dt>
                <dd className="font-mono font-medium text-gray-900">
                  ${Number(invoice.tax_total).toFixed(2)}
                </dd>
              </div>
              <div className="border-t border-integra-gold/30 pt-2 flex justify-between">
                <dt className="font-semibold text-integra-navy">Total</dt>
                <dd className="font-mono text-lg font-bold text-integra-navy">
                  ${Number(invoice.grand_total).toFixed(2)}
                </dd>
              </div>
              {Number(invoice.amount_paid) > 0 && (
                <>
                  <div className="flex justify-between text-xs text-gray-600 pt-2">
                    <dt>Pagado</dt>
                    <dd className="font-mono">${Number(invoice.amount_paid).toFixed(2)}</dd>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <dt className="text-amber-700">Saldo</dt>
                    <dd className="font-mono text-amber-700">
                      ${Number(invoice.balance_due).toFixed(2)}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </div>

          {!editable && (
            <div className="rounded-lg border bg-white p-4 text-xs text-gray-500">
              <p className="font-semibold text-gray-700 mb-1">Factura inmutable</p>
              <p>
                En estado{" "}
                <span className="font-mono">{invoice.status}</span> no se permite
                editar líneas ni cabecera. Para cambios, generá una nota de
                crédito (próximamente).
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
