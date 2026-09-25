import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  BookOpenCheck,
  Calendar,
  CheckCircle2,
  FileMinus,
  FileText,
  Receipt,
  User,
} from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { fmtImporte } from "@/lib/utils/importe";
import { getCreditNoteById } from "@/lib/finanzas/api/credit-notes";
import { cargarAsientosPorOrigen } from "@/lib/finanzas/queries/payments";
import { SOURCE_TYPE_NOTA_CREDITO } from "@/lib/finanzas/contabilidad/asiento-nota-credito";
import { NcFeEstadoBadge } from "@/components/finanzas/nc-fe-estado-badge";
import { CreditNotePdfButton } from "@/components/finanzas/credit-note-pdf-button";
import { EnviarNcALaDgiButton } from "./_components/enviar-nc-a-la-dgi-button";
import { ReversePaymentDialog } from "@/app/finanzas/facturas/_components/reverse-payment-dialog";
import { MOTIVO_ANULACION_MIN } from "@/lib/finanzas/validators/cancel-invoice";
import {
  decidirAccionSobreNotaDeCredito,
  type FeEstado,
} from "@/lib/finanzas/efactura/orchestration/decidir-accion-fiscal";
import { INVOICE_KIND_LABEL, type InvoiceKind } from "@/lib/finanzas/types/invoice";

/**
 * DETALLE DE UNA NOTA DE CRÉDITO — solo lectura (Bloque 5, commit 4).
 *
 * No existía: la NC era una card dentro de la factura anulada. Con la NC
 * parcial (varias por factura) y su asiento propio (D5), el Libro Mayor y el
 * Diario necesitan un documento al que llegar —"cada reporte permite llegar al
 * documento origen" (guía de RM)— y ese documento es esta pantalla.
 *
 * La ven admin, abogada y contador. El contador entra por patrón exacto en
 * `route-access.ts` (`/finanzas/notas-credito/{id}`), igual que al detalle de
 * la factura: **el detalle sí, el listado no**.
 *
 * 🔴 Desde el Bloque 9C la pantalla SÍ tiene dos acciones, y no son la misma:
 *   · **Enviar a la DGI** (admin y abogada) — hasta que corre, la NC es un
 *     documento interno.
 *   · **Reversar** (admin, abogada y CONTADOR, la misma lista que reversar un
 *     cobro: corregir el libro es su trabajo).
 * Lo que se puede hacer lo decide `decidirAccionSobreNotaDeCredito()`, la misma
 * función pura que usa el servidor, para que el botón y el 409 nunca digan
 * cosas distintas.
 *
 * 🔴 D1: mientras `fe_estado = 'no_emitida'` la pantalla lleva la banda de
 * DOCUMENTO INTERNO, igual que el PDF. La NC consta en los libros del bufete
 * pero la DGI no la autorizó; no es comprobante fiscal.
 */

export const metadata = {
  title: "Nota de crédito · Finanzas",
};

/** Tiene que coincidir con `route-access.ts` (contador por patrón exacto). */
const READING_ROLES = ["admin", "abogada", "contador"];

interface PageProps {
  params: { id: string };
  searchParams?: { emitida?: string };
}

interface NcDetalle {
  id: string;
  credit_note_number: string;
  invoice_id: string;
  issue_date: string;
  reason: string;
  observations: string | null;
  status: string;
  currency: string;
  subtotal_total: string | number;
  tax_total: string | number;
  grand_total: string | number;
  fe_estado: string;
  dgi_cufe: string | null;
  dgi_fecha_autorizacion: string | null;
  created_at: string;
  invoice: {
    id: string;
    invoice_number: string;
    invoice_kind: InvoiceKind;
    issue_date: string;
    status: string;
    grand_total: string | number;
  } | null;
  client: {
    id: string;
    name: string;
    client_number: string;
    ruc: string | null;
    digito_verificador: string | null;
  } | null;
  lines: Array<{
    id: string;
    line_order: number;
    description: string;
    quantity: string | number;
    unit_price: string | number;
    tax_code: string;
    tax_rate: string | number;
    subtotal: string | number;
    tax_amount: string | number;
    line_total: string | number;
  }>;
}

export default async function NotaDeCreditoDetallePage({ params, searchParams }: PageProps) {
  const { db, tenantId, userRole } = await getAuthenticatedContext();
  if (!READING_ROLES.includes(userRole)) {
    redirect("/finanzas");
  }

  const raw = await getCreditNoteById(db, tenantId, params.id);
  if (!raw) notFound();
  const nc = raw as unknown as NcDetalle;

  const noEmitida = nc.fe_estado === "no_emitida";
  const puedeAccionar = userRole === "admin" || userRole === "abogada";

  // Su asiento propio (NC posterior o parcial, D5) o, si acompaña una
  // anulación, la reversión del asiento de la factura.
  const propios = await cargarAsientosPorOrigen(db, tenantId, SOURCE_TYPE_NOTA_CREDITO, [nc.id]);
  const asiento = propios.get(nc.id) ?? null;

  // 🔴 Una NC es "de anulación" cuando NO tiene asiento propio y su factura
  //    está anulada (D5). Mirar solo la factura no alcanza: una NC por líneas,
  //    reversada, sobre una factura que DESPUÉS se anuló (063) tiene asiento
  //    propio y no es de anulación. Hasta el 25/09/2026 se mostraba como tal y
  //    cargaba la reversión de la factura como si fuera suya.
  const esAnulacion = nc.invoice?.status === "anulada" && asiento === null;
  const reversiones =
    esAnulacion && nc.invoice
      ? await cargarAsientosPorOrigen(db, tenantId, "reversion", [nc.invoice.id])
      : new Map();
  const reversion = nc.invoice ? reversiones.get(nc.invoice.id) ?? null : null;

  // Una NC por líneas puede acreditar la factura entera. "Parcial" solo
  // cuando acredita menos que el total de la factura.
  const acreditaElTotal =
    nc.invoice !== null && nc.invoice !== undefined &&
    Number(nc.grand_total) >= Number(nc.invoice.grand_total) - 0.005;

  const recienEmitida = searchParams?.emitida === "1";

  // ── Qué se puede hacer con esta nota de crédito ──────────────────────────
  //
  // 🔴 La decisión NO se deriva acá en el JSX: la toma la misma función pura
  //    que usa el servidor (`decidirAccionSobreNotaDeCredito`), con el reloj
  //    pasado por parámetro. Es la regla de 9A — la matriz es una función, no
  //    una tabla en un .md ni un `if` en una pantalla — y existe para que el
  //    botón y el 409 nunca digan cosas distintas.
  const accion = decidirAccionSobreNotaDeCredito(
    {
      status: nc.status,
      feEstado: nc.fe_estado as FeEstado,
      dgiCufe: nc.dgi_cufe,
      issueDate: nc.issue_date,
      dgiFechaAutorizacion: nc.dgi_fecha_autorizacion,
      tieneAsientoPropio: asiento !== null,
    },
    new Date()
  );

  // Emitir a la DGI: admin y abogada, y sólo mientras no haya salido bien.
  const puedeEnviarALaDgi =
    puedeAccionar &&
    !esAnulacion &&
    (nc.fe_estado === "no_emitida" || nc.fe_estado === "error");

  // Reversar: admin, abogada y CONTADOR —la misma lista que reversar un cobro,
  // porque corregir el libro es su trabajo— y sólo si hay algo que reversar.
  const puedeReversar =
    ["admin", "abogada", "contador"].includes(userRole) &&
    accion.accion !== "sin_asiento_propio" &&
    accion.accion !== "nada_que_hacer" &&
    accion.accion !== "esperar_confirmacion" &&
    asiento !== null;

  return (
    <div className="space-y-5">
      {recienEmitida && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>
            Nota de crédito <span className="font-mono font-semibold">{nc.credit_note_number}</span> emitida
            {asiento ? ` y registrada en el libro (asiento ${asiento.entry_number})` : ""}.
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <BackButton
            /* La abogada llega desde la factura; el contador, desde el Mayor o el
               Diario. El historial manda; el fallback es para la pestaña nueva. */
            fallbackHref={nc.invoice ? `/finanzas/facturas/${nc.invoice.id}` : "/finanzas/reportes/mayor"}
            label={nc.invoice ? "Volver a la factura" : "Volver a reportes"}
            showLabel
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <FileMinus size={20} className="text-integra-gold shrink-0" />
              <h1 className="text-2xl font-bold text-integra-navy truncate">{nc.credit_note_number}</h1>
              <NcFeEstadoBadge estado={nc.fe_estado} />
              {esAnulacion ? (
                <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                  Anulación
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-integra-gold/60 bg-integra-gold/10 px-2.5 py-0.5 text-xs font-semibold text-integra-navy">
                  {acreditaElTotal ? "Total" : "Parcial"}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">Creada el {formatDateTime(nc.created_at)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CreditNotePdfButton creditNoteId={nc.id} />
          {puedeEnviarALaDgi && nc.invoice && (
            <EnviarNcALaDgiButton
              creditNoteId={nc.id}
              creditNoteNumber={nc.credit_note_number}
              invoiceNumber={nc.invoice.invoice_number}
              esReintento={nc.fe_estado === "error"}
            />
          )}
          {puedeReversar && asiento && (
            <ReversePaymentDialog
              variante="nota_credito"
              paymentId={nc.id}
              paymentLabel={`${nc.credit_note_number} · ${fmtImporte(Number(nc.grand_total))}`}
              asiento={asiento}
              invoiceNumber={nc.invoice?.invoice_number ?? ""}
              // Si la matriz dice que viaja a la DGI, el motivo es el de la DGI
              // (15) y el aviso es el texto de la matriz, no uno escrito acá.
              motivoMinimo={
                accion.accion === "anular_en_dgi_y_libro" || nc.fe_estado === "canceled"
                  ? MOTIVO_ANULACION_MIN
                  : undefined
              }
              aviso={
                accion.accion === "anular_en_dgi_y_libro" || accion.accion === "reversar_solo_en_el_libro"
                  ? accion.mensaje
                  : undefined
              }
            />
          )}
        </div>
      </div>

      {/*
        Qué se puede hacer con esta nota de crédito, en una sola línea y en
        castellano. El texto sale de la MATRIZ, no se escribe acá: si el
        servidor rechaza, va a decir exactamente lo mismo.

        Se muestra sólo cuando hay algo que explicar — el camino feliz no
        necesita un cartel, tiene un botón.
      */}
      {(accion.accion === "sin_camino_fuera_de_plazo" ||
        accion.accion === "sin_asiento_propio" ||
        accion.accion === "esperar_confirmacion" ||
        accion.accion === "inconsistente") && (
        <div
          role="note"
          className={`flex items-start gap-3 rounded-md border-l-4 p-4 text-sm ${
            accion.accion === "esperar_confirmacion"
              ? "border-amber-500 bg-amber-50 text-amber-900"
              : "border-gray-400 bg-gray-50 text-gray-800"
          }`}
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p>{accion.mensaje}</p>
            {accion.accion === "sin_camino_fuera_de_plazo" && (
              /* Sólo el DATO, nunca el plazo: el mensaje de arriba ya lo dice, y
                 repetirlo acá sería derivar la matriz en el JSX. Hay un test
                 que falla si aparece el número en este archivo. */
              <p className="mt-1 text-xs opacity-80">
                Autorizada por la DGI el {formatDate(nc.dgi_fecha_autorizacion ?? nc.issue_date)} ·
                pasaron {Math.floor(accion.ventana.horasTranscurridas)} horas desde que se emitió.
              </p>
            )}
          </div>
        </div>
      )}

      {/* D1: documento interno */}
      {noEmitida && (
        <div
          role="note"
          className="flex items-start gap-3 rounded-md border-l-4 border-red-600 bg-red-50 p-4 text-sm text-red-900"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
          <div>
            <p className="font-semibold uppercase tracking-wide">Documento interno: sin autorización de la DGI</p>
            <p className="mt-1">
              Esta nota de crédito consta en los libros del bufete pero todavía no fue enviada ni autorizada
              por la DGI. No tiene CUFE ni vale como comprobante fiscal electrónico; el PDF lleva la misma
              marca.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Datos generales */}
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-integra-navy mb-4">Datos generales</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                  <Receipt size={12} /> Factura
                </dt>
                <dd className="mt-1 font-medium text-gray-900">
                  {nc.invoice ? (
                    <Link href={`/finanzas/facturas/${nc.invoice.id}`} className="hover:underline">
                      <span className="font-mono">{nc.invoice.invoice_number}</span>
                      <span className="text-gray-500 ml-2 text-xs font-normal">
                        {INVOICE_KIND_LABEL[nc.invoice.invoice_kind]} · emitida el{" "}
                        {formatDate(nc.invoice.issue_date)} · B/. {fmtImporte(Number(nc.invoice.grand_total))}
                      </span>
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                  <User size={12} /> Cliente
                </dt>
                <dd className="mt-1 font-medium text-gray-900">
                  {nc.client ? (
                    <>
                      {puedeAccionar ? (
                        <Link href={`/legal/clientes/${nc.client.id}`} className="hover:underline">
                          {nc.client.name}
                        </Link>
                      ) : (
                        // nav-guard-ok: el contador no entra a /legal; el nombre va como texto.
                        <span>{nc.client.name}</span>
                      )}
                      <span className="text-gray-500 ml-2 text-xs font-normal">{nc.client.client_number}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              {nc.client?.ruc && (
                <div>
                  <dt className="text-xs uppercase tracking-wider text-gray-500">RUC</dt>
                  <dd className="mt-1 font-mono text-gray-900">{nc.client.ruc}</dd>
                </div>
              )}
              {nc.client?.digito_verificador && (
                <div>
                  <dt className="text-xs uppercase tracking-wider text-gray-500">DV</dt>
                  <dd className="mt-1 font-mono text-gray-900">{nc.client.digito_verificador}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                  <Calendar size={12} /> Fecha de la nota
                </dt>
                <dd className="mt-1 font-medium text-gray-900">{formatDate(nc.issue_date)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500">Moneda</dt>
                <dd className="mt-1 font-medium text-gray-900">{nc.currency}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
                  <FileText size={12} /> {esAnulacion ? "Razón de la anulación" : "Motivo"}
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-gray-900">{nc.reason}</dd>
              </div>
              {nc.observations && (
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wider text-gray-500">Observaciones</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-gray-700">{nc.observations}</dd>
                </div>
              )}
            </dl>
          </section>

          {/* Líneas */}
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-integra-navy mb-4">Líneas acreditadas</h2>
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
                  {nc.lines.map((ln) => (
                    <tr key={ln.id}>
                      <td className="py-2 pr-3 text-gray-500">{ln.line_order + 1}</td>
                      <td className="py-2 pr-3 text-gray-900">{ln.description}</td>
                      <td className="py-2 pr-3 text-right font-mono">{Number(ln.quantity).toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right font-mono">${fmtImporte(Number(ln.unit_price))}</td>
                      <td className="py-2 pr-3 text-gray-600">
                        {ln.tax_code} ({(Number(ln.tax_rate) * 100).toFixed(0)}%)
                      </td>
                      <td className="py-2 text-right font-mono font-medium">${fmtImporte(Number(ln.line_total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Asiento */}
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <BookOpenCheck size={16} className="text-integra-gold" />
              <h2 className="text-base font-semibold text-integra-navy">En el libro</h2>
            </div>
            {asiento ? (
              <AsientoTabla
                asiento={asiento}
                intro={`Asiento propio de la nota de crédito, con fecha ${formatDate(asiento.transaction_date)}: se debita el ingreso de cada línea (y el ITBMS) y se acredita Cuentas por Cobrar.`}
              />
            ) : esAnulacion && reversion ? (
              <AsientoTabla
                asiento={reversion}
                intro={`Esta nota de crédito acompaña la anulación de la factura: no tiene asiento propio. Lo que corrige el libro es la reversión del asiento de la factura (asiento ${reversion.entry_number}, ${formatDate(reversion.transaction_date)}).`}
              />
            ) : esAnulacion ? (
              <p className="text-sm text-gray-500">
                Esta nota de crédito acompaña la anulación de una factura que no estaba en el libro (anterior
                al cableado contable): no hay asiento que mostrar.
              </p>
            ) : (
              <p className="text-sm text-amber-800">
                Sin asiento en el libro. Si la emisión falló después de crear la nota, avisale a Oliver: no
                debería existir una nota de crédito parcial sin su asiento.
              </p>
            )}
          </section>
        </div>

        {/* Sidebar: totales */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border border-integra-gold/40 bg-integra-navy/[0.03] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-integra-navy mb-3">Resumen</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-600">Subtotal</dt>
                <dd className="font-mono font-medium text-gray-900">${fmtImporte(Number(nc.subtotal_total))}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Impuestos</dt>
                <dd className="font-mono font-medium text-gray-900">${fmtImporte(Number(nc.tax_total))}</dd>
              </div>
              <div className="border-t border-integra-gold/30 pt-2 flex justify-between">
                <dt className="font-semibold text-integra-navy">Total acreditado</dt>
                <dd className="font-mono text-lg font-bold text-integra-navy">
                  ${fmtImporte(Number(nc.grand_total))}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border bg-white p-4 text-xs text-gray-500">
            <p className="font-semibold text-gray-700 mb-1">Documento inmutable</p>
            <p>
              Una nota de crédito emitida no se edita ni se elimina: se reversa. Si está autorizada por la
              DGI, «Reversar» la anula primero ante la DGI y después en el libro.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function AsientoTabla({
  asiento,
  intro,
}: {
  asiento: {
    entry_number: number;
    transaction_date: string;
    description: string;
    reference: string | null;
    lines: { account_code: string; account_name: string; debit: number; credit: number; description: string | null }[];
  };
  intro: string;
}) {
  const debe = asiento.lines.reduce((s, l) => s + l.debit, 0);
  const haber = asiento.lines.reduce((s, l) => s + l.credit, 0);
  return (
    <div>
      <p className="text-sm text-gray-600">{intro}</p>
      <p className="mt-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700">
          Asiento {asiento.entry_number}
        </span>
        {asiento.reference && <span className="ml-2 font-mono">Ref. {asiento.reference}</span>}
        <span className="ml-2">{asiento.description}</span>
      </p>
      <div className="mt-3 overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Cuenta</th>
              <th className="px-3 py-2 font-semibold text-right">Debe</th>
              <th className="px-3 py-2 font-semibold text-right">Haber</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {asiento.lines.map((l, i) => (
              <tr key={i}>
                <td className="px-3 py-2">
                  <span className="font-mono text-xs text-gray-500">{l.account_code}</span>{" "}
                  <span className="text-gray-900">{l.account_name}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono">{l.debit > 0 ? fmtImporte(l.debit) : ""}</td>
                <td className="px-3 py-2 text-right font-mono">{l.credit > 0 ? fmtImporte(l.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold">
              <td className="px-3 py-2 text-right text-gray-600">Totales</td>
              <td className="px-3 py-2 text-right font-mono">{fmtImporte(debe)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmtImporte(haber)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
