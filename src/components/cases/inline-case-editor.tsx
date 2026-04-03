"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SelectOption {
  id: string;
  name: string;
  prefix?: string;
}

interface UserOption {
  id: string;
  full_name: string;
}

interface InlineCaseInfoEditorProps {
  caseId: string;
  caseData: {
    description: string | null;
    classification_id: string | null;
    institution_id: string | null;
    responsible_id: string | null;
    opened_at: string;
    physical_location: string | null;
    observations: string | null;
    has_digital_file: boolean;
    entity: string | null;
    procedure_type: string | null;
    institution_procedure_number: string | null;
    institution_case_number: string | null;
    case_start_date: string | null;
    procedure_start_date: string | null;
    deadline: string | null;
    assistant_id: string | null;
  };
  classifications: SelectOption[];
  institutions: SelectOption[];
  team: SelectOption[];
  statuses: SelectOption[];
  users?: UserOption[];
}

export function InlineCaseInfoEditor({
  caseId,
  caseData,
  classifications,
  institutions,
  team,
  users = [],
}: InlineCaseInfoEditorProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [description, setDescription] = useState(caseData.description ?? "");
  const [classificationId, setClassificationId] = useState(caseData.classification_id ?? "");
  const [institutionId, setInstitutionId] = useState(caseData.institution_id ?? "");
  const [responsibleId, setResponsibleId] = useState(caseData.responsible_id ?? "");
  const [assistantId, setAssistantId] = useState(caseData.assistant_id ?? "");
  const [openedAt, setOpenedAt] = useState(caseData.opened_at ?? "");
  const [physicalLocation, setPhysicalLocation] = useState(caseData.physical_location ?? "");
  const [observations, setObservations] = useState(caseData.observations ?? "");
  const [hasDigitalFile, setHasDigitalFile] = useState(caseData.has_digital_file);
  const [entity, setEntity] = useState(caseData.entity ?? "");
  const [procedureType, setProcedureType] = useState(caseData.procedure_type ?? "");
  const [instProcNum, setInstProcNum] = useState(caseData.institution_procedure_number ?? "");
  const [instCaseNum, setInstCaseNum] = useState(caseData.institution_case_number ?? "");
  const [caseStartDate, setCaseStartDate] = useState(caseData.case_start_date ?? "");
  const [procedureStartDate, setProcedureStartDate] = useState(caseData.procedure_start_date ?? "");
  const [deadline, setDeadline] = useState(caseData.deadline ?? "");

  // No team filtering needed — users prop provides all users

  const handleCancel = () => {
    setIsEditing(false);
    setError(null);
    // Reset to original values
    setDescription(caseData.description ?? "");
    setClassificationId(caseData.classification_id ?? "");
    setInstitutionId(caseData.institution_id ?? "");
    setResponsibleId(caseData.responsible_id ?? "");
    setAssistantId(caseData.assistant_id ?? "");
    setOpenedAt(caseData.opened_at ?? "");
    setPhysicalLocation(caseData.physical_location ?? "");
    setObservations(caseData.observations ?? "");
    setHasDigitalFile(caseData.has_digital_file);
    setEntity(caseData.entity ?? "");
    setProcedureType(caseData.procedure_type ?? "");
    setInstProcNum(caseData.institution_procedure_number ?? "");
    setInstCaseNum(caseData.institution_case_number ?? "");
    setCaseStartDate(caseData.case_start_date ?? "");
    setProcedureStartDate(caseData.procedure_start_date ?? "");
    setDeadline(caseData.deadline ?? "");
  };

  const handleSave = () => {
    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = {
          description: description || null,
          classification_id: classificationId || null,
          institution_id: institutionId || null,
          responsible_id: responsibleId || null,
          assistant_id: assistantId || null,
          opened_at: openedAt,
          physical_location: physicalLocation || null,
          observations: observations || null,
          has_digital_file: hasDigitalFile,
          entity: entity || null,
          procedure_type: procedureType || null,
          institution_procedure_number: instProcNum || null,
          institution_case_number: instCaseNum || null,
          case_start_date: caseStartDate || null,
          procedure_start_date: procedureStartDate || null,
          deadline: deadline || null,
        };

        const response = await fetch(`/api/cases/${caseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const json = await response.json().catch(() => ({}));
          setError(json.error ?? `Error ${response.status}: ${response.statusText}`);
          return;
        }

        setIsEditing(false);
        setError(null);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        setError(`Error de conexión: ${message}. Verifica tu conexión a internet.`);
      }
    });
  };

  if (!isEditing) {
    return (
      <div className="flex justify-end mb-3">
        <Button
          onClick={() => setIsEditing(true)}
          variant="outline"
          className="min-h-[48px] px-4"
        >
          <Pencil size={16} className="mr-1" />
          Editar Información
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-integra-gold/30 bg-integra-gold/5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-integra-navy">Editando Información</h3>
        <div className="flex gap-2">
          <Button
            onClick={handleCancel}
            variant="ghost"
            disabled={isPending}
            className="min-h-[44px] px-3"
          >
            <X size={16} className="mr-1" />
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending}
            className="min-h-[44px] bg-integra-navy px-4 hover:bg-integra-navy/90"
          >
            {isPending ? (
              <Loader2 size={16} className="mr-1 animate-spin" />
            ) : (
              <Save size={16} className="mr-1" />
            )}
            Guardar
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Descripción</Label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Observaciones</Label>
          <textarea
            rows={3}
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Clasificación</Label>
          <select
            value={classificationId}
            onChange={(e) => setClassificationId(e.target.value)}
            className="min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Sin clasificación</option>
            {classifications.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Institución</Label>
          <select
            value={institutionId}
            onChange={(e) => setInstitutionId(e.target.value)}
            className="min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Sin institución</option>
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Abogada Responsable</Label>
          <select
            value={responsibleId}
            onChange={(e) => setResponsibleId(e.target.value)}
            className="min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Sin responsable</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Asistente Responsable de Seguimiento</Label>
          <select
            value={assistantId}
            onChange={(e) => setAssistantId(e.target.value)}
            className="min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Sin asistente</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Entidad</Label>
          <Input value={entity} onChange={(e) => setEntity(e.target.value)} className="min-h-[48px]" />
        </div>
        <div className="space-y-1.5">
          <Label>Tipo de trámite</Label>
          <Input value={procedureType} onChange={(e) => setProcedureType(e.target.value)} className="min-h-[48px]" />
        </div>
        <div className="space-y-1.5">
          <Label>Fecha apertura</Label>
          <Input type="date" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} className="min-h-[48px]" />
        </div>
        <div className="space-y-1.5">
          <Label>Fecha inicio caso</Label>
          <Input type="date" value={caseStartDate} onChange={(e) => setCaseStartDate(e.target.value)} className="min-h-[48px]" />
        </div>
        <div className="space-y-1.5">
          <Label>Fecha inicio trámite</Label>
          <Input type="date" value={procedureStartDate} onChange={(e) => setProcedureStartDate(e.target.value)} className="min-h-[48px]" />
        </div>
        <div className="space-y-1.5">
          <Label>Fecha tope</Label>
          <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="min-h-[48px]" />
        </div>
        <div className="space-y-1.5">
          <Label>N° trámite en institución</Label>
          <Input value={instProcNum} onChange={(e) => setInstProcNum(e.target.value)} className="min-h-[48px]" />
        </div>
        <div className="space-y-1.5">
          <Label>N° caso en institución</Label>
          <Input value={instCaseNum} onChange={(e) => setInstCaseNum(e.target.value)} className="min-h-[48px]" />
        </div>
        <div className="space-y-1.5">
          <Label>Ubicación del Expediente</Label>
          <Input value={physicalLocation} onChange={(e) => setPhysicalLocation(e.target.value)} className="min-h-[48px]" />
        </div>
        <div className="flex items-center gap-3 rounded-lg border p-4">
          <input
            type="checkbox"
            checked={hasDigitalFile}
            onChange={(e) => setHasDigitalFile(e.target.checked)}
            className="h-5 w-5 rounded border-gray-300 text-integra-navy focus:ring-integra-navy"
          />
          <Label className="cursor-pointer">Expediente digital disponible</Label>
        </div>
      </div>
    </div>
  );
}
