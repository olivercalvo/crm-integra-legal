import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Pencil,
  Receipt,
  User,
  FolderOpen,
  Calendar,
  FileText,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";
import { InvoiceStatusBadge } from "@/components/finanzas/invoice-status-badge";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { getInvoiceById } from "@/lib/finanzas/queries/invoices";
import { previewNextInvoiceNumber } from "@/lib/finanzas/api/invoices";
import { getPaymentsForInvoice } from "@/lib/finanzas/queries/payments";
import { getCreditNoteForInvoice } from "@/lib/finanzas/api/credit-notes";
import {
  INVOICE_KIND_LABEL,
  isEditable,
  isEmittable,
  isDeletable,
} from "@/lib/finanzas/types/invoice";
import { EmitInvoiceDialog } from "../_components/emit-invoice-dialog";
import { DeleteInvoiceButton } from "../_components/delete-invoice-button";
import { CancelInvoiceDialog } from "../_components/cancel-invoice-dialog";
import { InvoiceSuccessToast } from "../_components/invoice-success-toast";
import { DgiDataCard } from "../_components/dgi-data-card";
import { PaymentsSection } from "../_components/payments-section";
import { CreditNoteCard } from "../_components/credit-note-card";
import { DownloadInvoicePdfButton } from "../_components/download-invoice-pdf-button";

interface PageProps {
  params: { id: string };
}

export default async function FacturaDetallePage({ params }: PageProps) {
  const { db, tenantId, userRole } = await getAuthenticatedContext();
  const invoice = await getInvoiceById(db, tenantId, params.id);

  if (!invoice) notFound();

  const editable = isEditable(invoice.status);
  const emittable = isEmittable(invoice.status);
  const deletable = isDeletable(invoice.status);
  const isEmitida = invoice.status === "emitida";
  const isAnulada = invoice.status === "anulada";
  // Anulable desde UI: emitida, parcialmente_pagada, pagada. La pre-check
  // de cancelInvoice() bloquea con mensaje claro si tiene pagos aplicados
  // (Sprint 2C, D3.d/D3.e). Mostramos siempre el botón en estos estados;
  // si el usuario no puede anular (porque tiene pagos), el dialog
  // bloquea sin pedir razón.
  const cancellable =
    invoice.status === "emitida" ||
    invoice.status === "parcialmente_pagada" ||
    invoice.status === "pagada";
  // Sprint 2C, D4: solo admin + abogada pueden registrar/eliminar pagos
  // y anular facturas. Asistente y contador → READ-only.
  const canMutate = userRole === "admin" || userRole === "abogada";
  const showPaymentsSection = isEmitida ||
    invoice.status === "parcialmente_pagada" ||
    invoice.status === "pagada";

  // Cargar pagos + NC en paralelo solo si aplica
  const [payments, creditNote] = await Promise.all([
    showPaymentsSection
      ? getPaymentsForInvoice(db, tenantId, invoice.id)
      : Promise.resolve([]),
    isAnulada ? getCreditNoteForInvoice(db, tenantId, invoice.id) : Promise.resolve(null),
  ]);
  // Conserva la card DGI en facturas anuladas SI tienen algún dato cargado,
  // como referencia histórica. Si nunca se llenó, no la mostramos.
  const hasDgiData =
    !!invoice.dgi_numero_documento ||
    !!invoice.dgi_cufe ||
    !!invoice.dgi_fecha_autorizacion ||
    !!invoice.dgi_cafe_url;
  const showDgiCard = isEmitida || (isAnulada && hasDgiData);
  // Banner pre-integración eFactura: visible mientras la abogada no haya
  // capturado el CUFE oficial. Una vez registrado, el flujo se considera
  // completo y ocultamos el banner para reducir ruido visual. Si la factura
  // fue anulada, isEmitida queda en false → el banner no se muestra
  // (el estado de anulación tiene su propia sección dedicada).
  const showInternalBanner = isEmitida && !invoice.dgi_cufe;

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
      <InvoiceSuccessToast />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <BackButton fallbackHref="/finanzas/facturas" label="Volver a facturas" showLabel />
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
          {/* Descargar PDF disponible en todos los estados — documento interno. */}
          <DownloadInvoicePdfButton
            invoiceId={invoice.id}
            invoiceLabel={displayNumber}
          />
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
          {cancellable && canMutate && (
            <CancelInvoiceDialog
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoice_number}
              invoiceKind={invoice.invoice_kind}
              grandTotal={Number(invoice.grand_total)}
              amountPaid={Number(invoice.amount_paid)}
            />
          )}
        </div>
      </div>

      {/* Banner pre-integración eFactura (decisión D2 del sprint).
          Sólo visible en facturas emitidas que aún no tienen CUFE registrado.
          shadcn/ui no incluye Alert en este proyecto, así que armamos un
          banner custom con la paleta corporativa. */}
      {showInternalBanner && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border-l-4 border-amber-400 bg-amber-50 p-4 text-amber-900"
        >
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-semibold">📄 Documento interno</p>
            <p>
              La factura fiscal oficial debe emitirse en eFactura. Cuando
              termines, registra el número y el CUFE en la sección de abajo.
            </p>
          </div>
        </div>
      )}

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

          {/* Pagos — visible si la factura está emitida (con o sin pagos
              parciales/totales). En anuladas y borradores no se muestra. */}
          {showPaymentsSection && (
            <PaymentsSection
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoice_number}
              payments={payments}
              grandTotal={Number(invoice.grand_total)}
              amountPaid={Number(invoice.amount_paid)}
              balanceDue={Number(invoice.balance_due)}
              canMutate={canMutate}
            />
          )}

          {/* Datos DGI — visible cuando status='emitida' (caso primario,
              D4 del sprint Camino 1) o cuando la factura fue anulada y aún
              conserva datos DGI cargados (referencia histórica). El propio
              componente DgiDataCard no permite editar si el invoice no está
              emitida — el backend (updateInvoiceDgiData) ya lo gate-ea. */}
          {showDgiCard && (
            <DgiDataCard
              invoiceId={invoice.id}
              initial={{
                dgi_numero_documento: invoice.dgi_numero_documento,
                dgi_cufe: invoice.dgi_cufe,
                dgi_fecha_autorizacion: invoice.dgi_fecha_autorizacion,
                dgi_cafe_url: invoice.dgi_cafe_url,
              }}
            />
          )}

          {/* Nota de crédito generada al anular (Sprint 2C, D7).
              Visible solo en facturas anuladas que tengan NC asociada. */}
          {isAnulada && creditNote && (
            <CreditNoteCard
              creditNoteId={creditNote.id}
              creditNoteNumber={creditNote.credit_note_number}
            />
          )}

          {/* Información de anulación — solo si la factura fue anulada.
              Render similar a DgiDataCard pero solo lectura (la anulación
              es irreversible — T2 no permite transiciones desde anulada). */}
          {isAnulada && (
            <section className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50">
                  <XCircle size={20} className="text-red-600" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-integra-navy">
                    Información de anulación
                  </h2>
                  <p className="text-xs text-gray-500">
                    Esta factura fue anulada. Esta acción es irreversible.
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border bg-gray-50/50 p-3 sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                    <FileText size={12} /> Razón
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                    {invoice.cancellation_reason ?? (
                      <span className="text-gray-400">—</span>
                    )}
                  </dd>
                </div>
                <div className="rounded-lg border bg-gray-50/50 p-3 sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                    <Calendar size={12} /> Fecha de anulación
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-gray-900">
                    {invoice.cancelled_at ? (
                      formatDateTime(invoice.cancelled_at)
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </dd>
                </div>
              </dl>
            </section>
          )}
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

          {!editable && !isAnulada && (
            <div className="rounded-lg border bg-white p-4 text-xs text-gray-500">
              <p className="font-semibold text-gray-700 mb-1">Factura inmutable</p>
              <p>
                En estado{" "}
                <span className="font-mono">{invoice.status}</span> no se permite
                editar líneas ni cabecera. Para revertir, anulá la factura — se
                generará una nota de crédito automáticamente.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
