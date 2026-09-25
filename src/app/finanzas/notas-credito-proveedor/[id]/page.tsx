import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, FileMinus, ShoppingBag, XCircle } from "lucide-react";
import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { BackButton } from "@/components/ui/back-button";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { fmtImporte } from "@/lib/utils/importe";
import { getSupplierCreditNoteById } from "@/lib/finanzas/api/supplier-credit-notes";
import { cargarAsientosPorOrigen } from "@/lib/finanzas/queries/payments";
import { SOURCE_TYPE_NOTA_CREDITO_PROVEEDOR } from "@/lib/finanzas/contabilidad/asiento-nota-credito-compra";
import { ReversePaymentDialog } from "@/app/finanzas/facturas/_components/reverse-payment-dialog";

/**
 * Detalle de una NOTA DE CRÉDITO DE PROVEEDOR (3.5, migración `066`).
 *
 * La ven admin, abogada y contador (los que tienen las compras); el contador
 * entra por el patrón exacto de `route-access.ts`. Reversar: los mismos tres,
 * igual que registrarla. La NC es inmutable: sólo se anula con su reversión.
 */
const ROLES = ["admin", "abogada", "contador"];

interface PageProps {
  params: { id: string };
  searchParams?: { registrada?: string };
}

type Uno<T> = T | T[] | null;
const uno = <T,>(v: Uno<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default async function NotaDeCreditoProveedorPage({ params, searchParams }: PageProps) {
  const { db, tenantId, userRole } = await getAuthenticatedContext();
  if (!ROLES.includes(userRole)) redirect("/finanzas");

  const raw = await getSupplierCreditNoteById(db, tenantId, params.id);
  if (!raw) notFound();
  const nc = raw as unknown as {
    id: string;
    credit_note_number: string;
    supplier_document_number: string;
    supplier_document_date: string;
    supplier_cufe: string | null;
    issue_date: string;
    reason: string;
    status: string;
    subtotal_total: number | string;
    tax_total: number | string;
    grand_total: number | string;
    cancelled_at: string | null;
    cancellation_reason: string | null;
    created_at: string;
    compra: Uno<{ id: string; description: string; supplier_name: string | null; total: number | string; balance_due: number | string }>;
    proveedor: Uno<{ id: string; supplier_number: string; legal_name: string; ruc: string | null; dv: string | null }>;
    lineas: { id: string; line_order: number; description: string; chart_account_code: string; amount: number | string; tax_rate: number | string; tax_amount: number | string; line_total: number | string }[];
  };
  const compra = uno(nc.compra);
  const proveedor = uno(nc.proveedor);

  const [propios, reversiones] = await Promise.all([
    cargarAsientosPorOrigen(db, tenantId, SOURCE_TYPE_NOTA_CREDITO_PROVEEDOR, [nc.id]),
    cargarAsientosPorOrigen(db, tenantId, "reversion", [nc.id]),
  ]);
  const asiento = propios.get(nc.id) ?? null;
  const reversion = reversiones.get(nc.id) ?? null;
  const anulada = nc.status === "anulada";
  const puedeReversar = ROLES.includes(userRole) && !anulada && asiento !== null;

  return (
    <div className="space-y-5">
      {searchParams?.registrada === "1" && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span>
            Nota de crédito <span className="font-mono font-semibold">{nc.credit_note_number}</span> registrada
            {asiento ? ` en el libro (asiento ${asiento.entry_number})` : ""}.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <BackButton
            fallbackHref={compra ? `/finanzas/gastos-bufete/${compra.id}` : "/finanzas/gastos-bufete"}
            label={compra ? "Volver a la compra" : "Volver a compras"}
            showLabel
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <FileMinus size={20} className="text-integra-gold shrink-0" />
              <h1 className="text-2xl font-bold text-integra-navy">{nc.credit_note_number}</h1>
              {anulada ? (
                <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                  Anulada
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  Vigente
                </span>
              )}
              <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs text-gray-600">
                Nota de crédito de proveedor
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">Registrada el {formatDateTime(nc.created_at)}</p>
          </div>
        </div>
        {puedeReversar && asiento && (
          <ReversePaymentDialog
            variante="nota_credito_proveedor"
            paymentId={nc.id}
            paymentLabel={`${nc.credit_note_number} · ${fmtImporte(Number(nc.grand_total))}`}
            asiento={asiento}
            invoiceNumber={compra?.description ?? ""}
          />
        )}
      </div>

      {anulada && (
        <div role="note" className="flex items-start gap-3 rounded-md border-l-4 border-red-500 bg-red-50 p-4 text-sm text-red-900">
          <XCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">
              Nota de crédito anulada el {nc.cancelled_at ? formatDate(nc.cancelled_at) : ""}
              {reversion ? ` (asiento ${reversion.entry_number})` : ""}.
            </p>
            <p>Motivo: {nc.cancellation_reason}</p>
          </div>
        </div>
      )}

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-integra-navy">Datos generales</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wider text-gray-500">Compra</dt>
            <dd>
              {compra ? (
                <Link href={`/finanzas/gastos-bufete/${compra.id}`} className="inline-flex items-center gap-1 text-integra-navy hover:underline">
                  <ShoppingBag size={14} /> {compra.description}
                </Link>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-gray-500">Proveedor</dt>
            <dd>{proveedor?.legal_name ?? compra?.supplier_name ?? "Sin proveedor"}</dd>
          </div>
          {/* RUC y DV en DOS campos: nunca se concatenan (SOP de proveedores). */}
          <div>
            <dt className="text-xs uppercase tracking-wider text-gray-500">RUC</dt>
            <dd className="font-mono">{proveedor?.ruc ?? ""}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-gray-500">DV</dt>
            <dd className="font-mono">{proveedor?.dv ?? ""}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-gray-500">Documento del proveedor</dt>
            <dd className="font-mono">{nc.supplier_document_number} · {formatDate(nc.supplier_document_date)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-gray-500">Fecha contable</dt>
            <dd>{formatDate(nc.issue_date)}</dd>
          </div>
          {nc.supplier_cufe && (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wider text-gray-500">CUFE</dt>
              <dd className="break-all font-mono text-xs">{nc.supplier_cufe}</dd>
            </div>
          )}
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wider text-gray-500">Motivo</dt>
            <dd>{nc.reason}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-integra-navy">Líneas acreditadas</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="pb-2 pr-2">#</th>
                <th className="pb-2 pr-2">Descripción</th>
                <th className="pb-2 pr-2">Cuenta</th>
                <th className="pb-2 pr-2 text-right">Base</th>
                <th className="pb-2 pr-2 text-right">ITBMS</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {nc.lineas.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-2">{l.line_order}</td>
                  <td className="py-2 pr-2">{l.description}</td>
                  <td className="py-2 pr-2 font-mono text-xs">{l.chart_account_code}</td>
                  <td className="py-2 pr-2 text-right font-mono">{fmtImporte(Number(l.amount))}</td>
                  <td className="py-2 pr-2 text-right font-mono">{fmtImporte(Number(l.tax_amount))}</td>
                  <td className="py-2 text-right font-mono">{fmtImporte(Number(l.line_total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-4 font-mono text-sm">
          <span>Base B/. {fmtImporte(Number(nc.subtotal_total))}</span>
          <span>ITBMS B/. {fmtImporte(Number(nc.tax_total))}</span>
          <span className="font-semibold text-integra-navy">Total acreditado B/. {fmtImporte(Number(nc.grand_total))}</span>
        </div>
      </section>

      {asiento && (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-base font-semibold text-integra-navy">En el libro</h2>
          <p className="mb-3 text-xs text-gray-600">
            Asiento {asiento.entry_number} del {formatDate(asiento.transaction_date)}: baja la cuenta por pagar
            al proveedor, la cuenta de cada línea y el ITBMS de compras (crédito fiscal).
          </p>
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="pb-2">Cuenta</th>
                <th className="pb-2 text-right">Debe</th>
                <th className="pb-2 text-right">Haber</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {asiento.lines.map((l, i) => (
                <tr key={`${l.account_code}-${i}`}>
                  <td className="py-1.5">
                    <span className="font-mono">{l.account_code}</span> {l.account_name}
                  </td>
                  <td className="py-1.5 text-right font-mono">{l.debit > 0 ? fmtImporte(l.debit) : ""}</td>
                  <td className="py-1.5 text-right font-mono">{l.credit > 0 ? fmtImporte(l.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {compra && (
        <p className="text-xs text-gray-500">
          Saldo actual de la compra: B/. {fmtImporte(Number(compra.balance_due))} de B/. {fmtImporte(Number(compra.total))}.
        </p>
      )}
    </div>
  );
}
