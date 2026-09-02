import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Pencil, AlertTriangle } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { getSupplier, proveedoresConRucRepetido } from "@/lib/finanzas/queries/suppliers";
import { paymentTermsLabel } from "@/lib/finanzas/types/supplier";
import { SupplierExpenses } from "../_components/supplier-expenses";

const ROLES = ["admin", "abogada", "contador"];

export const metadata = { title: "Proveedor · Finanzas" };

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{children}</dd>
    </div>
  );
}

function Vacio() {
  return <span className="text-gray-300">—</span>;
}

export default async function ProveedorDetallePage({ params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  // El permiso se verifica acá y no en el id: getSupplier filtra por tenant_id.
  const proveedor = await getSupplier(ctx.db, ctx.tenantId, params.id);
  if (!proveedor) notFound();

  const rucRepetidos = await proveedoresConRucRepetido(ctx.db, ctx.tenantId);
  const gemelos = rucRepetidos.get(proveedor.id) ?? [];

  const { data: gastos } = await ctx.db
    .from("business_expenses")
    .select("id, description, expense_date, due_date, total, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("supplier_id", proveedor.id)
    .order("expense_date", { ascending: false });

  return (
    <div className="space-y-4">
      <Link
        href="/finanzas/proveedores"
        className="inline-flex items-center gap-1.5 text-sm text-integra-navy/70 hover:text-integra-navy"
      >
        <ArrowLeft size={16} />
        Volver a Proveedores
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-gray-500">{proveedor.supplier_number}</p>
          <h1 className="text-2xl font-bold text-integra-navy">{proveedor.legal_name}</h1>
          {proveedor.trade_name && (
            <p className="text-sm text-gray-600">{proveedor.trade_name}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span
            className={
              "inline-flex rounded-full px-2.5 py-1 text-xs font-medium " +
              (proveedor.active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-600")
            }
          >
            {proveedor.active ? "Activo" : "Inactivo"}
          </span>
          <Link
            href={`/finanzas/proveedores/${proveedor.id}/editar`}
            className="inline-flex min-h-[48px] items-center gap-1.5 rounded-md border border-integra-navy px-4 text-sm font-medium text-integra-navy hover:bg-integra-navy hover:text-white"
          >
            <Pencil size={16} />
            Editar
          </Link>
        </div>
      </div>

      {gemelos.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Este RUC lo comparte con <strong>{gemelos.join(", ")}</strong>. Puede ser el mismo
            proveedor cargado dos veces. El sistema no los une solo: unir de más no tiene vuelta
            atrás, y quién es quién lo sabe una persona.
          </span>
        </p>
      )}

      {/* Identificación fiscal: RUC y DV en dos celdas, como en la DGI. */}
      <div className="rounded-xl border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-integra-navy">Identificación fiscal</h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Campo label="RUC">
            {proveedor.ruc ? (
              <span className="font-mono">{proveedor.ruc}</span>
            ) : (
              <span className="text-amber-700">Sin cargar</span>
            )}
          </Campo>
          <Campo label="DV">
            {proveedor.dv ? <span className="font-mono">{proveedor.dv}</span> : <Vacio />}
          </Campo>
          <Campo label="Términos de pago">
            {paymentTermsLabel(proveedor.payment_terms_days)}
          </Campo>
        </dl>
        <p className="mt-3 text-xs text-gray-500">
          El RUC y el DV se guardan y se muestran <strong>por separado</strong>, como los pide el
          formulario de la DGI para los anexos de la declaración de renta.
        </p>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-integra-navy">Contacto</h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Campo label="Dirección">{proveedor.address ?? <Vacio />}</Campo>
          <Campo label="Teléfono">{proveedor.phone ?? <Vacio />}</Campo>
          <Campo label="Correo">{proveedor.email ?? <Vacio />}</Campo>
        </dl>
      </div>

      {proveedor.notes && (
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-integra-navy">Notas</h2>
          <p className="whitespace-pre-wrap text-sm text-gray-700">{proveedor.notes}</p>
        </div>
      )}

      <SupplierExpenses
        gastos={(gastos ?? []) as never}
        plazo={proveedor.payment_terms_days}
      />
    </div>
  );
}
