import { CircleDollarSign, Banknote, FileText, Undo2 } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import {
  PAYMENT_METHOD_LABEL,
  type PaymentForInvoice,
} from "@/lib/finanzas/types/payment";
import { RegisterPaymentDialog } from "./register-payment-dialog";
import { DeletePaymentButton } from "./delete-payment-button";
import { ReversePaymentDialog } from "./reverse-payment-dialog";
import { fmtImporte } from "@/lib/utils/importe";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  payments: PaymentForInvoice[];
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  /** Las cuentas ofrecidas como banco del cobro. */
  bancos: { code: string; name: string }[];
  /** True si el rol del usuario actual puede registrar/eliminar pagos. */
  canMutate: boolean;
  /**
   * True si puede REVERSAR un cobro contabilizado. Es una bandera aparte de
   * `canMutate` a propósito: el contador reversa (corregir el libro es su
   * trabajo, guía de RM) pero no registra ni elimina cobros. Ampliar una no
   * amplía la otra.
   */
  canReverse: boolean;
}

/**
 * Sección "Pagos registrados" del detalle de factura.
 * Visible cuando status ∈ emitida/parc/pagada. Muestra:
 *   - Resumen Total / Pagado / Saldo
 *   - Botón "Registrar pago" (visible solo si balance_due > 0 y canMutate)
 *   - Tabla con fila por pago (fecha, monto, método, referencia, registrado por)
 *   - Acción por fila, según el cobro:
 *       · sin asiento en el libro → Eliminar (canMutate)
 *       · con asiento             → Reversar (canReverse)
 *       · reversado               → fila tachada, sin acción
 */
export function PaymentsSection({
  bancos,
  invoiceId,
  invoiceNumber,
  payments,
  grandTotal,
  amountPaid,
  balanceDue,
  canMutate,
  canReverse,
}: Props) {
  const vigentes = payments.filter((p) => !p.reversion);
  const reversados = payments.length - vigentes.length;
  const hasPayments = payments.length > 0;
  const showRegisterButton = canMutate && balanceDue > 0.001;
  const showActionColumn = canMutate || canReverse;

  const resumen =
    vigentes.length === 0
      ? reversados > 0
        ? `Sin pagos vigentes · ${reversados} reversado${reversados === 1 ? "" : "s"}`
        : "Aún no hay pagos registrados."
      : `${vigentes.length} pago${vigentes.length === 1 ? "" : "s"} aplicado${vigentes.length === 1 ? "" : "s"} a esta factura` +
        (reversados > 0 ? ` · ${reversados} reversado${reversados === 1 ? "" : "s"}` : "");

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2">
          <CircleDollarSign size={18} className="text-integra-gold mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-integra-navy">
              Pagos registrados
            </h2>
            <p className="text-xs text-gray-500">{resumen}</p>
          </div>
        </div>
        {showRegisterButton && (
          <RegisterPaymentDialog
          bancos={bancos}
            invoiceId={invoiceId}
            invoiceNumber={invoiceNumber}
            balanceDue={balanceDue}
          />
        )}
      </div>

      {/* Resumen Total / Pagado / Saldo */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-md border bg-gray-50 p-3">
          <div className="text-xs uppercase tracking-wider text-gray-500">
            Total
          </div>
          <div className="mt-1 font-mono text-base font-semibold text-integra-navy">
            ${fmtImporte(grandTotal)}
          </div>
        </div>
        <div className="rounded-md border bg-emerald-50 p-3">
          <div className="text-xs uppercase tracking-wider text-emerald-700">
            Pagado
          </div>
          <div className="mt-1 font-mono text-base font-semibold text-emerald-700">
            ${fmtImporte(amountPaid)}
          </div>
        </div>
        <div
          className={`rounded-md border p-3 ${
            balanceDue > 0.001
              ? "bg-amber-50 border-amber-200"
              : "bg-gray-50"
          }`}
        >
          <div
            className={`text-xs uppercase tracking-wider ${
              balanceDue > 0.001 ? "text-amber-700" : "text-gray-500"
            }`}
          >
            Saldo
          </div>
          <div
            className={`mt-1 font-mono text-base font-semibold ${
              balanceDue > 0.001 ? "text-amber-700" : "text-gray-700"
            }`}
          >
            ${fmtImporte(balanceDue)}
          </div>
        </div>
      </div>

      {/* Tabla de pagos */}
      {hasPayments ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="pb-2 pr-3 font-semibold">Fecha</th>
                <th className="pb-2 pr-3 font-semibold text-right">Monto</th>
                <th className="pb-2 pr-3 font-semibold">Método</th>
                <th className="pb-2 pr-3 font-semibold">Referencia</th>
                <th className="pb-2 pr-3 font-semibold">Registrado por</th>
                {showActionColumn && <th className="pb-2 font-semibold w-10"></th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => {
                const amount = Number(p.amount_applied);
                const label = `B/. ${fmtImporte(amount)} del ${formatDate(p.payment_date)}`;
                const reversado = !!p.reversion;
                // Sin asiento se ELIMINA; con asiento se REVERSA. Nunca las dos.
                const canDelete =
                  !reversado && canMutate && p.status === "registrado" && !p.asiento;
                const canReverseThis =
                  !reversado && canReverse && p.status === "registrado" && !!p.asiento;
                return (
                  <tr key={p.id} className={reversado ? "bg-gray-50/70 text-gray-400" : ""}>
                    <td className={`py-2 pr-3 ${reversado ? "line-through" : "text-gray-900"}`}>
                      {formatDate(p.payment_date)}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-mono font-medium ${
                        reversado ? "line-through" : "text-emerald-700"
                      }`}
                    >
                      ${fmtImporte(amount)}
                    </td>
                    <td className="py-2 pr-3">
                      {reversado && p.reversion ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800"
                          title={`${p.reversion.reason} — ${formatDateTime(p.reversion.reversed_at)}${
                            p.reversion.reversed_by_name ? ` · ${p.reversion.reversed_by_name}` : ""
                          }`}
                        >
                          <Undo2 size={12} />
                          Reversado · asiento {p.reversion.entry_number}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-gray-700">
                          <Banknote size={12} className="text-gray-400" />
                          {PAYMENT_METHOD_LABEL[p.method]}
                        </span>
                      )}
                    </td>
                    <td className={`py-2 pr-3 ${reversado ? "" : "text-gray-600"}`}>
                      {reversado && p.reversion ? (
                        <span className="text-xs italic" title={p.reversion.reason}>
                          {p.reversion.reason}
                        </span>
                      ) : p.reference ? (
                        <span className="inline-flex items-center gap-1">
                          <FileText size={12} className="text-gray-400" />
                          {p.reference}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className={`py-2 pr-3 ${reversado ? "" : "text-gray-600"}`}>
                      {p.created_by_name ?? (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    {showActionColumn && (
                      <td className="py-2 text-right">
                        {canReverseThis && p.asiento ? (
                          <ReversePaymentDialog
                            paymentId={p.id}
                            paymentLabel={label}
                            asiento={p.asiento}
                            invoiceNumber={invoiceNumber}
                          />
                        ) : canDelete ? (
                          <DeletePaymentButton paymentId={p.id} paymentLabel={label} />
                        ) : reversado ? null : (
                          <span
                            className="text-xs text-gray-400"
                            title={
                              p.asiento
                                ? `Cobro contabilizado (asiento ${p.asiento.entry_number}): se corrige con una reversión`
                                : "Pago conciliado: solo eliminable desde conciliación bancaria"
                            }
                          >
                            —
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-md border border-dashed bg-gray-50/40 p-6 text-center text-sm text-gray-500">
          {showRegisterButton
            ? "Use el botón \"Registrar pago\" para asentar el primer cobro."
            : "Esta factura aún no tiene pagos."}
        </div>
      )}
    </section>
  );
}
