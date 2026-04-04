import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { CaseForm } from "@/components/cases/case-form";
import { BackButton } from "@/components/ui/back-button";

export default async function NuevoExpedientePage() {
  const { db, tenantId } = await getAuthenticatedContext();

  const [clientsRes, classificationsRes, institutionsRes, teamRes, statusesRes] =
    await Promise.all([
      db
        .from("clients")
        .select("id, name, client_number")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
      db
        .from("cat_classifications")
        .select("id, name, prefix")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
      db
        .from("cat_institutions")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
      db
        .from("users")
        .select("id, full_name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .in("role", ["abogada", "asistente"])
        .order("full_name"),
      db
        .from("cat_statuses")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("created_at", { ascending: true }),
    ]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/abogada/casos" />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">
            Nuevo Caso
          </h1>
          <p className="text-sm text-gray-500">
            Complete los datos para registrar el caso
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <CaseForm
          clients={clientsRes.data ?? []}
          classifications={classificationsRes.data ?? []}
          institutions={institutionsRes.data ?? []}
          team={(teamRes.data ?? []).map((u: { id: string; full_name: string }) => ({ id: u.id, name: u.full_name }))}
          statuses={statusesRes.data ?? []}
          mode="create"
        />
      </div>
    </div>
  );
}
