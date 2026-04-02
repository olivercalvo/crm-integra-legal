import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { CaseForm } from "@/components/cases/case-form";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface PageProps {
  params: { id: string };
}

export default async function EditarExpedientePage({ params }: PageProps) {
  const supabase = createClient();

  const [caseRes, clientsRes, classificationsRes, institutionsRes, teamRes, statusesRes] =
    await Promise.all([
      supabase
        .from("cases")
        .select("*")
        .eq("id", params.id)
        .single(),
      supabase
        .from("clients")
        .select("id, name, client_number")
        .eq("active", true)
        .order("name"),
      supabase
        .from("cat_classifications")
        .select("id, name, prefix")
        .eq("active", true)
        .order("name"),
      supabase
        .from("cat_institutions")
        .select("id, name")
        .eq("active", true)
        .order("name"),
      supabase
        .from("cat_team")
        .select("id, name")
        .eq("active", true)
        .order("name"),
      supabase
        .from("cat_statuses")
        .select("id, name")
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
        <Button asChild variant="ghost" size="icon" className="min-h-[48px] min-w-[48px]">
          <Link href={`/abogada/expedientes/${params.id}`}>
            <ArrowLeft size={20} />
            <span className="sr-only">Volver</span>
          </Link>
        </Button>
        <div>
          <h1 className="font-serif text-2xl font-bold text-integra-navy">
            Editar Expediente
          </h1>
          <p className="font-mono text-sm text-gray-500">{caseData.case_code}</p>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <CaseForm
          clients={clientsRes.data ?? []}
          classifications={classificationsRes.data ?? []}
          institutions={institutionsRes.data ?? []}
          team={teamRes.data ?? []}
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
          }}
          mode="edit"
        />
      </div>
    </div>
  );
}
