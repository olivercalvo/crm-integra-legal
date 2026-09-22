import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Pencil,
  Receipt,
  User,
  FolderOpen,
  Calendar,
  FileText,
  XCircle,
} from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";
import { InvoiceStatusBadge } from "@/components/finanzas/invoice-status-badge";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { getInvoiceById } from "@/lib/finanzas/queries/invoices";
import { previewNextInvoiceNumber, periodoDeLaFacturaCerrado } from "@/lib/finanzas/api/invoices";
import { getPaymentsForInvoice } from "@/lib/finanzas/queries/payments";
import {
  listCreditNotesForInvoice,
  acreditadoPorLineaDeFactura,
} from "@/lib/finanzas/api/credit-notes";
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
import { EfacturaCard } from "../_components/efactura-card";
import { PaymentsSection } from "../_components/payments-section";
import { listarCuentasDeBanco } from "@/lib/finanzas/queries/tesoreria-para-asiento";
import { CreditNotesSection } from "../_components/credit-notes-section";
import { CreditNoteDialog, type LineaAcreditable } from "../_components/credit-note-dialog";
import { AcreditadaTotalBadge } from "@/components/finanzas/acreditada-total-badge";
import { DownloadInvoicePdfButton } from "../_components/download-invoice-pdf-button";
import { fmtImporte } from "@/lib/utils/importe";


/**
 * El título de la pestaña. Sin esto el navegador muestra "CRM Integra Legal" en
 * todas, y con seis pestañas abiertas no se distingue cuál es cuál.
 */
export const metadata = {
  title: "Factura · Finanzas",
};
interface PageProps {
  params: { id: string };
}

export default async function FacturaDetallePage({ params }: PageProps) {
  const { db, tenantId, userRole } = await getAuthenticatedContext();
  // Las cuentas que la pantalla ofrece como banco del cobro. Lista corta y
  // opinada; el guard del servidor acepta cualquier activo activo (SOP-024 r3).
  const bancos = await listarCuentasDeBanco(db, tenantId);
  const invoice = await getInvoiceById(db, tenantId, params.id);

  if (!invoice) notFound();

  // ⚠️ `canMutate` se define más abajo, pero estas tres banderas lo NECESITAN:
  // hasta el 01/09/2026 dependían solo del status, y mientras el contador no
  // podía entrar a esta pantalla eso no se notaba. Al abrirle el detalle para
  // que audite el Libro Mayor, habría visto "Editar", "Emitir" y "Eliminar".
  // Las rutas de API le responden 403 igual, pero un botón que falla al
  // apretarlo es exactamente el problema que este cambio vino a resolver.
  const puedeAccionar = userRole === "admin" || userRole === "abogada";
  const editable = puedeAccionar && isEditable(invoice.status);
  const emittable = puedeAccionar && isEmittable(invoice.status);
  const deletable = puedeAccionar && isDeletable(invoice.status);
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
  const canMutate = puedeAccionar;
  // REVERSAR un cobro contabilizado es otra bandera, y el contador SÍ la tiene
  // (17/09/2026): corregir el libro es su trabajo por la guía de RM, igual que
  // los asientos manuales y los períodos. Es el ÚNICO botón de mutación que ve
  // en esta pantalla. Se mueve junto con el guard de
  // `/api/finanzas/payments/[id]/reverse` y la tabla de CLAUDE.md.
  const canReverse = puedeAccionar || userRole === "contador";
  const showPaymentsSection = isEmitida ||
    invoice.status === "parcialmente_pagada" ||
    invoice.status === "pagada";

  // Bloque 5: lo acreditado por notas de crédito. `credited_total` es derivada
  // (051) y `balance_due` ya la resta. "Acreditada total" (D3) no es un
  // estado: es la factura emitida con todo su total acreditado, saldo 0.
  const grandTotal = Number(invoice.grand_total);
  const creditedTotal = Number(invoice.credited_total ?? 0);
  const acreditadaTotal = !isAnulada && grandTotal > 0 && creditedTotal >= grandTotal - 0.005;
  const puedeTenerNc = cancellable || isAnulada;

  // Cargar pagos, NC, lo ya acreditado por línea y el período, en paralelo.
  // El período solo importa si esta persona puede anular (D4: cerrado el mes
  // de la factura, el botón "Anular" se reemplaza por "Nota de crédito").
  const [payments, creditNotes, acreditadoPorLinea, mesCerrado] = await Promise.all([
    showPaymentsSection
      ? getPaymentsForInvoice(db, tenantId, invoice.id)
      : Promise.resolve([]),
    puedeTenerNc ? listCreditNotesForInvoice(db, tenantId, invoice.id) : Promise.resolve([]),
    cancellable && canMutate && !acreditadaTotal
      ? acreditadoPorLineaDeFactura(db, tenantId, invoice.id)
      : Promise.resolve(new Map<string, number>()),
    cancellable && canMutate
      ? periodoDeLaFacturaCerrado(db, tenantId, String(invoice.issue_date))
      : Promise.resolve(false),
  ]);

  // Lo que el diálogo de NC puede ofrecer: facturado menos ya acreditado, por
  // línea. Sale de la MISMA consulta que usa el servidor para validar.
  const lineasAcreditables: LineaAcreditable[] = invoice.lines.map((ln) => ({
    invoice_line_id: ln.id,
    line_order: ln.line_order,
    description: ln.description,
    quantity: Number(ln.quantity),
    unit_price: Number(ln.unit_price),
    tax_rate: Number(ln.tax_rate ?? 0),
    disponible: Math.round((Number(ln.quantity) - (acreditadoPorLinea.get(ln.id) ?? 0)) * 100) / 100,
  }));
  // "Anular" solo mientras la factura no tenga NC parcial (053: la anulación
  // espeja el asiento original completo y la NC parcial ya debitó su parte) y
  // el mes esté abierto (D4). Si no, el camino es la NC.
  const showCancel = cancellable && canMutate && !mesCerrado && creditedTotal <= 0;
  const showCreditNote = cancellable && canMutate && !acreditadaTotal && lineasAcreditables.some((l) => l.disponible > 0);
  // Card "Facturación Electrónica" (PAC) — visible en facturas emitidas y
  // en anuladas que hayan llegado a interactuar con DGI (para conservar
  // historial post-anulación).
  const showEfacturaCard =
    isEmitida || (isAnulada && invoice.fe_estado !== "no_emitida");
  // Permiso para disparar envío al PAC (D7 del sprint 2E.2 / consistente
  // con route handler que devuelve 403 a roles no permitidos).
  const canEmitToPac = puedeAccionar;
  // Card DGI manual — legacy MVP pre-integración PAC. Queda visible SOLO
  // si la abogada efectivamente cargó datos manuales (hay al menos un
  // campo DGI manual presente) y la factura nunca entró al flujo
  // automático (sin punto_facturacion ni numero_documento asignados por
  // la orquestación T2). Esto cubre el caso "factura legacy con CUFE
  // capturado a mano" como puente — para facturas nuevas que arrancan
  // en no_emitida sin manual data, NO se renderiza (sería ruido frente
  // a la card nueva que ya tiene el CTA "Enviar al PAC"). Una vez que
  // la factura entra al flujo automático (T2 asigna punto+número), este
  // fallback se oculta y la card EfacturaCard toma el relevo.
  const hasLegacyDgiData =
    !!invoice.dgi_numero_documento ||
    !!invoice.dgi_cufe ||
    !!invoice.dgi_fecha_autorizacion ||
    !!invoice.dgi_cafe_url;
  const neverEnteredAutoFlow =
    !invoice.punto_facturacion && invoice.numero_documento === null;
  const showLegacyDgiCard =
    (isEmitida || isAnulada) && hasLegacyDgiData && neverEnteredAutoFlow;

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
          <BackButton
            /* El contador llega acá desde el Libro Mayor y NO entra al listado
               de facturas. `BackButton` usa el historial cuando lo hay, así que
               en la navegación normal vuelve al mayor; el fallback importa
               cuando abre el enlace en una pestaña nueva, que es justo lo que
               hace alguien auditando. */
            fallbackHref={puedeAccionar ? "/finanzas/facturas" : "/finanzas/reportes/mayor"}
            label={puedeAccionar ? "Volver a facturas" : "Volver a reportes"}
            showLabel
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Receipt size={20} className="text-integra-gold shrink-0" />
              <h1 className="text-2xl font-bold text-integra-navy truncate">
                {displayNumber}
              </h1>
              <InvoiceStatusBadge status={invoice.status} />
              {acreditadaTotal && <AcreditadaTotalBadge />}
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
          {showCreditNote && (
            <CreditNoteDialog
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoice_number}
              balanceDue={Number(invoice.balance_due)}
              lineas={lineasAcreditables}
              mesCerrado={mesCerrado}
            />
          )}
          {showCancel && (
            <CancelInvoiceDialog
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoice_number}
              invoiceKind={invoice.invoice_kind}
              grandTotal={Number(invoice.grand_total)}
              amountPaid={Number(invoice.amount_paid)}
              feEstado={invoice.fe_estado}
              dgiCufe={invoice.dgi_cufe}
            />
          )}
        </div>
      </div>

      {/* D4: cerrado el mes de la factura no se anula; se acredita con fecha de hoy. */}
      {cancellable && canMutate && mesCerrado && (
        <div role="note" className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
          El mes de esta factura ({String(invoice.issue_date).slice(0, 7)}) está cerrado: no se anula, se
          emite una nota de crédito con fecha de hoy. Para dejarla sin efecto, acredite todas las líneas.
        </div>
      )}
      {cancellable && canMutate && !mesCerrado && creditedTotal > 0 && !acreditadaTotal && (
        <div role="note" className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
          Esta factura ya tiene B/. {fmtImporte(creditedTotal)} acreditados por nota de crédito: ya no se
          anula. Lo que falta se acredita con otra nota de crédito.
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
                          ${fmtImporte(Number(ln.unit_price))}
                        </td>
                        <td className="py-2 pr-3 text-gray-600">
                          {ln.tax_code} ({(Number(ln.tax_rate) * 100).toFixed(0)}%)
                        </td>
                        <td className="py-2 text-right font-mono font-medium">
                          ${fmtImporte(Number(ln.line_total))}
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
          bancos={bancos}
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoice_number}
              payments={payments}
              grandTotal={Number(invoice.grand_total)}
              amountPaid={Number(invoice.amount_paid)}
              balanceDue={Number(invoice.balance_due)}
              canMutate={canMutate}
              canReverse={canReverse}
            />
          )}

          {/* Facturación Electrónica (orquestación PAC eFactura PTY).
              Muestra el estado fiscal real (no_emitida / pending / authorized /
              error / canceled) y el CTA "Enviar al PAC" o "Reintentar" según
              corresponda. */}
          {showEfacturaCard && (
            <EfacturaCard
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoice_number}
              grandTotal={Number(invoice.grand_total)}
              receptorRuc={invoice.client?.ruc ?? null}
              receptorNombre={invoice.client?.name ?? null}
              feEstado={invoice.fe_estado}
              cufe={invoice.dgi_cufe}
              protocoloAutorizacion={invoice.dgi_protocolo_autorizacion}
              fechaAutorizacion={invoice.dgi_fecha_autorizacion}
              qrContent={invoice.qr_content}
              puntoFacturacion={invoice.punto_facturacion}
              numeroDocumento={invoice.numero_documento}
              canEmitToPac={canEmitToPac}
            />
          )}

          {/* Fallback legacy: captura manual DGI para facturas anteriores a
              la integración PAC. Solo aparece si la factura nunca entró al
              flujo automático (sin punto/número asignado) o si fue anulada
              con datos manuales históricos. Una vez que se envía al PAC,
              EfacturaCard toma el relevo. */}
          {showLegacyDgiCard && (
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

          {/* Las notas de crédito de la factura (Bloque 5): la de la anulación
              o las parciales posteriores, cada una con su detalle y su PDF. */}
          <CreditNotesSection
            notas={creditNotes}
            isAnulada={isAnulada}
            creditedTotal={creditedTotal}
          />

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
                  ${fmtImporte(Number(invoice.subtotal_total))}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Impuestos</dt>
                <dd className="font-mono font-medium text-gray-900">
                  ${fmtImporte(Number(invoice.tax_total))}
                </dd>
              </div>
              <div className="border-t border-integra-gold/30 pt-2 flex justify-between">
                <dt className="font-semibold text-integra-navy">Total</dt>
                <dd className="font-mono text-lg font-bold text-integra-navy">
                  ${fmtImporte(Number(invoice.grand_total))}
                </dd>
              </div>
              {(Number(invoice.amount_paid) > 0 || (creditedTotal > 0 && !isAnulada)) && (
                <>
                  {Number(invoice.amount_paid) > 0 && (
                    <div className="flex justify-between text-xs text-gray-600 pt-2">
                      <dt>Pagado</dt>
                      <dd className="font-mono">${fmtImporte(Number(invoice.amount_paid))}</dd>
                    </div>
                  )}
                  {creditedTotal > 0 && !isAnulada && (
                    <div className="flex justify-between text-xs text-gray-600 pt-2">
                      <dt>Acreditado (NC)</dt>
                      <dd className="font-mono">-${fmtImporte(creditedTotal)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold">
                    <dt className={acreditadaTotal ? "text-gray-600" : "text-amber-700"}>Saldo</dt>
                    <dd className={`font-mono ${acreditadaTotal ? "text-gray-600" : "text-amber-700"}`}>
                      ${fmtImporte(Number(invoice.balance_due))}
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
                editar líneas ni cabecera. Para corregirla: anularla dentro del
                mes (genera la nota de crédito total) o emitir una nota de
                crédito por las líneas que correspondan.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
