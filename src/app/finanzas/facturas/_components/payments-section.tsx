import { CircleDollarSign, Banknote, FileText } from "lucide-react";
import { formatDate } from "@/lib/utils/format-date";
import {
  PAYMENT_METHOD_LABEL,
  type PaymentForInvoice,
} from "@/lib/finanzas/types/payment";
import { RegisterPaymentDialog } from "./register-payment-dialog";
import { DeletePaymentButton } from "./delete-payment-button";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  payments: PaymentForInvoice[];
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  /** True si el rol del usuario actual puede registrar/eliminar pagos. */
  canMutate: boolean;
}

/**
 * Sección "Pagos registrados" del detalle de factura.
 * Visible cuando status ∈ emitida/parc/pagada. Muestra:
 *   - Resumen Total / Pagado / Saldo
 *   - Botón "Registrar pago" (visible solo si balance_due > 0 y canMutate)
 *   - Tabla con fila por pago (fecha, monto, método, referencia, registrado por)
 *   - Botón eliminar por fila (solo canMutate y status='registrado')
 */
export function PaymentsSection({
  invoiceId,
  invoiceNumber,
  payments,
  grandTotal,
  amountPaid,
  balanceDue,
  canMutate,
}: Props) {
  const hasPayments = payments.length > 0;
  const showRegisterButton = canMutate && balanceDue > 0.001;

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2">
          <CircleDollarSign size={18} className="text-integra-gold mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-integra-navy">
              Pagos registrados
            </h2>
            <p className="text-xs text-gray-500">
              {hasPayments
                ? `${payments.length} pago${payments.length === 1 ? "" : "s"} aplicado${payments.length === 1 ? "" : "s"} a esta factura`
                : "Aún no hay pagos registrados."}
            </p>
          </div>
        </div>
        {showRegisterButton && (
          <RegisterPaymentDialog
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
            ${grandTotal.toFixed(2)}
          </div>
        </div>
        <div className="rounded-md border bg-emerald-50 p-3">
          <div className="text-xs uppercase tracking-wider text-emerald-700">
            Pagado
          </div>
          <div className="mt-1 font-mono text-base font-semibold text-emerald-700">
            ${amountPaid.toFixed(2)}
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
            ${balanceDue.toFixed(2)}
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
                {canMutate && <th className="pb-2 font-semibold w-10"></th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => {
                const amount = Number(p.amount_applied);
                const canDelete = canMutate && p.status === "registrado";
                return (
                  <tr key={p.id}>
                    <td className="py-2 pr-3 text-gray-900">
                      {formatDate(p.payment_date)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono font-medium text-emerald-700">
                      ${amount.toFixed(2)}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1 text-gray-700">
                        <Banknote size={12} className="text-gray-400" />
                        {PAYMENT_METHOD_LABEL[p.method]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-gray-600">
                      {p.reference ? (
                        <span className="inline-flex items-center gap-1">
                          <FileText size={12} className="text-gray-400" />
                          {p.reference}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-gray-600">
                      {p.created_by_name ?? (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    {canMutate && (
                      <td className="py-2 text-right">
                        {canDelete ? (
                          <DeletePaymentButton
                            paymentId={p.id}
                            paymentLabel={`B/. ${amount.toFixed(2)} del ${formatDate(
                              p.payment_date
                            )}`}
                          />
                        ) : (
                          <span
                            className="text-xs text-gray-400"
                            title="Pago conciliado: solo eliminable desde conciliación bancaria"
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
            ? "Hacé clic en \"Registrar pago\" para asentar el primer cobro."
            : "Esta factura aún no tiene pagos."}
        </div>
      )}
    </section>
  );
}
