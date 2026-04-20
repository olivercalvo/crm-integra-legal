import { getAuthenticatedContext } from "@/lib/supabase/server-query";
import { notFound } from "next/navigation";
import { CaseForm } from "@/components/cases/case-form";
import { BackButton } from "@/components/ui/back-button";

interface PageProps {
  params: { id: string };
}

export default async function EditarExpedientePage({ params }: PageProps) {
  const { db, tenantId, userRole } = await getAuthenticatedContext();

  const [caseRes, clientsRes, classificationsRes, institutionsRes, teamRes, statusesRes] =
    await Promise.all([
      db
        .from("cases")
        .select("*")
        .eq("id", params.id)
        .single(),
      db
        .from("clients")
        .select("id, name, client_number, responsible_lawyer_id")
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

  if (!caseRes.data || caseRes.error) {
    notFound();
  }

  const caseData = caseRes.data;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BackButton fallbackHref={`/abogada/casos/${params.id}`} />
        <div>
          <h1 className="text-2xl font-bold text-integra-navy">
            Editar Caso
          </h1>
          <p className="font-mono text-sm text-gray-500">{caseData.case_code}</p>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <CaseForm
          clients={clientsRes.data ?? []}
          classifications={classificationsRes.data ?? []}
          institutions={institutionsRes.data ?? []}
          team={(teamRes.data ?? []).map((u: { id: string; full_name: string }) => ({ id: u.id, name: u.full_name }))}
          statuses={statusesRes.data ?? []}
          initialData={{
            id: caseData.id,
            client_id: caseData.client_id,
            description: caseData.description,
            classification_id: caseData.classification_id,
            institution_id: caseData.institution_id,
            responsible_id: caseData.responsible_id,
            opened_at: caseData.opened_at,
            status_id: caseData.status_id,
            physical_location: caseData.physical_location,
            observations: caseData.observations,
            has_digital_file: caseData.has_digital_file,
            case_code: caseData.case_code,
            entity: caseData.entity,
            procedure_type: caseData.procedure_type,
            institution_procedure_number: caseData.institution_procedure_number,
            institution_case_number: caseData.institution_case_number,
            case_start_date: caseData.case_start_date,
            procedure_start_date: caseData.procedure_start_date,
            deadline: caseData.deadline,
            assistant_id: caseData.assistant_id,
          }}
          mode="edit"
          userRole={userRole as "admin" | "abogada" | "asistente"}
        />
      </div>
    </div>
  );
}
