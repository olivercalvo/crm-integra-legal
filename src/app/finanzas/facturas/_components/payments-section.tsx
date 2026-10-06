import { ContabilizadoFueraBadge } from "@/components/finanzas/contabilizado-fuera-badge";
import { esContabilizadoFuera, mensajeContabilizadoFueraNoSeAnula } from "@/lib/finanzas/contabilidad/inicio-contable";
import { CircleDollarSign, Banknote, FileText, Undo2 } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { DownloadReceiptPdfButton } from "@/components/finanzas/cobros/download-receipt-pdf-button";
import {
  PAYMENT_METHOD_LABEL,
  type PaymentForInvoice,
} from "@/lib/finanzas/types/payment";
import { RegisterPaymentDialog } from "./register-payment-dialog";
import { DeletePaymentButton } from "./delete-payment-button";
import { ReversePaymentDialog } from "./reverse-payment-dialog";
import { fmtImporte } from "@/lib/utils/importe";
import { ApplyCreditButton } from "./apply-credit-button";
import type { SaldoAFavor } from "@/lib/finanzas/api/saldo-a-favor";

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
  /** 074: cobros del mismo cliente con saldo sin aplicar (más viejos primero). */
  saldosAFavor?: SaldoAFavor[];
  /**
   * 074: admin, abogada y CONTADOR (Oliver, 01/10/2026). Bandera aparte de
   * `canMutate`: el contador aplica un saldo a favor pero no registra cobros.
   */
  canApplyCredit?: boolean;
  /** Inicio contable (096): un cobro anterior lleva «Contabilizado fuera». */
  inicio?: string;
}

/**
 * Sección "Pagos registrados" del detalle de factura.
 * Visible cuando status ∈ emitida/parc/pagada. Muestra:
 *   - Resumen Total / Pagado / Saldo
 *   - Botón "Registrar cobro" (visible solo si balance_due > 0 y canMutate). Un pago es dinero que sale; esto es un cobro.
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
  saldosAFavor = [],
  canApplyCredit = false,
  inicio,
}: Props) {
  const vigentes = payments.filter((p) => !p.reversion);
  const reversados = payments.length - vigentes.length;
  const hasPayments = payments.length > 0;
  const showRegisterButton = canMutate && balanceDue > 0.001;
  // La columna de acciones siempre existe: el recibo en PDF lo baja cualquiera
  // que vea esta pantalla (admin, abogada, contador). Reversar/Eliminar siguen
  // gateados por canReverse / canMutate.
  const showActionColumn = true;

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

      {/* 074: el saldo a favor del cliente, aplicable a esta factura. */}
      {canApplyCredit && balanceDue > 0.005 && saldosAFavor.length > 0 && (
        <div className="mb-4 space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">
            El cliente tiene saldo a favor: B/.{" "}
            {fmtImporte(saldosAFavor.reduce((s, x) => s + x.disponible, 0))}. Se aplica sin asiento:
            el dinero ya está en Cuentas por Cobrar.
          </p>
          {saldosAFavor.map((s) => (
            <div key={s.payment_id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-emerald-800">
                <span className="font-mono">{s.payment_number ?? "Cobro"}</span> del {formatDate(s.payment_date)}:
                B/. {fmtImporte(s.disponible)} disponibles
              </span>
              <ApplyCreditButton
                paymentId={s.payment_id}
                paymentNumber={s.payment_number}
                invoiceId={invoiceId}
                monto={Math.min(s.disponible, Math.round(balanceDue * 100) / 100)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Resumen Total / Pagado / Saldo */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-md border bg-gray-50 p-3">
          <div className="text-xs uppercase tracking-wider text-gray-500">
            Total
          </div>
          <div className="mt-1 font-mono text-base font-semibold text-integra-navy">
            B/. {fmtImporte(grandTotal)}
          </div>
        </div>
        <div className="rounded-md border bg-emerald-50 p-3">
          <div className="text-xs uppercase tracking-wider text-emerald-700">
            Pagado
          </div>
          <div className="mt-1 font-mono text-base font-semibold text-emerald-700">
            B/. {fmtImporte(amountPaid)}
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
            B/. {fmtImporte(balanceDue)}
          </div>
        </div>
      </div>

      {/* Tabla de pagos */}
      {hasPayments ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="pb-2 pr-3 font-semibold">Recibo</th>
                <th className="pb-2 pr-3 font-semibold">Fecha</th>
                <th className="pb-2 pr-3 font-semibold text-right">Monto</th>
                <th className="pb-2 pr-3 font-semibold">Método</th>
                <th className="pb-2 pr-3 font-semibold">Referencia</th>
                <th className="pb-2 pr-3 font-semibold">Registrado por</th>
                {showActionColumn && <th className="pb-2 font-semibold text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => {
                const amount = Number(p.amount_applied);
                const label = `B/. ${fmtImporte(amount)} del ${formatDate(p.payment_date)}`;
                const reversado = !!p.reversion;
                // Sin asiento se ELIMINA; con asiento se REVERSA. Nunca las dos.
                // 096: un cobro contabilizado fuera (anterior al inicio) no se
                // elimina. La ruta responde 409 y la base lo rechaza igual.
                const fuera = !!inicio && esContabilizadoFuera(p.payment_date, inicio);
                const canDelete =
                  !reversado && canMutate && p.status === "registrado" && !p.asiento && !fuera;
                const canReverseThis =
                  !reversado && canReverse && p.status === "registrado" && !!p.asiento;
                return (
                  <tr key={p.id} className={reversado ? "bg-gray-50/70 text-gray-400" : ""}>
                    {/* El número de recibo (047). Un cobro reversado conserva el suyo:
                        existió, y el número no se reusa. Vacío solo si el cobro es
                        anterior al backfill en una base donde la 047 no corrió. */}
                    <td
                      className={`py-2 pr-3 font-mono text-xs whitespace-nowrap ${
                        reversado ? "line-through" : "text-integra-navy font-semibold"
                      }`}
                    >
                      {p.payment_number ?? ""}
                    </td>
                    <td className={`py-2 pr-3 ${reversado ? "line-through" : "text-gray-900"}`}>
                      {formatDate(p.payment_date)}
                      {inicio && esContabilizadoFuera(p.payment_date, inicio) && (
                        <div className="mt-1"><ContabilizadoFueraBadge inicio={inicio} /></div>
                      )}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-mono font-medium ${
                        reversado ? "line-through" : "text-emerald-700"
                      }`}
                    >
                      B/. {fmtImporte(amount)}
                      {/* Un recibo aplicado a varias facturas (Parte B): acá se ve
                          lo aplicado a ESTA, y abajo el total del recibo. */}
                      {Number(p.amount) > amount + 0.001 && (
                        <span
                          className="block text-xs font-normal text-gray-400 whitespace-nowrap"
                          title="El recibo se aplicó a varias facturas"
                        >
                          de B/. {fmtImporte(Number(p.amount))} del recibo
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {reversado && p.reversion ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800"
                          title={`${p.reversion.reason} · ${formatDateTime(p.reversion.reversed_at)}${
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
                        <div className="inline-flex items-center justify-end gap-2">
                        {p.payment_number && (
                          <DownloadReceiptPdfButton paymentId={p.id} receiptLabel={p.payment_number} compact />
                        )}
                        {canReverseThis && p.asiento ? (
                          <ReversePaymentDialog
                            paymentId={p.id}
                            paymentLabel={label}
                            asiento={p.asiento}
                            invoiceNumber={invoiceNumber}
                          />
                        ) : canDelete ? (
                          <DeletePaymentButton paymentId={p.id} paymentLabel={label} />
                        ) : reversado ? null : fuera && !p.asiento && canMutate ? (
                          <span
                            className="text-xs text-slate-600"
                            title={mensajeContabilizadoFueraNoSeAnula("cobro", p.payment_number ?? null, p.payment_date, inicio!)}
                          >
                            No se elimina
                          </span>
                        ) : (
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
                        </div>
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
            ? "Use el botón \"Registrar cobro\" para asentar el primer cobro."
            : "Esta factura aún no tiene pagos."}
        </div>
      )}
    </section>
  );
}
