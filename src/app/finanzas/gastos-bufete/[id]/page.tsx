import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ShoppingBag, Calendar, User, Wallet, FileText, StickyNote, ArrowLeft, Plus } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils/format-date";
import { getBusinessExpenseById } from "@/lib/finanzas/queries/business-expenses";
import {
  BUSINESS_EXPENSE_PAYMENT_METHOD_LABEL,
  taxRateLabel,
} from "@/lib/finanzas/types/business-expense";
import { BusinessExpenseStatusBadge } from "../_components/business-expense-status-badge";
import { BusinessExpenseActions } from "../_components/business-expense-actions";
import { ReceiptUploader } from "../_components/receipt-uploader";

interface PageProps {
  params: { id: string };
  searchParams: { saved?: string };
}

const READING_ROLES = ["admin", "abogada", "contador"];
const MUTATING_ROLES = ["admin", "contador"];

function fmtMoney(n: number | string): string {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default async function GastoBufeteDetailPage({ params, searchParams }: PageProps) {
  const ctx = await getAuthenticatedContext();
  if (!READING_ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const expense = await getBusinessExpenseById(ctx.db, ctx.tenantId, params.id);
  if (!expense) notFound();

  const canMutate = MUTATING_ROLES.includes(ctx.userRole);

  // URL firmada para previsualizar el receipt (válida por 1 hora)
  let receiptPublicUrl: string | null = null;
  if (expense.receipt_url) {
    const { data } = await ctx.db.storage
      .from("documents")
      .createSignedUrl(expense.receipt_url, 3600);
    receiptPublicUrl = data?.signedUrl ?? null;
  }

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
              <div className="sm:col-span-2">
                <Item label="Descripción" value={expense.description} />
              </div>
            </dl>
          </section>

          {/* Montos */}
          <section className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-integra-navy">Montos</h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
              <Item label="Subtotal" value={`B/. ${fmtMoney(expense.subtotal)}`} />
              <Item
                label={`ITBMS (${taxRateLabel(Number(expense.tax_rate))})`}
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
              publicUrl={receiptPublicUrl}
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

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value}</dd>
    </div>
  );
}
