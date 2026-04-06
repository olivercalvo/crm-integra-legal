import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ClientForm } from "@/components/clients/client-form";
import type { CatClassification } from "@/types/database";

export default async function NuevoClientePage() {
  const { db, tenantId } = await getAuthenticatedContext();

  const [classificationsRes, lawyersRes] = await Promise.all([
    db.from("cat_classifications").select("*").eq("tenant_id", tenantId).eq("active", true).order("name"),
    db.from("users").select("id, full_name").eq("tenant_id", tenantId).eq("role", "abogada").eq("active", true).order("full_name"),
  ]);

  const lawyers = (lawyersRes.data ?? []).map((u: { id: string; full_name: string }) => ({ id: u.id, name: u.full_name }));

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/abogada/clientes" className="flex items-center gap-1 hover:text-integra-navy">
          <ChevronLeft size={16} />
          Clientes
        </Link>
        <span>/</span>
        <span className="text-integra-navy font-medium">Nuevo Cliente</span>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-integra-navy">Nuevo Cliente</h2>
        <p className="text-sm text-gray-500">Completa los datos para registrar el cliente</p>
      </div>

      <ClientForm
        mode="create"
        classifications={(classificationsRes.data as CatClassification[]) ?? []}
        lawyers={lawyers}
      />
    </div>
  );
}
