import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ClientForm } from "@/components/clients/client-form";
import type { Client, CatClassification } from "@/types/database";

interface PageProps {
  params: { id: string };
}

export default async function EditarClientePage({ params }: PageProps) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { id } = params;

  const [clientRes, classRes] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).single(),
    supabase
      .from("cat_classifications")
      .select("*")
      .eq("active", true)
      .order("name", { ascending: true }),
  ]);

  if (clientRes.error || !clientRes.data) {
    notFound();
  }

  const client = clientRes.data as Client;
  const classifications = (classRes.data as CatClassification[]) ?? [];

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/abogada/clientes" className="flex items-center gap-1 hover:text-integra-navy">
          <ChevronLeft size={16} />
          Clientes
        </Link>
        <span>/</span>
        <Link
          href={`/abogada/clientes/${id}`}
          className="hover:text-integra-navy truncate max-w-[200px]"
        >
          {client.name}
        </Link>
        <span>/</span>
        <span className="text-integra-navy font-medium">Editar</span>
      </div>

      <div>
        <h2 className="font-serif text-2xl font-bold text-integra-navy">Editar Cliente</h2>
        <p className="text-sm text-gray-500">
          Modifica los datos de{" "}
          <span className="font-medium text-integra-navy">{client.name}</span>
        </p>
      </div>

      <ClientForm mode="edit" client={client} classifications={classifications} />
    </div>
  );
}
