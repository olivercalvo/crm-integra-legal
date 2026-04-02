import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ClientForm } from "@/components/clients/client-form";
import type { CatClassification } from "@/types/database";

export default async function NuevoClientePage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: classifications } = await supabase
    .from("cat_classifications")
    .select("*")
    .eq("active", true)
    .order("name", { ascending: true });

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
        <h2 className="font-serif text-2xl font-bold text-integra-navy">Nuevo Cliente</h2>
        <p className="text-sm text-gray-500">Completa los datos para registrar el cliente</p>
      </div>

      <ClientForm
        mode="create"
        classifications={(classifications as CatClassification[]) ?? []}
      />
    </div>
  );
}
