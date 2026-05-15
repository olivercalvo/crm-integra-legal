import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Receipt, Info } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { formatDate } from "@/lib/utils/format-date";
import {
  getVatSummary,
  isValidMonthParam,
  previousMonthIso,
} from "@/lib/finanzas/reports/vat-summary";
import { MonthSelector } from "./_components/month-selector";
import { VatSummaryTable } from "./_components/vat-summary-table";
import { DetailSection } from "./_components/detail-section";
import { ExportButtons } from "./_components/export-buttons";

interface PageProps {
  searchParams: { month?: string };
}

const READING_ROLES = ["admin", "abogada", "contador"];

function fmtMoney(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

export default async function VatSummaryPage({ searchParams }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!READING_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  // Default: mes anterior completo. Si llega ?month=, validar (formato +
  // no futuro). Mes inválido → fallback al default.
  const requested = searchParams.month?.trim();
  const month = requested && isValidMonthParam(requested)
    ? requested
    : previousMonthIso();

  // Mes vigente del calendario — límite máximo del selector (bloqueamos
  // futuros). Lo calculamos inline para evitar otro helper.
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const result = await getVatSummary(ctx.db, {
    tenantId: ctx.tenantId,
    month,
  });

  const hasActivity =
    result.detail.invoices.length > 0 ||
    result.detail.business_expenses.length > 0 ||
    result.detail.tax_payments.length > 0;

  const totalInvoices = result.detail.invoices.length;
  const totalExpensesWithItbms = result.detail.business_expenses.filter(
    (e) => e.tax_amount > 0
  ).length;
  const totalPayments = result.detail.tax_payments.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/finanzas/reportes"
            aria-label="Volver a Reportes"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md text-integra-navy hover:bg-gray-100"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
            <Receipt size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-integra-navy">
              VAT Summary (ITBMS)
            </h1>
            <p className="text-sm text-gray-500">
              Resumen mensual de ITBMS — período {result.period.label}
            </p>
          </div>
        </div>
        <ExportButtons month={month} />
      </div>

      {/* Toolbar: selector de mes */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthSelector
          month={month}
          label={result.period.label}
          currentMonth={currentMonth}
        />
        <p className="text-xs text-gray-500">
          Reporte generado {formatDate(result.generated_at)} · Devengado por fecha de emisión
        </p>
      </div>

      {/* Empty state */}
      {!hasActivity && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 flex items-start gap-2">
          <Info size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">
              No hubo actividad financiera en {result.period.label}.
            </p>
            <p className="mt-1 text-xs text-amber-700">
              Todas las líneas del reporte aparecen en 0. Si esperabas ver datos,
              verifica que las facturas de ese mes no estén en estado borrador, o
              consulta un período distinto.
            </p>
          </div>
        </div>
      )}

      {/* Tabla principal con las 10 líneas */}
      <VatSummaryTable lines={result.lines} />

      {/* Aviso sobre la línea 8 (TODO histórico VAT Control) */}
      <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 flex items-start gap-2">
        <Info size={14} className="mt-0.5 shrink-0 text-gray-400" />
        <p>
          <span className="font-medium">Línea 8 (ITBMS adeudado de períodos anteriores)</span>
          {" "}aparece en 0 en este MVP. El cálculo de saldo acumulado contra la cuenta
          VAT Control requiere todos los reportes históricos cerrados — se habilitará
          en un sprint futuro cuando la abogada cierre el primer período manualmente.
        </p>
      </div>

      {/* Detalle: facturas */}
      {result.detail.invoices.length > 0 && (
        <DetailSection
          title="Detalle de facturas"
          subtitle={`${totalInvoices} factura${totalInvoices === 1 ? "" : "s"} (incluye ajustes por anulación)`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Fecha</th>
                  <th className="px-4 py-2 font-semibold">Número</th>
                  <th className="px-4 py-2 font-semibold">Cliente</th>
                  <th className="px-4 py-2 font-semibold">Estado</th>
                  <th className="px-4 py-2 font-semibold text-right">Subtotal</th>
                  <th className="px-4 py-2 font-semibold text-right">ITBMS</th>
                  <th className="px-4 py-2 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.detail.invoices.map((inv) => (
                  <tr
                    key={`${inv.id}-${inv.is_cancellation_adjustment ? "neg" : "pos"}`}
                    className={inv.is_cancellation_adjustment ? "bg-red-50/40" : ""}
                  >
                    <td className="px-4 py-2 text-gray-700 whitespace-nowrap">
                      {inv.is_cancellation_adjustment
                        ? formatDate(inv.cancelled_at ?? inv.issue_date)
                        : formatDate(inv.issue_date)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-700">
                      {inv.invoice_number}
                      {inv.is_cancellation_adjustment && (
                        <span className="ml-1 text-[10px] text-red-700">(ANULACIÓN)</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-700">
                      {inv.client_name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{inv.status}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs whitespace-nowrap">
                      <span className={inv.subtotal_total < 0 ? "text-red-700" : "text-gray-900"}>
                        {fmtMoney(inv.subtotal_total)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs whitespace-nowrap">
                      <span className={inv.tax_total < 0 ? "text-red-700" : "text-gray-700"}>
                        {fmtMoney(inv.tax_total)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs whitespace-nowrap font-semibold">
                      <span className={inv.grand_total < 0 ? "text-red-700" : "text-integra-navy"}>
                        {fmtMoney(inv.grand_total)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DetailSection>
      )}

      {/* Detalle: gastos del bufete con ITBMS */}
      {result.detail.business_expenses.length > 0 && (
        <DetailSection
          title="Detalle de gastos del bufete"
          subtitle={`${result.detail.business_expenses.length} compra${result.detail.business_expenses.length === 1 ? "" : "s"} · ${totalExpensesWithItbms} con ITBMS recuperable`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Fecha</th>
                  <th className="px-4 py-2 font-semibold">Proveedor</th>
                  <th className="px-4 py-2 font-semibold">Descripción</th>
                  <th className="px-4 py-2 font-semibold">Cuenta</th>
                  <th className="px-4 py-2 font-semibold text-right">Subtotal</th>
                  <th className="px-4 py-2 font-semibold text-right">ITBMS</th>
                  <th className="px-4 py-2 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.detail.business_expenses.map((ex) => (
                  <tr key={ex.id}>
                    <td className="px-4 py-2 text-gray-700 whitespace-nowrap">
                      {formatDate(ex.expense_date)}
                    </td>
                    <td className="px-4 py-2 text-gray-700">
                      {ex.supplier_name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{ex.description}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {ex.account_code ? (
                        <>
                          <span className="font-mono">{ex.account_code}</span>
                          {ex.account_name && (
                            <span className="ml-1 text-gray-400">{ex.account_name}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-300">Sin clasificar</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-900 whitespace-nowrap">
                      {fmtMoney(ex.subtotal)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-700 whitespace-nowrap">
                      {ex.tax_amount > 0 ? fmtMoney(ex.tax_amount) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-integra-navy whitespace-nowrap">
                      {fmtMoney(ex.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DetailSection>
      )}

      {/* Detalle: pagos al DGI */}
      {result.detail.tax_payments.length > 0 && (
        <DetailSection
          title="Pagos a DGI del período"
          subtitle={`${totalPayments} pago${totalPayments === 1 ? "" : "s"}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Fecha pago</th>
                  <th className="px-4 py-2 font-semibold">Período cubierto</th>
                  <th className="px-4 py-2 font-semibold">Referencia</th>
                  <th className="px-4 py-2 font-semibold text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.detail.tax_payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 text-gray-700 whitespace-nowrap">
                      {formatDate(p.payment_date)}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {formatDate(p.period_covered_from)} → {formatDate(p.period_covered_to)}
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-gray-600">
                      {p.reference_number ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-integra-navy whitespace-nowrap">
                      {fmtMoney(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DetailSection>
      )}
    </div>
  );
}
