import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { getSupplier } from "@/lib/finanzas/queries/suppliers";
import { SupplierForm } from "../../_components/supplier-form";

const ROLES = ["admin", "abogada", "contador"];

export const metadata = { title: "Editar proveedor · Finanzas" };

export default async function EditarProveedorPage({ params }: { params: { id: string } }) {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  // El permiso se verifica acá: getSupplier filtra por tenant_id, así que el id
  // de otro bufete da 404 en vez de abrir la ficha.
  const proveedor = await getSupplier(ctx.db, ctx.tenantId, params.id);
  if (!proveedor) notFound();

  return (
    <div className="space-y-4">
      <Link
        href={`/finanzas/proveedores/${proveedor.id}`}
        className="inline-flex items-center gap-1.5 text-sm text-integra-navy/70 hover:text-integra-navy"
      >
        <ArrowLeft size={16} />
        Volver a la ficha
      </Link>

      <h1 className="text-2xl font-bold text-integra-navy">
        Editar {proveedor.legal_name}
      </h1>

      <SupplierForm proveedor={proveedor} />
    </div>
  );
}
