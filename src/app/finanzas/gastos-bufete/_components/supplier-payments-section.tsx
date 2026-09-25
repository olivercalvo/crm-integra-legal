import { Banknote, CircleDollarSign, FileText, History, Undo2 } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { fmtImporte } from "@/lib/utils/importe";
import { PAYMENT_METHOD_LABEL } from "@/lib/finanzas/types/payment";
import type { SupplierPaymentForExpense } from "@/lib/finanzas/types/supplier-payment";
import { ReversePaymentDialog } from "@/app/finanzas/facturas/_components/reverse-payment-dialog";
import { RegisterSupplierPaymentDialog } from "./register-supplier-payment-dialog";
import { DeleteSupplierPaymentButton } from "./delete-supplier-payment-button";
import { DownloadReceiptPdfButton } from "@/components/finanzas/cobros/download-receipt-pdf-button";

interface Props {
  expenseId: string;
  /** Compra (default) o gasto de trámite (Bloque 4): cambia el endpoint del alta. */
  destino?: "compra" | "tramite";
  expenseLabel: string;
  total: number;
  amountPaid: number;
  /** Lo acreditado por NC del proveedor (066). 0 en gastos de trámite. */
  creditedTotal?: number;
  payments: SupplierPaymentForExpense[];
  bancos: { code: string; name: string }[];
  /** Admin, abogada y contador (los que mutan compras). */
  canMutate: boolean;
}

/**
 * Sección "Pagos" del detalle de la compra (Bloque 3). Espejo de "Pagos
 * registrados" de la factura:
 *   - Botón "Registrar pago" (si hay saldo y canMutate): monto precargado con
 *     el saldo; menos = pago parcial.
 *   - Cada pago: comprobante CE-, fecha, monto, método y banco, referencia,
 *     quién. Acciones: "Comprobante" (el PDF del comprobante de egreso, también
 *     para un pago reversado: sale con la banda roja) y, sin asiento →
 *     Eliminar; con asiento → Reversar. Nunca los dos últimos.
 *   - Un SALDO HEREDADO de la migración 048 se muestra como lo que es: "Saldo
 *     heredado de la migración — no es un pago registrado", SIN comprobante ni
 *     Reversar, con Eliminar (la corrección honesta si la compra nunca se pagó).
 *     El botón del PDF no se renderiza y la ruta le responde 409: emitir un
 *     comprobante de egreso por una salida de plata que el sistema no vio sería
 *     documentar algo que no pasó.
 *   - Un pago reversado sigue en la lista, tachado, con "Reversado · asiento N".
 */
export function SupplierPaymentsSection({ expenseId, destino = "compra", expenseLabel, total, amountPaid, creditedTotal = 0, payments, bancos, canMutate }: Props) {
  const saldo = Math.round((total - amountPaid - creditedTotal) * 100) / 100;
  const vigentes = payments.filter((p) => p.status === "registrado");
  const reversados = payments.filter((p) => p.status === "anulado").length;
  const heredados = vigentes.filter((p) => p.kind === "migrated_balance").length;

  const resumen =
    vigentes.length === 0
      ? reversados > 0
        ? `Sin pagos vigentes · ${reversados} reversado${reversados === 1 ? "" : "s"}`
        : "Aún no hay pagos registrados."
      : `${vigentes.length} pago${vigentes.length === 1 ? "" : "s"}` +
        (heredados > 0 ? ` (${heredados} saldo${heredados === 1 ? "" : "s"} heredado${heredados === 1 ? "" : "s"})` : "") +
        (reversados > 0 ? ` · ${reversados} reversado${reversados === 1 ? "" : "s"}` : "");

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2">
          <CircleDollarSign size={18} className="text-integra-gold mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-integra-navy">Pagos</h2>
            <p className="text-xs text-gray-500">{resumen}</p>
          </div>
        </div>
        {canMutate && saldo > 0.001 && (
          <RegisterSupplierPaymentDialog expenseId={expenseId} destino={destino} expenseLabel={expenseLabel} saldo={saldo} bancos={bancos} />
        )}
      </div>

      {/* Total / Pagado / Saldo */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-md border bg-gray-50 p-3">
          <div className="text-xs uppercase tracking-wider text-gray-500">Total</div>
          <div className="mt-1 font-mono text-base font-semibold text-integra-navy">B/. {fmtImporte(total)}</div>
        </div>
        <div className="rounded-md border bg-emerald-50 p-3">
          <div className="text-xs uppercase tracking-wider text-emerald-700">Pagado</div>
          <div className="mt-1 font-mono text-base font-semibold text-emerald-700">B/. {fmtImporte(amountPaid)}</div>
        </div>
        <div className={`rounded-md border p-3 ${saldo > 0.001 ? "bg-amber-50 border-amber-200" : "bg-gray-50"}`}>
          <div className={`text-xs uppercase tracking-wider ${saldo > 0.001 ? "text-amber-700" : "text-gray-500"}`}>Saldo</div>
          <div className={`mt-1 font-mono text-base font-semibold ${saldo > 0.001 ? "text-amber-700" : "text-gray-700"}`}>
            B/. {fmtImporte(saldo)}
          </div>
        </div>
      </div>

      {creditedTotal > 0.001 && (
        <p className="-mt-2 mb-4 text-xs text-gray-600">
          El saldo descuenta B/. {fmtImporte(creditedTotal)} acreditados por notas de crédito del proveedor.
        </p>
      )}

      {payments.length === 0 ? (
        <div className="rounded-md border border-dashed bg-gray-50/40 p-6 text-center text-sm text-gray-500">
          {canMutate ? 'Use el botón "Registrar pago" para asentar el primer pago.' : destino === "tramite" ? "Este gasto aún no tiene pagos." : "Esta compra aún no tiene pagos."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="pb-2 pr-3 font-semibold">Comprobante</th>
                <th className="pb-2 pr-3 font-semibold">Fecha</th>
                <th className="pb-2 pr-3 font-semibold text-right">Monto</th>
                <th className="pb-2 pr-3 font-semibold">Método · Banco</th>
                <th className="pb-2 pr-3 font-semibold">Referencia</th>
                <th className="pb-2 pr-3 font-semibold">Registrado por</th>
                <th className="pb-2 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => {
                const reversado = p.status === "anulado";
                const heredado = p.kind === "migrated_balance";
                const label = `${heredado ? "Saldo heredado" : p.payment_number ?? "Pago"} · B/. ${fmtImporte(p.amount)} del ${formatDate(p.payment_date)}`;
                const canDelete = !reversado && canMutate && !p.asiento;
                const canReverse = !reversado && canMutate && !!p.asiento && !heredado;
                // Solo un PAGO tiene comprobante; el heredado no (ver arriba).
                const tieneComprobante = !heredado && !!p.payment_number;
                return (
                  <tr key={p.id} className={reversado ? "bg-gray-50/70 text-gray-400" : heredado ? "bg-amber-50/40" : ""}>
                    <td className={`py-2 pr-3 font-mono text-xs whitespace-nowrap ${reversado ? "line-through" : "font-semibold text-integra-navy"}`}>
                      {heredado ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-sans text-xs font-semibold text-amber-800"
                          title="La compra estaba marcada como pagada antes de que existieran los pagos a proveedor (migración 048). No es un pago registrado: no tiene comprobante ni asiento. Si la compra nunca se pagó, elimínelo."
                        >
                          <History size={12} />
                          Saldo heredado de la migración
                        </span>
                      ) : (
                        p.payment_number ?? ""
                      )}
                    </td>
                    <td className={`py-2 pr-3 whitespace-nowrap ${reversado ? "line-through" : "text-gray-900"}`}>{formatDate(p.payment_date)}</td>
                    <td className={`py-2 pr-3 text-right font-mono font-medium whitespace-nowrap ${reversado ? "line-through" : "text-emerald-700"}`}>
                      B/. {fmtImporte(p.amount)}
                    </td>
                    <td className="py-2 pr-3">
                      {reversado && p.reversion ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800"
                          title={`${p.reversion.reason} · ${formatDateTime(p.reversion.reversed_at)}${p.reversion.reversed_by_name ? ` · ${p.reversion.reversed_by_name}` : ""}`}
                        >
                          <Undo2 size={12} />
                          Reversado · asiento {p.reversion.entry_number}
                        </span>
                      ) : heredado ? (
                        <span className="text-xs text-gray-500 italic">no es un pago registrado</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-gray-700 whitespace-nowrap">
                          <Banknote size={12} className="text-gray-400" />
                          {p.method ? PAYMENT_METHOD_LABEL[p.method] : ""}
                          {p.bank_name && <span className="text-xs text-gray-500">· {p.bank_name}</span>}
                          {p.asiento && (
                            <span className="text-xs text-gray-400" title="Asiento en el Diario General">
                              · asiento {p.asiento.entry_number}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className={`py-2 pr-3 ${reversado ? "" : "text-gray-600"}`}>
                      {reversado && p.reversion ? (
                        <span className="text-xs italic" title={p.reversion.reason}>{p.reversion.reason}</span>
                      ) : p.reference ? (
                        <span className="inline-flex items-center gap-1">
                          <FileText size={12} className="text-gray-400" />
                          {p.reference}
                        </span>
                      ) : null}
                    </td>
                    <td className={`py-2 pr-3 ${reversado ? "" : "text-gray-600"}`}>{p.created_by_name ?? ""}</td>
                    <td className="py-2 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        {tieneComprobante && (
                          <DownloadReceiptPdfButton
                            variante="egreso"
                            paymentId={p.id}
                            receiptLabel={p.payment_number ?? ""}
                            compact
                          />
                        )}
                        {canReverse && p.asiento ? (
                          <ReversePaymentDialog
                            variante="pago"
                            paymentId={p.id}
                            paymentLabel={label}
                            asiento={p.asiento}
                            invoiceNumber={expenseLabel}
                          />
                        ) : canDelete ? (
                          <DeleteSupplierPaymentButton paymentId={p.id} paymentLabel={label} heredado={heredado} />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
