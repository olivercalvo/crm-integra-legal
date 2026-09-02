import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { previewNextSupplierNumber } from "@/lib/finanzas/numbering/supplier-numbering";
import { SupplierForm } from "../_components/supplier-form";

const ROLES = ["admin", "abogada", "contador"];

export const metadata = { title: "Nuevo proveedor · Finanzas" };

export default async function NuevoProveedorPage() {
  const ctx = await getAuthenticatedContext();
  if (!ROLES.includes(ctx.userRole)) {
    redirect("/finanzas");
  }

  const proximoNumero = await previewNextSupplierNumber(ctx.db, ctx.tenantId);

  return (
    <div className="space-y-4">
      <Link
        href="/finanzas/proveedores"
        className="inline-flex items-center gap-1.5 text-sm text-integra-navy/70 hover:text-integra-navy"
      >
        <ArrowLeft size={16} />
        Volver a Proveedores
      </Link>

      <h1 className="text-2xl font-bold text-integra-navy">Nuevo proveedor</h1>

      <SupplierForm proveedor={null} proximoNumero={proximoNumero} />
    </div>
  );
}
