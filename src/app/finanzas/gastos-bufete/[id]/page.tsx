import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ShoppingBag, Calendar, User, Wallet, FileText, StickyNote, ArrowLeft, Plus } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { listarCuentasDeBanco } from "@/lib/finanzas/queries/tesoreria-para-asiento";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils/format-date";
import { getBusinessExpenseById } from "@/lib/finanzas/queries/business-expenses";
import {
  BUSINESS_EXPENSE_PAYMENT_METHOD_LABEL,
  taxRateLabel,
} from "@/lib/finanzas/types/business-expense";
import { cuentaLabel } from "@/lib/finanzas/types/expense-line";
import { BusinessExpenseStatusBadge } from "../_components/business-expense-status-badge";
import { BusinessExpenseActions } from "../_components/business-expense-actions";
import { ReceiptUploader } from "../_components/receipt-uploader";


/**
 * El título de la pestaña. Sin esto el navegador muestra "CRM Integra Legal" en
 * todas, y con seis pestañas abiertas no se distingue cuál es cuál.
 */
export const metadata = {
  title: "Gasto del bufete · Finanzas",
};
interface PageProps {
  params: { id: string };
  searchParams: { saved?: string };
}

const READING_ROLES = ["admin", "abogada", "contador"];
const MUTATING_ROLES = ["admin", "abogada", "contador"];

function fmtMoney(n: number | string): string {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default async function GastoBufeteDetailPage({ params, searchParams }: PageProps) {
  const ctx = await getAuthenticatedContext();
  // Lista corta y opinada para el selector; el guard del servidor acepta
  // cualquier activo activo (SOP-024 regla 3).
  const bancos = await listarCuentasDeBanco(ctx.db, ctx.tenantId);
  if (!READING_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const expense = await getBusinessExpenseById(ctx.db, ctx.tenantId, params.id);
  if (!expense) notFound();

  const canMutate = MUTATING_ROLES.includes(ctx.userRole);

  // El comprobante YA NO se firma acá.
  //
  // Hasta el 01/09/2026 este server component generaba una URL firmada a
  // *.supabase.co y se la pasaba al cliente como prop; el navegador la abría
  // directo. En una red donde ese dominio no resuelve, el enlace muere — que es
  // exactamente lo que le pasó a una de las licenciadas con una factura.
  // Ahora se pasa un flag y el archivo se pide a una ruta de la app.
  const tieneComprobante = Boolean(expense.receipt_url);

  const savedFlag = searchParams.saved === "1";

  return (
    <div className="space-y-5">
      {/* Toast simple via mensaje arriba — sin componente reusable porque
          el patrón existente (DeleteSuccessToast) usa client component;
          acá un banner estático es suficiente. */}
      {savedFlag && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Gasto guardado correctamente.
        </div>
      )}

      {/* Header.
          NOTA: usamos un <Link> directo al listado en lugar del <BackButton>
          compartido del repo. El BackButton hace router.back() si hay history
          (línea 28 de back-button.tsx), lo que causa bug UX al venir desde
          /nuevo tras crear un gasto: el "atrás" lleva al form en blanco en
          vez del listado. Este patrón corrige solo gastos-bufete.
          TODO(sprint futuro): el resto de las pantallas /finanzas (facturas,
          cotizaciones) tienen el mismo issue. Decidir si arreglamos el
          BackButton globalmente (priorizar `fallbackHref` sobre history) o
          si todas las pantallas migran a <Link href> explícito. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/finanzas/gastos-bufete"
            aria-label="Volver a Gastos del Bufete"
            className="inline-flex items-center justify-center min-h-[48px] min-w-[48px] rounded-md text-integra-navy hover:bg-gray-100"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="rounded-lg bg-integra-navy/5 p-2 text-integra-gold ring-1 ring-integra-gold/30">
            <ShoppingBag size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-integra-navy truncate">
              {expense.description}
            </h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
              <Calendar size={14} />
              <span>{formatDate(expense.expense_date)}</span>
              <BusinessExpenseStatusBadge status={expense.status} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canMutate && (
            <Link href="/finanzas/gastos-bufete/nuevo">
              <Button
                variant="outline"
                className="min-h-[44px] border-integra-navy/30 text-integra-navy hover:bg-integra-navy/5"
              >
                <Plus size={16} className="mr-1.5" />
                Nuevo gasto
              </Button>
            </Link>
          )}
          <BusinessExpenseActions
            bancos={bancos}
            id={expense.id}
            status={expense.status}
            canMutate={canMutate}
          />
        </div>
      </div>

      {/* Grid de dos columnas en desktop */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Datos del gasto */}
          <section className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-integra-navy">Datos del gasto</h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
              <Item label="Fecha" value={formatDate(expense.expense_date)} />
              <Item
                label="Cuenta contable"
                value={
                  expense.account ? (
                    <span>
                      <span className="font-mono">{expense.account.code}</span>
                      <span className="ml-1 text-gray-500">— {expense.account.name}</span>
                    </span>
                  ) : (
                    <span className="text-gray-400">Sin clasificar</span>
                  )
                }
              />
              <Item label="Proveedor" value={expense.supplier_name ?? "—"} />
              <Item
                label="RUC proveedor"
                value={
                  expense.supplier_ruc ? (
                    <span className="font-mono">{expense.supplier_ruc}</span>
                  ) : (
                    "—"
                  )
                }
              />
              {/* El comprobante que respalda la compra (migración `044`): es lo
                  que se busca al conciliar contra el proveedor. */}
              <Item
                label="N.º factura proveedor"
                value={
                  expense.supplier_invoice_number ? (
                    <span className="font-mono">{expense.supplier_invoice_number}</span>
                  ) : (
                    "—"
                  )
                }
              />
              <div className="sm:col-span-2">
                <Item label="Descripción" value={expense.description} />
              </div>
            </dl>
          </section>

          {/* Detalle — las líneas, una por una (migraciones `040` y `045`).
              Es la única forma de ver, en una compra mixta como la factura
              del internet, qué renglón fue gravado y cuál exento: el
              encabezado solo tiene la suma. Hasta el 16/09/2026 el detalle no
              las mostraba. */}
          <section className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-integra-navy">Detalle contable</h2>
            {expense.lineas.length === 0 ? (
              <p className="text-sm text-gray-400">Esta compra no tiene líneas.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2 pr-3 font-medium">Descripción</th>
                      <th className="py-2 pr-3 font-medium">Cuenta</th>
                      <th className="py-2 pr-3 text-right font-medium">Base</th>
                      <th className="py-2 pr-3 font-medium">Impuesto</th>
                      <th className="py-2 pr-3 text-right font-medium">ITBMS</th>
                      <th className="py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expense.lineas.map((l) => (
                      <tr key={l.id} className="border-b last:border-0">
                        <td className="py-2 pr-3 text-gray-900">{l.description}</td>
                        <td className="py-2 pr-3 text-gray-600">
                          {l.chart_account_code ? (
                            <span>
                              <span className="font-mono">{l.chart_account_code}</span>
                              {l.chart_account_name && (
                                <span className="ml-1 text-gray-500">— {l.chart_account_name}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-amber-700">{cuentaLabel(l)}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtMoney(l.amount)}</td>
                        <td className="py-2 pr-3 text-gray-600">
                          {l.tax_code_name ?? taxRateLabel(l.tax_rate)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtMoney(l.tax_amount)}</td>
                        <td className="py-2 text-right tabular-nums font-medium">{fmtMoney(l.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Montos */}
          <section className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-integra-navy">Montos</h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
              <Item label="Subtotal" value={`B/. ${fmtMoney(expense.subtotal)}`} />
              <Item
                // El rótulo solo afirma una tasa cuando TODAS las líneas la
                // comparten. `business_expenses.tax_rate` es un derivado —la
                // más alta de las gravadas— y en una compra mixta decir
                // "ITBMS (7%)" al lado de 1,75 sobre 35,00 es mentir: el 7% se
                // aplicó a 25,00. El desglose real está en la tabla de arriba.
                label={rotuloItbms(expense.lineas, Number(expense.tax_rate))}
                value={`B/. ${fmtMoney(expense.tax_amount)}`}
              />
              <Item
                label="Total"
                value={
                  <span className="text-lg font-bold text-integra-navy">
                    B/. {fmtMoney(expense.total)}
                  </span>
                }
              />
            </dl>
          </section>

          {/* Pago */}
          <section className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-integra-navy">Estado de pago</h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
              <Item
                label="Estado"
                value={<BusinessExpenseStatusBadge status={expense.status} />}
              />
              <Item
                label="Fecha de pago"
                value={
                  expense.payment_date ? formatDate(expense.payment_date) : "—"
                }
              />
              <Item
                label="Método"
                value={
                  expense.payment_method
                    ? BUSINESS_EXPENSE_PAYMENT_METHOD_LABEL[expense.payment_method]
                    : "—"
                }
              />
            </dl>
          </section>

          {/* Notas */}
          {expense.notes && (
            <section className="space-y-2 rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-base font-semibold text-integra-navy">
                <StickyNote size={16} className="text-integra-gold" />
                Notas
              </h2>
              <p className="whitespace-pre-wrap text-sm text-gray-700">{expense.notes}</p>
            </section>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {/* Comprobante */}
          <section className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-integra-navy">
              <FileText size={16} className="text-integra-gold" />
              Comprobante
            </h3>
            <ReceiptUploader
              expenseId={expense.id}
              receiptUrl={expense.receipt_url}
              receiptFilename={expense.receipt_filename}
              canMutate={canMutate}
              tieneComprobante={tieneComprobante}
            />
          </section>

          {/* Metadatos */}
          <section className="space-y-3 rounded-xl border bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-integra-navy">Registro</h3>
            <dl className="space-y-2 text-xs text-gray-600">
              <div className="flex items-center gap-1.5">
                <User size={12} />
                <span>{expense.created_by_name ?? "Sistema"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar size={12} />
                <span>Creado: {formatDate(expense.created_at)}</span>
              </div>
              {expense.updated_at && expense.updated_at !== expense.created_at && (
                <div className="flex items-center gap-1.5">
                  <Wallet size={12} />
                  <span>Modificado: {formatDate(expense.updated_at)}</span>
                </div>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

/**
 * El rótulo del ITBMS del encabezado, sin afirmar más de lo que las líneas dicen:
 *   · todas gravadas a la misma tasa → "ITBMS (7%)"
 *   · gravadas a una tasa + exentas  → "ITBMS (7% sobre B/. 25.00)"
 *   · gravadas a varias tasas        → "ITBMS (varias tasas)"
 *   · nada gravado                   → "ITBMS"
 * Sin líneas (compra vieja sin detalle) cae a la tasa del encabezado.
 */
function rotuloItbms(
  lineas: readonly { amount: number; tax_rate: number; tax_amount: number }[],
  tasaEncabezado: number
): string {
  if (lineas.length === 0) {
    return tasaEncabezado > 0 ? `ITBMS (${taxRateLabel(tasaEncabezado)})` : "ITBMS";
  }
  const gravadas = lineas.filter((l) => l.tax_amount > 0);
  const tasas = new Set(gravadas.map((l) => l.tax_rate));
  if (tasas.size === 0) return "ITBMS";
  if (tasas.size > 1) return "ITBMS (varias tasas)";
  const tasa = taxRateLabel(Array.from(tasas)[0]);
  if (gravadas.length === lineas.length) return `ITBMS (${tasa})`;
  const base = gravadas.reduce((s, l) => s + l.amount, 0);
  return `ITBMS (${tasa} sobre B/. ${fmtMoney(base)})`;
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value}</dd>
    </div>
  );
}
