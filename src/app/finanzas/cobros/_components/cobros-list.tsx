import Link from "next/link";
import { Banknote, FileText, Undo2 } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { fmtImporte } from "@/lib/utils/importe";
import { PAYMENT_METHOD_LABEL, type PaymentListItem } from "@/lib/finanzas/types/payment";
import { ReversePaymentDialog } from "@/app/finanzas/facturas/_components/reverse-payment-dialog";
import { DownloadReceiptPdfButton } from "@/components/finanzas/cobros/download-receipt-pdf-button";

interface Props {
  payments: PaymentListItem[];
  /** Admin, abogada y contador. El botón solo aparece si el cobro tiene asiento. */
  canReverse: boolean;
}

/**
 * Tabla de recibos de caja. Desktop: tabla; mobile: cards (48px de tap).
 *
 * Reversar usa el MISMO diálogo que el detalle de la factura
 * (`facturas/_components/reverse-payment-dialog.tsx`), sin moverlo de archivo:
 * `reversion-una-sola-implementacion.test.ts` lo lee por ruta literal. El
 * diálogo hace `router.refresh()` al terminar, así que esta lista se
 * actualiza sola.
 *
 * No hay detalle de cobro (`/finanzas/cobros/{id}`) en este bloque: el enlace
 * de cada fila lleva a la factura, que es donde vive el cobro.
 */
export function CobrosList({ payments, canReverse }: Props) {
  return (
    <>
      {/* Desktop */}
      <div className="hidden lg:block overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Recibo</th>
              <th className="px-4 py-3 font-semibold">Fecha</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Factura</th>
              <th className="px-4 py-3 font-semibold text-right">Monto</th>
              <th className="px-4 py-3 font-semibold">Método</th>
              <th className="px-4 py-3 font-semibold">Referencia</th>
              <th className="px-4 py-3 font-semibold">Registrado por</th>
              <th className="px-4 py-3 font-semibold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {payments.map((p) => {
              const reversado = !!p.reversion || p.status === "anulado";
              const tachado = reversado ? "line-through" : "";
              return (
                <tr key={p.id} className={reversado ? "bg-gray-50/70 text-gray-400" : "hover:bg-gray-50"}>
                  <td className={`px-4 py-3 font-mono text-xs whitespace-nowrap ${reversado ? tachado : "font-semibold text-integra-navy"}`}>
                    {p.payment_number ?? ""}
                  </td>
                  <td className={`px-4 py-3 whitespace-nowrap ${tachado}`}>{formatDate(p.payment_date)}</td>
                  <td className="px-4 py-3">
                    <div className={`font-medium ${reversado ? "" : "text-gray-900"}`}>{p.client_name}</div>
                    {p.client_number && (
                      <div className="text-xs text-gray-400 font-mono">{p.client_number}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Facturas facturas={p.facturas} reversado={reversado} />
                  </td>
                  <td className={`px-4 py-3 text-right font-mono font-medium whitespace-nowrap ${reversado ? tachado : "text-emerald-700"}`}>
                    ${fmtImporte(Number(p.amount))}
                  </td>
                  <td className="px-4 py-3">
                    <Estado p={p} reversado={reversado} />
                  </td>
                  <td className={`px-4 py-3 ${reversado ? "" : "text-gray-600"}`}>
                    <Referencia p={p} reversado={reversado} />
                  </td>
                  <td className={`px-4 py-3 ${reversado ? "" : "text-gray-600"}`}>{p.created_by_name ?? ""}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-2">
                      {p.payment_number && (
                        <DownloadReceiptPdfButton paymentId={p.id} receiptLabel={p.payment_number} compact />
                      )}
                      {canReverse && <Accion p={p} reversado={reversado} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="lg:hidden space-y-3">
        {payments.map((p) => {
          const reversado = !!p.reversion || p.status === "anulado";
          return (
            <div
              key={p.id}
              className={`rounded-lg border bg-white p-4 shadow-sm ${reversado ? "bg-gray-50/70 text-gray-400" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`font-mono text-sm ${reversado ? "line-through" : "font-semibold text-integra-navy"}`}>
                    {p.payment_number ?? ""}
                  </div>
                  <div className={`text-xs ${reversado ? "line-through" : "text-gray-500"}`}>{formatDate(p.payment_date)}</div>
                </div>
                <div className={`font-mono font-semibold ${reversado ? "line-through" : "text-emerald-700"}`}>
                  ${fmtImporte(Number(p.amount))}
                </div>
              </div>
              <div className={`mt-2 text-sm ${reversado ? "" : "text-gray-900"}`}>{p.client_name}</div>
              <div className="mt-1 text-sm">
                <Facturas facturas={p.facturas} reversado={reversado} />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <Estado p={p} reversado={reversado} />
                <div className="inline-flex items-center gap-2">
                  {p.payment_number && (
                    <DownloadReceiptPdfButton paymentId={p.id} receiptLabel={p.payment_number} compact />
                  )}
                  {canReverse && <Accion p={p} reversado={reversado} />}
                </div>
              </div>
              <div className={`mt-1 text-xs ${reversado ? "" : "text-gray-500"}`}>
                <Referencia p={p} reversado={reversado} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Facturas({ facturas, reversado }: { facturas: PaymentListItem["facturas"]; reversado: boolean }) {
  if (facturas.length === 0) return <span className="text-gray-400"></span>;
  return (
    <div className="space-y-0.5">
      {facturas.map((f) => (
        <Link
          key={f.invoice_id}
          href={`/finanzas/facturas/${f.invoice_id}`}
          className={`block font-mono text-xs whitespace-nowrap hover:underline ${reversado ? "line-through" : "text-integra-navy"}`}
        >
          {f.invoice_number}
          {facturas.length > 1 && (
            <span className="ml-1 text-gray-400 no-underline">· ${fmtImporte(f.amount_applied)}</span>
          )}
        </Link>
      ))}
    </div>
  );
}

function Estado({ p, reversado }: { p: PaymentListItem; reversado: boolean }) {
  if (reversado && p.reversion) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800"
        title={`${p.reversion.reason} · ${formatDateTime(p.reversion.reversed_at)}${
          p.reversion.reversed_by_name ? ` · ${p.reversion.reversed_by_name}` : ""
        }`}
      >
        <Undo2 size={12} />
        Reversado · asiento {p.reversion.entry_number}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-gray-700">
      <Banknote size={12} className="text-gray-400" />
      {PAYMENT_METHOD_LABEL[p.method]}
      {p.asiento && (
        <span className="ml-1 text-xs text-gray-400" title="Asiento en el Diario General">
          · asiento {p.asiento.entry_number}
        </span>
      )}
    </span>
  );
}

function Referencia({ p, reversado }: { p: PaymentListItem; reversado: boolean }) {
  if (reversado && p.reversion) {
    return (
      <span className="text-xs italic" title={p.reversion.reason}>
        {p.reversion.reason}
      </span>
    );
  }
  if (!p.reference) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <FileText size={12} className="text-gray-400" />
      {p.reference}
    </span>
  );
}

function Accion({ p, reversado }: { p: PaymentListItem; reversado: boolean }) {
  if (reversado || p.status !== "registrado" || !p.asiento) return null;
  return (
    <ReversePaymentDialog
      paymentId={p.id}
      paymentLabel={`${p.payment_number ?? "Cobro"} · B/. ${fmtImporte(Number(p.amount))} del ${formatDate(p.payment_date)}`}
      asiento={p.asiento}
      invoiceNumber={p.facturas.map((f) => f.invoice_number).join(", ")}
    />
  );
}
