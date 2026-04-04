import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { ProspectPipeline } from "@/components/prospects/prospect-pipeline";

export default async function ProspectosPage() {
  const { db, tenantId } = await getAuthenticatedContext();

  const { data: prospectsRaw } = await db
    .from("prospects")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });

  const prospects = (prospectsRaw ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    phone: p.phone as string | null,
    email: p.email as string | null,
    service_interest: p.service_interest as string | null,
    notes: p.notes as string | null,
    contact_date: p.contact_date as string,
    status: p.status as string,
    converted_client_id: p.converted_client_id as string | null,
    created_at: p.created_at as string,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-integra-navy">Prospectos</h1>
        <p className="text-sm text-gray-500">Pipeline de clientes potenciales</p>
      </div>
      <ProspectPipeline initialProspects={prospects} />
    </div>
  );
}
