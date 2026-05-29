import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Pencil,
  FileText,
  User,
  FolderOpen,
  Calendar,
  Send,
  CheckCircle,
  Ban,
  ArrowRightCircle,
  Mail,
  ThumbsDown,
  AlertCircle,
} from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { getQuoteById } from "@/lib/finanzas/queries/quotes";
import {
  isQuoteEditable,
  isQuoteDeletable,
  isQuoteSendable,
  isQuoteCancellable,
  isQuoteDecidable,
  isQuoteConvertible,
  isQuoteResendable,
  QUOTE_STATUS_LABEL,
} from "@/lib/finanzas/types/quote";
import { QuoteStatusBadge } from "@/components/finanzas/cotizaciones/quote-status-badge";
import { QuoteKindIndicator } from "@/components/finanzas/cotizaciones/quote-kind-indicator";
import { QuoteSuccessToast } from "../_components/quote-success-toast";
import { DeleteQuoteButton } from "../_components/delete-quote-button";
import { DuplicateQuoteButton } from "../_components/duplicate-quote-button";
import { SendQuoteDialog } from "../_components/send-quote-dialog";
import { DownloadPdfButton } from "../_components/download-pdf-button";
import { CancelQuoteDialog } from "../_components/cancel-quote-dialog";
import { MarkAcceptedDialog } from "../_components/mark-accepted-dialog";
import { MarkRejectedDialog } from "../_components/mark-rejected-dialog";
import { ConvertToInvoicesDialog } from "../_components/convert-to-invoices-dialog";
import { PublicLinkDisplay } from "../_components/public-link-display";
import { QuoteTermsCollapsible } from "../_components/quote-terms-collapsible";
import { getPublicAppUrl } from "@/lib/utils/public-url";

interface PageProps {
  params: { id: string };
}

export default async function CotizacionDetallePage({ params }: PageProps) {
  const { db, tenantId } = await getAuthenticatedContext();
  const quote = await getQuoteById(db, tenantId, params.id);

  if (!quote) notFound();

  const editable = isQuoteEditable(quote.status);
  const deletable = isQuoteDeletable(quote.status);
  const sendable = isQuoteSendable(quote.status);
  const cancellable = isQuoteCancellable(quote.status);
  const decidable = isQuoteDecidable(quote.status);
  const convertible = isQuoteConvertible(quote.status);
  const resendable = isQuoteResendable(quote.status);

  // Construir el link público si la cotización fue enviada y tiene token.
  const publicLink =
    quote.public_token && quote.status !== "borrador"
      ? `${getPublicAppUrl()}/cotizacion/${quote.public_token}`
      : null;

  // Líneas agrupadas: detectar si tiene HON, REI o ambos.
  const hasHon = quote.lines.some((l) => l.invoice_kind === "HON");
  const hasRei = quote.lines.some((l) => l.invoice_kind === "REI");

  const lineKinds: Array<{ kind: "HON" | "REI"; subtotal: number }> = [];
  if (hasHon) lineKinds.push({ kind: "HON", subtotal: Number(quote.subtotal_hon) });
  if (hasRei) lineKinds.push({ kind: "REI", subtotal: Number(quote.subtotal_rei) });

  // Eligibilidad de eliminación (T6 lo enforza también; gate UI por estética).
  const showDeleteButton = deletable;

  return (
    <div className="space-y-5">
      <QuoteSuccessToast />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <BackButton fallbackHref="/finanzas/cotizaciones" label="Volver a cotizaciones" showLabel />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <FileText size={20} className="text-integra-gold shrink-0" />
              <h1 className="text-2xl font-bold text-integra-navy truncate font-mono">
                {quote.quote_number}
              </h1>
              <QuoteStatusBadge status={quote.status} />
            </div>
            {quote.title && (
              <p className="mt-1 text-lg font-semibold text-gray-700 line-clamp-2 break-words">
                {quote.title}
              </p>
            )}
            <p className="mt-1 text-sm text-gray-500">
              Creada el {formatDateTime(quote.created_at)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DownloadPdfButton quoteId={quote.id} quoteNumber={quote.quote_number} />
          <DuplicateQuoteButton
            quoteId={quote.id}
            quoteNumber={quote.quote_number}
          />
          {editable && (
            <Link href={`/finanzas/cotizaciones/${quote.id}/editar`}>
              <Button variant="outline" className="min-h-[48px]">
                <Pencil size={16} className="mr-2" />
                Editar
              </Button>
            </Link>
          )}
          {showDeleteButton && (
            <DeleteQuoteButton
              quoteId={quote.id}
              quoteLabel={quote.quote_number}
            />
          )}
          {sendable && (
            <SendQuoteDialog
              quoteId={quote.id}
              quoteNumber={quote.quote_number}
              defaultEmail={quote.client?.email ?? null}
              publicPortalBaseUrl={getPublicAppUrl()}
            />
          )}
          {resendable && (
            <SendQuoteDialog
              mode="resend"
              quoteId={quote.id}
              quoteNumber={quote.quote_number}
              defaultEmail={quote.sent_to_email ?? quote.client?.email ?? null}
              publicPortalBaseUrl={getPublicAppUrl()}
              currentStatusLabel={QUOTE_STATUS_LABEL[quote.status]}
            />
          )}
          {cancellable && (
            <CancelQuoteDialog
              quoteId={quote.id}
              quoteNumber={quote.quote_number}
            />
          )}
          {decidable && (
            <>
              <MarkAcceptedDialog
                quoteId={quote.id}
                quoteNumber={quote.quote_number}
              />
              <MarkRejectedDialog
                quoteId={quote.id}
                quoteNumber={quote.quote_number}
              />
            </>
          )}
          {convertible && (
            <ConvertToInvoicesDialog
              quoteId={quote.id}
              quoteNumber={quote.quote_number}
              subtotalHon={Number(quote.subtotal_hon)}
              subtotalRei={Number(quote.subtotal_rei)}
              taxTotal={Number(quote.tax_total)}
              grandTotal={Number(quote.grand_total)}
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
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                  <User size={12} /> Cliente
                </dt>
                <dd className="mt-1 font-medium text-gray-900">
                  {quote.client ? (
                    <Link
                      href={`/legal/clientes/${quote.client.id}`}
                      className="hover:underline"
                    >
                      {quote.client.name}
                      {quote.client.client_status === "prospect" && (
                        <span className="ml-2 inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                          prospecto
                        </span>
                      )}
                      <span className="text-gray-500 ml-2 text-xs font-normal">
                        {quote.client.client_number}
                        {quote.client.ruc ? ` · RUC ${quote.client.ruc}` : ""}
                      </span>
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              {quote.case && (
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                    <FolderOpen size={12} /> Caso
                  </dt>
                  <dd className="mt-1 font-medium text-gray-900">
                    <Link
                      href={`/legal/casos/${quote.case.id}`}
                      className="hover:underline"
                    >
                      <span className="font-mono text-xs text-gray-700">
                        {quote.case.case_code}
                      </span>
                      {quote.case.description && (
                        <span className="text-gray-500 ml-2 text-xs font-normal">
                          {quote.case.description}
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
                  {formatDate(quote.issue_date)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                  <Calendar size={12} /> Vence
                </dt>
                <dd className="mt-1 font-medium text-gray-900">
                  {formatDate(quote.valid_until)}
                </dd>
              </div>
              {/* Composición HON/REI (resumen rápido) */}
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wider text-gray-500">
                  Composición
                </dt>
                <dd className="mt-1 flex flex-wrap gap-2">
                  {lineKinds.length === 0 ? (
                    <span className="text-gray-400 text-sm">—</span>
                  ) : (
                    lineKinds.map(({ kind, subtotal }) => (
                      <span key={kind} className="inline-flex items-center gap-2 text-sm">
                        <QuoteKindIndicator kind={kind} compact />
                        <span className="font-mono text-gray-700">
                          ${subtotal.toFixed(2)}
                        </span>
                      </span>
                    ))
                  )}
                </dd>
              </div>
              {quote.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                    <FileText size={12} /> Notas internas
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-gray-700">
                    {quote.notes}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* Card específica de cada status post-borrador */}
          {quote.status === "enviada" && (
            <section className="rounded-xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
              <div className="mb-3 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
                  <Send size={20} className="text-blue-700" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-integra-navy">
                    Enviada
                  </h2>
                  <p className="text-xs text-gray-600">
                    {quote.sent_at && `Enviada el ${formatDateTime(quote.sent_at)}`}
                    {quote.sent_to_email && (
                      <>
                        {" · "}
                        <span className="inline-flex items-center gap-1 font-mono text-xs">
                          <Mail size={12} /> {quote.sent_to_email}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              {publicLink && <PublicLinkDisplay link={publicLink} />}
            </section>
          )}

          {quote.status === "aceptada" && (
            <section className="rounded-xl border border-green-200 bg-green-50 p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100">
                  <CheckCircle size={20} className="text-green-700" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-integra-navy">
                    Aceptada por el cliente
                  </h2>
                  <p className="mt-1 text-sm text-gray-700">
                    {quote.approved_at &&
                      `Aceptación registrada el ${formatDateTime(quote.approved_at)}.`}
                  </p>
                  <p className="mt-2 text-xs text-gray-600">
                    Cuando estés listo, convierte esta cotización a una o
                    dos facturas (según las líneas HON / REI) con el botón
                    de arriba.
                  </p>
                </div>
              </div>
            </section>
          )}

          {quote.status === "rechazada" && (
            <section className="rounded-xl border border-red-200 bg-red-50 p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                  <ThumbsDown size={20} className="text-red-700" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-integra-navy">
                    Rechazada
                  </h2>
                  <p className="mt-1 text-sm text-gray-700">
                    {quote.rejected_at &&
                      `Rechazo registrado el ${formatDateTime(quote.rejected_at)}.`}
                  </p>
                  {quote.rejection_reason && (
                    <div className="mt-3 rounded-md border border-red-200 bg-white p-3 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        Razón
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-gray-800">
                        {quote.rejection_reason}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {quote.status === "convertida" && (
            <section className="rounded-xl border border-violet-200 bg-violet-50 p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100">
                  <ArrowRightCircle size={20} className="text-violet-700" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-integra-navy">
                    Convertida a {quote.converted_invoice_ids?.length ?? 0} factura
                    {(quote.converted_invoice_ids?.length ?? 0) === 1 ? "" : "s"}
                  </h2>
                  <p className="mt-1 text-sm text-gray-700">
                    {quote.converted_at &&
                      `Convertida el ${formatDateTime(quote.converted_at)}.`}
                  </p>
                  {quote.converted_invoice_ids &&
                    quote.converted_invoice_ids.length > 0 && (
                      <ul className="mt-3 space-y-2">
                        {quote.converted_invoice_ids.map((invId) => (
                          <li key={invId}>
                            <Link
                              href={`/finanzas/facturas/${invId}`}
                              className="inline-flex items-center gap-2 rounded-md border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-integra-navy hover:border-integra-navy"
                            >
                              <FileText size={14} className="text-violet-600" />
                              Ver factura generada
                              <ArrowRightCircle size={14} className="text-gray-400" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
              </div>
            </section>
          )}

          {quote.status === "cancelada_pre_envio" && (
            <section className="rounded-xl border bg-gray-50 p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-200">
                  <Ban size={20} className="text-gray-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-gray-700">
                    Cancelada pre-envío
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Esta cotización fue descartada antes de enviarla al cliente.
                    {quote.cancelled_at &&
                      ` Cancelada el ${formatDateTime(quote.cancelled_at)}.`}
                  </p>
                  {quote.cancellation_reason && (
                    <div className="mt-3 rounded-md border bg-white p-3 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        Razón
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-gray-800">
                        {quote.cancellation_reason}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {quote.status === "expirada" && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
                  <AlertCircle size={20} className="text-amber-700" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-amber-900">
                    Expirada
                  </h2>
                  <p className="mt-1 text-sm text-amber-900">
                    Esta cotización venció el {formatDate(quote.valid_until)}.
                    Para reactivarla, crea una nueva cotización con datos
                    actualizados.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Líneas */}
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-integra-navy mb-4">Líneas</h2>
            {quote.lines.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                Esta cotización no tiene líneas.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="pb-2 pr-3 font-semibold">#</th>
                      <th className="pb-2 pr-3 font-semibold">Tipo</th>
                      <th className="pb-2 pr-3 font-semibold">Descripción</th>
                      <th className="pb-2 pr-3 font-semibold text-right">Cant.</th>
                      <th className="pb-2 pr-3 font-semibold text-right">Precio</th>
                      <th className="pb-2 pr-3 font-semibold">Imp.</th>
                      <th className="pb-2 font-semibold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {quote.lines.map((ln) => (
                      <tr key={ln.id}>
                        <td className="py-2 pr-3 text-gray-500">{ln.line_order}</td>
                        <td className="py-2 pr-3">
                          <QuoteKindIndicator kind={ln.invoice_kind} compact />
                        </td>
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
                          ${Number(ln.line_total ?? 0).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Términos y Condiciones */}
          <QuoteTermsCollapsible content={quote.terms_and_conditions ?? ""} />
        </div>

        {/* Sidebar: totales */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border border-integra-gold/40 bg-integra-navy/[0.03] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-integra-navy mb-3">
              Resumen
            </h3>
            <dl className="space-y-2 text-sm">
              {hasHon && (
                <div className="flex justify-between">
                  <dt className="text-blue-700">Subtotal honorarios</dt>
                  <dd className="font-mono font-medium text-gray-900">
                    ${Number(quote.subtotal_hon).toFixed(2)}
                  </dd>
                </div>
              )}
              {hasRei && (
                <div className="flex justify-between">
                  <dt className="text-orange-700">Subtotal reembolso</dt>
                  <dd className="font-mono font-medium text-gray-900">
                    ${Number(quote.subtotal_rei).toFixed(2)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between text-xs text-gray-500 pt-1">
                <dt>Impuestos</dt>
                <dd className="font-mono">${Number(quote.tax_total).toFixed(2)}</dd>
              </div>
              <div className="border-t border-integra-gold/30 pt-2 flex justify-between">
                <dt className="font-semibold text-integra-navy">Total general</dt>
                <dd className="font-mono text-lg font-bold text-integra-navy">
                  ${Number(quote.grand_total).toFixed(2)}
                </dd>
              </div>
            </dl>
          </div>

          {!editable && quote.status !== "expirada" && (
            <div className="rounded-lg border bg-white p-4 text-xs text-gray-500">
              <p className="font-semibold text-gray-700 mb-1">Cotización inmutable</p>
              <p>
                En estado <span className="font-mono">{quote.status}</span> no
                se permite editar líneas ni cabecera. Si necesitas cambios,
                crea una cotización nueva.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
