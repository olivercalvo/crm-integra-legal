import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  BookOpenCheck,
  CalendarDays,
  Copy,
  FileText,
  Hash,
  Undo2,
  User,
} from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { fmtImporte } from "@/lib/utils/importe";
import { getAsientoDelLibro } from "@/lib/finanzas/queries/asiento-manual";
import { tipoTransaccionLabel } from "@/lib/finanzas/reports/libro-mayor";
import { RUTA_DEL_DOCUMENTO } from "@/lib/finanzas/reports/destino-documento";

/**
 * DETALLE DE UN ASIENTO DEL LIBRO — solo lectura (Bloque 7, commit 4).
 *
 * No existía. Hasta ahora `/finanzas/asientos` era el FORMULARIO y el listado
 * era el Diario General, que muestra los asientos pero no deja pararse en uno.
 * Clonar (7.4) y reversar (7.6) necesitan ese lugar.
 *
 * 🔒 ADMIN Y CONTADOR, como el formulario: cae dentro del prefijo
 * `/finanzas/asientos` de `ADMIN_CONTADOR_ONLY_PREFIXES`, así que el middleware
 * ya lo cubre. El `redirect` de abajo es defensa en profundidad.
 *
 * ⚠️ **Se abre CUALQUIER asiento, no solo los manuales.** El Diario y el Mayor
 * los listan todos y llegar al detalle de una factura desde acá es legítimo. Lo
 * que está acotado a `manual` son las ACCIONES: clonar y reversar. Un asiento
 * con documento se corrige por su documento —anular la factura, reversar el
 * cobro— y esta pantalla enlaza ahí en vez de ofrecer un atajo que se saltearía
 * `cancelInvoice` y toda la lógica de nota de crédito.
 */

export const metadata = {
  title: "Asiento · Finanzas",
};

/** Tiene que coincidir con `ADMIN_CONTADOR_ONLY_PREFIXES` y con la ruta de API. */
const ROLES = ["admin", "contador"];

interface PageProps {
  params: { id: string };
}

export default async function AsientoDetallePage({ params }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const asiento = await getAsientoDelLibro(ctx.db, ctx.tenantId, params.id);
  if (!asiento) notFound();

  const esManual = asiento.source_type === "manual";
  const yaReversado = asiento.reversadoPor !== null;
  // El documento que originó el asiento, cuando lo tiene. Es el mismo
  // resolvedor que usan el Mayor y el Diario: una sola tabla de destinos.
  const rutaDocumento =
    asiento.source_id && RUTA_DEL_DOCUMENTO[asiento.source_type]
      ? RUTA_DEL_DOCUMENTO[asiento.source_type](asiento.source_id)
      : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <BackButton fallbackHref="/finanzas/reportes/diario" label="Volver al Diario" showLabel />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <BookOpenCheck size={20} className="text-integra-gold shrink-0" />
              <h1 className="text-2xl font-bold text-integra-navy">Asiento {asiento.entry_number}</h1>
              <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                {tipoTransaccionLabel(asiento.source_type)}
              </span>
              {yaReversado && (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                  <Undo2 size={13} />
                  Reversado por el {asiento.reversadoPor!.entry_number}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Registrado el {formatDateTime(asiento.created_at)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* CLONAR (7.4). Solo en asientos manuales: clonar el de una factura
              crearía a mano un asiento que el documento va a volver a generar.
              nav-guard-ok: esta pantalla ya es admin+contador, los mismos del
              formulario al que lleva. */}
          {esManual && (
            <Link
              href={`/finanzas/asientos?clonar=${asiento.id}`}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-integra-navy/30 bg-white px-4 text-sm font-semibold text-integra-navy hover:bg-integra-navy hover:text-white"
            >
              <Copy size={16} />
              Clonar
            </Link>
          )}
        </div>
      </div>

      {/* Los dos lados de la reversión (D6) */}
      {(asiento.reversa || asiento.reversadoPor) && (
        <div className="space-y-2">
          {asiento.reversa && (
            <div className="flex items-start gap-2 rounded-md border-l-4 border-gray-300 bg-gray-50 p-3 text-sm text-gray-700">
              <Undo2 size={16} className="mt-0.5 shrink-0 text-gray-500" />
              <p>
                Este asiento <strong>reversa</strong> al{" "}
                <Link href={`/finanzas/asientos/${asiento.reversa.id}`} className="font-semibold underline">
                  asiento {asiento.reversa.entry_number}
                </Link>{" "}
                del {formatDate(asiento.reversa.transaction_date)}.
                {asiento.reversal_reason && <> Motivo: {asiento.reversal_reason}</>}
              </p>
            </div>
          )}
          {asiento.reversadoPor && (
            <div className="flex items-start gap-2 rounded-md border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-900">
              <Undo2 size={16} className="mt-0.5 shrink-0 text-red-600" />
              <p>
                Este asiento <strong>fue reversado</strong> por el{" "}
                <Link
                  href={`/finanzas/asientos/${asiento.reversadoPor.id}`}
                  className="font-semibold underline"
                >
                  asiento {asiento.reversadoPor.entry_number}
                </Link>{" "}
                del {formatDate(asiento.reversadoPor.transaction_date)}. Los dos siguen en el libro: una
                reversión no borra, refleja.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Datos generales */}
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-integra-navy">Datos generales</h2>
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="flex items-center gap-1 text-xs uppercase tracking-wider text-gray-500">
                  <FileText size={12} /> Naturaleza de la operación
                </dt>
                <dd className="mt-1 font-medium text-gray-900">{asiento.description}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs uppercase tracking-wider text-gray-500">
                  <CalendarDays size={12} /> Fecha de la operación
                </dt>
                <dd className="mt-1 font-medium text-gray-900">{formatDate(asiento.transaction_date)}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs uppercase tracking-wider text-gray-500">
                  <CalendarDays size={12} /> Fecha de registro
                </dt>
                <dd className="mt-1 font-medium text-gray-900">{formatDate(asiento.record_date)}</dd>
              </div>
              {asiento.reference && (
                <div>
                  <dt className="flex items-center gap-1 text-xs uppercase tracking-wider text-gray-500">
                    <Hash size={12} /> Referencia
                  </dt>
                  <dd className="mt-1 font-mono text-gray-900">{asiento.reference}</dd>
                </div>
              )}
              {rutaDocumento && (
                <div>
                  <dt className="text-xs uppercase tracking-wider text-gray-500">Documento de origen</dt>
                  <dd className="mt-1">
                    {/* nav-guard-ok: solo admin y contador abren esta pantalla, y las
                        rutas de RUTA_DEL_DOCUMENTO las cubre nav-guard.test.ts para
                        los dos roles. */}
                    <Link href={rutaDocumento} className="font-semibold text-integra-navy underline">
                      Abrir el documento
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* Líneas */}
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-integra-navy">Líneas</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="pb-2 pr-3 font-semibold">Cuenta</th>
                    <th className="pb-2 pr-3 font-semibold">Descripción</th>
                    <th className="pb-2 pr-3 font-semibold">Tercero</th>
                    <th className="pb-2 pr-3 text-right font-semibold">Débito</th>
                    <th className="pb-2 text-right font-semibold">Crédito</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {asiento.lineas.map((l) => (
                    <tr key={l.line_order}>
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs text-gray-500">{l.account_code}</span>
                        <span className="ml-2 text-gray-900">{l.account_name}</span>
                      </td>
                      <td className="py-2 pr-3 text-gray-600">{l.descripcion}</td>
                      <td className="py-2 pr-3 text-gray-600">
                        {l.tercero ? (
                          <span className="inline-flex items-center gap-1">
                            <User size={12} className="text-gray-400" />
                            {l.tercero}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {l.debit > 0 ? fmtImporte(l.debit) : ""}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {l.credit > 0 ? fmtImporte(l.credit) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-gray-50 font-semibold">
                    <td colSpan={3} className="px-1 py-2 text-right text-gray-600">
                      Totales
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-integra-navy">
                      {fmtImporte(asiento.lineas.reduce((s, l) => s + l.debit, 0))}
                    </td>
                    <td className="py-2 text-right font-mono text-integra-navy">
                      {fmtImporte(asiento.lineas.reduce((s, l) => s + l.credit, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border border-integra-gold/40 bg-integra-navy/[0.03] p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-integra-navy">
              Resumen
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-600">Líneas</dt>
                <dd className="font-mono font-medium text-gray-900">{asiento.lineas.length}</dd>
              </div>
              <div className="flex justify-between border-t border-integra-gold/30 pt-2">
                <dt className="font-semibold text-integra-navy">Importe</dt>
                <dd className="font-mono text-lg font-bold text-integra-navy">
                  B/. {fmtImporte(asiento.total)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border bg-white p-4 text-xs text-gray-500">
            <p className="mb-1 font-semibold text-gray-700">Asiento inmutable</p>
            <p>
              Un asiento registrado no se edita ni se borra: los triggers del libro rechazan las dos
              cosas. {esManual
                ? "Si está mal, se reversa: queda el original y su espejo."
                : "Este asiento salió de un documento, así que se corrige por el documento — anulando la factura o reversando el cobro, no desde acá."}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
