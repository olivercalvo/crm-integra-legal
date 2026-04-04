"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Save, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SelectOption {
  id: string;
  name: string;
  prefix?: string;
}

interface ClientOption {
  id: string;
  name: string;
  client_number: string;
}

interface TeamMember extends SelectOption {
  role?: string;
}

interface CaseFormProps {
  clients: ClientOption[];
  classifications: SelectOption[];
  institutions: SelectOption[];
  team: TeamMember[];
  statuses: SelectOption[];
  initialData?: {
    id: string;
    client_id: string;
    description: string | null;
    classification_id: string | null;
    institution_id: string | null;
    responsible_id: string | null;
    opened_at: string;
    status_id: string | null;
    physical_location: string | null;
    observations: string | null;
    has_digital_file: boolean;
    case_code: string;
    entity: string | null;
    procedure_type: string | null;
    institution_procedure_number: string | null;
    institution_case_number: string | null;
    case_start_date: string | null;
    procedure_start_date: string | null;
    deadline: string | null;
    assistant_id: string | null;
  };
  mode: "create" | "edit";
  preSelectedClientId?: string;
}

const TOTAL_STEPS = 4;

export function CaseForm({
  clients,
  classifications,
  institutions,
  team,
  statuses,
  initialData,
  mode,
  preSelectedClientId,
}: CaseFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const preClient = preSelectedClientId ? clients.find((cl) => cl.id === preSelectedClientId) : null;
  const [clientId, setClientId] = useState(initialData?.client_id ?? preSelectedClientId ?? "");
  const [clientSearch, setClientSearch] = useState(() => {
    if (initialData?.client_id) {
      const c = clients.find((cl) => cl.id === initialData.client_id);
      return c ? `${c.client_number} - ${c.name}` : "";
    }
    if (preClient) {
      return `${preClient.client_number} - ${preClient.name}`;
    }
    return "";
  });
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [classificationId, setClassificationId] = useState(
    initialData?.classification_id ?? ""
  );
  const [institutionId, setInstitutionId] = useState(
    initialData?.institution_id ?? ""
  );
  const [responsibleId, setResponsibleId] = useState(
    initialData?.responsible_id ?? ""
  );
  const [assistantId, setAssistantId] = useState(
    initialData?.assistant_id ?? ""
  );
  const abogadas = team.filter((t) => t.role === "abogada" || !t.role);
  const asistentes = team.filter((t) => t.role === "asistente");
  const [openedAt, setOpenedAt] = useState(
    initialData?.opened_at ?? new Date().toISOString().split("T")[0]
  );
  const [physicalLocation, setPhysicalLocation] = useState(
    initialData?.physical_location ?? ""
  );
  const [observations, setObservations] = useState(
    initialData?.observations ?? ""
  );
  const [hasDigitalFile, setHasDigitalFile] = useState(
    initialData?.has_digital_file ?? false
  );
  const [statusId, setStatusId] = useState(
    initialData?.status_id ?? statuses[0]?.id ?? ""
  );

  // New fields
  const [procedureType, setProcedureType] = useState(initialData?.procedure_type ?? "");
  const [newInstitutionName, setNewInstitutionName] = useState("");
  const [showNewInstitution, setShowNewInstitution] = useState(false);
  const [institutionProcedureNumber, setInstitutionProcedureNumber] = useState(
    initialData?.institution_procedure_number ?? ""
  );
  const [institutionCaseNumber, setInstitutionCaseNumber] = useState(
    initialData?.institution_case_number ?? ""
  );
  const [caseStartDate, setCaseStartDate] = useState(initialData?.case_start_date ?? "");
  const [procedureStartDate, setProcedureStartDate] = useState(
    initialData?.procedure_start_date ?? ""
  );
  const [deadlineDate, setDeadlineDate] = useState(initialData?.deadline ?? "");

  // Compute preview code
  const selectedClassification = classifications.find((c) => c.id === classificationId);
  const prefix = selectedClassification?.prefix ?? "EXP";
  const previewCode = mode === "edit" ? initialData!.case_code : `${prefix}-###`;

  // Filtered client list for searchable select
  const filteredClients = clients.filter((c) => {
    const q = clientSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.client_number.toLowerCase().includes(q)
    );
  });

  const handleClientSelect = (client: ClientOption) => {
    setClientId(client.id);
    setClientSearch(`${client.client_number} - ${client.name}`);
    setShowClientDropdown(false);
  };

  const validateStep = (): boolean => {
    if (step === 1 && !clientId) {
      setError("Por favor seleccione un cliente.");
      return false;
    }
    setError(null);
    return true;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  };

  const handleBack = () => {
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  };

  const handleSubmit = async () => {
    if (!validateStep()) return;

    const payload = {
      client_id: clientId,
      description: description || null,
      classification_id: classificationId || null,
      institution_id: institutionId || null,
      responsible_id: responsibleId || null,
      assistant_id: assistantId || null,
      opened_at: openedAt,
      status_id: statusId || null,
      physical_location: physicalLocation || null,
      observations: observations || null,
      has_digital_file: hasDigitalFile,
      entity: null,
      new_institution_name: showNewInstitution && newInstitutionName.trim() ? newInstitutionName.trim() : undefined,
      procedure_type: procedureType || null,
      institution_procedure_number: institutionProcedureNumber || null,
      institution_case_number: institutionCaseNumber || null,
      case_start_date: caseStartDate || null,
      procedure_start_date: procedureStartDate || null,
      deadline: deadlineDate || null,
    };

    startTransition(async () => {
      try {
        let response: Response;
        if (mode === "create") {
          response = await fetch("/api/cases", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } else {
          response = await fetch(`/api/cases/${initialData!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }

        const json = await response.json();

        if (!response.ok) {
          setError(json.error ?? "Error al guardar el caso");
          return;
        }

        router.push(`/abogada/casos/${json.data.id}`);
        router.refresh();
      } catch {
        setError("Error de conexión. Por favor intente de nuevo.");
      }
    });
  };

  return (
    <div className="mx-auto max-w-2xl">
      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-2">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
          <div key={s} className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                s < step
                  ? "bg-integra-navy text-white"
                  : s === step
                  ? "bg-integra-gold text-integra-navy"
                  : "bg-gray-200 text-gray-500"
              }`}
            >
              {s < step ? <Check size={14} /> : s}
            </div>
            {s < TOTAL_STEPS && (
              <div
                className={`h-0.5 w-8 sm:w-12 transition-colors ${
                  s < step ? "bg-integra-navy" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
        <div className="ml-3 text-sm text-gray-500">
          Paso {step} de {TOTAL_STEPS}
        </div>
      </div>

      {/* Step labels */}
      <div className="mb-6">
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold text-integra-navy">
              Datos del Caso
            </h2>
            <p className="text-sm text-gray-500">
              Cliente, descripción y clasificación
            </p>
          </div>
        )}
        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold text-integra-navy">
              Detalles Adicionales
            </h2>
            <p className="text-sm text-gray-500">
              Institución, responsable, entidad y tipo de trámite
            </p>
          </div>
        )}
        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold text-integra-navy">
              Fechas y Números de Trámite
            </h2>
            <p className="text-sm text-gray-500">
              Fechas clave, números de referencia y ubicación
            </p>
          </div>
        )}
        {step === 4 && (
          <div>
            <h2 className="text-xl font-bold text-integra-navy">
              Observaciones
            </h2>
            <p className="text-sm text-gray-500">
              Notas adicionales y expediente digital
            </p>
          </div>
        )}
      </div>

      {/* Step 1: Client, description, classification */}
      {step === 1 && (
        <div className="space-y-4">
          {/* Searchable client select */}
          <div className="space-y-1.5">
            <Label htmlFor="client-search">
              Cliente <span className="text-red-500">*</span>
            </Label>
            <div className="relative">
              <Input
                id="client-search"
                type="text"
                placeholder="Buscar cliente por nombre o número..."
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setClientId("");
                  setShowClientDropdown(true);
                }}
                onFocus={() => setShowClientDropdown(true)}
                onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
                className="min-h-[48px]"
                autoComplete="off"
              />
              {showClientDropdown && clientSearch.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border bg-white shadow-lg">
                  {filteredClients.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500">
                      No se encontraron clientes
                    </div>
                  ) : (
                    filteredClients.slice(0, 10).map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onMouseDown={() => handleClientSelect(client)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        <span className="rounded bg-integra-navy/10 px-1.5 py-0.5 text-xs font-mono text-integra-navy">
                          {client.client_number}
                        </span>
                        <span>{client.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {clientId && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <Check size={12} /> Cliente seleccionado
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description">Descripción</Label>
            <textarea
              id="description"
              rows={3}
              placeholder="Descripción del caso..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>

          {/* Classification */}
          <div className="space-y-1.5">
            <Label htmlFor="classification">Clasificación</Label>
            <select
              id="classification"
              value={classificationId}
              onChange={(e) => setClassificationId(e.target.value)}
              className="min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Sin clasificación</option>
              {classifications.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.prefix})
                </option>
              ))}
            </select>
          </div>

          {/* Code preview */}
          <div className="rounded-lg border border-integra-gold/30 bg-integra-gold/5 p-3">
            <p className="text-xs text-gray-500">Código del caso (preview)</p>
            <p className="font-mono text-lg font-bold text-integra-navy">{previewCode}</p>
            {mode === "edit" && (
              <p className="text-xs text-gray-400 mt-1">El código no cambia al editar</p>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Institution, responsible, status, entity, procedure_type */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Institution */}
          <div className="space-y-1.5">
            <Label htmlFor="institution">Institución</Label>
            {!showNewInstitution ? (
              <select
                id="institution"
                value={institutionId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setShowNewInstitution(true);
                    setInstitutionId("");
                  } else {
                    setInstitutionId(e.target.value);
                  }
                }}
                className="min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Sin institución</option>
                {institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
                <option value="__new__">+ Agregar nueva institución</option>
              </select>
            ) : (
              <div className="flex gap-2">
                <Input
                  id="new-institution"
                  placeholder="Nombre de nueva institución..."
                  value={newInstitutionName}
                  onChange={(e) => setNewInstitutionName(e.target.value)}
                  className="min-h-[48px]"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => { setShowNewInstitution(false); setNewInstitutionName(""); }}
                  className="shrink-0 rounded-md px-3 text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Abogada Responsable */}
          <div className="space-y-1.5">
            <Label htmlFor="responsible">Abogada Responsable</Label>
            <select
              id="responsible"
              value={responsibleId}
              onChange={(e) => setResponsibleId(e.target.value)}
              className="min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Sin abogada responsable</option>
              {abogadas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Asistente Responsable */}
          <div className="space-y-1.5">
            <Label htmlFor="assistant">Asistente Responsable</Label>
            <select
              id="assistant"
              value={assistantId}
              onChange={(e) => setAssistantId(e.target.value)}
              className="min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Sin asistente</option>
              {asistentes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status (edit mode) */}
          {mode === "edit" && (
            <div className="space-y-1.5">
              <Label htmlFor="status">Estado</Label>
              <select
                id="status"
                value={statusId}
                onChange={(e) => setStatusId(e.target.value)}
                className="min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Sin estado</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Procedure type */}
          <div className="space-y-1.5">
            <Label htmlFor="procedure-type">Tipo de trámite</Label>
            <Input
              id="procedure-type"
              type="text"
              placeholder="Ej. Demanda laboral, Recurso de amparo..."
              value={procedureType}
              onChange={(e) => setProcedureType(e.target.value)}
              className="min-h-[48px]"
            />
          </div>
        </div>
      )}

      {/* Step 3: Dates and reference numbers */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Opened at */}
          <div className="space-y-1.5">
            <Label htmlFor="opened-at">Fecha apertura expediente</Label>
            <Input
              id="opened-at"
              type="date"
              value={openedAt}
              onChange={(e) => setOpenedAt(e.target.value)}
              className="min-h-[48px]"
            />
          </div>

          {/* Case start date */}
          <div className="space-y-1.5">
            <Label htmlFor="case-start-date">Fecha inicio del caso</Label>
            <Input
              id="case-start-date"
              type="date"
              value={caseStartDate}
              onChange={(e) => setCaseStartDate(e.target.value)}
              className="min-h-[48px]"
            />
          </div>

          {/* Procedure start date */}
          <div className="space-y-1.5">
            <Label htmlFor="procedure-start-date">Fecha inicio del trámite</Label>
            <Input
              id="procedure-start-date"
              type="date"
              value={procedureStartDate}
              onChange={(e) => setProcedureStartDate(e.target.value)}
              className="min-h-[48px]"
            />
          </div>

          {/* Deadline */}
          <div className="space-y-1.5">
            <Label htmlFor="deadline-date">Fecha tope</Label>
            <Input
              id="deadline-date"
              type="date"
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
              className="min-h-[48px]"
            />
          </div>

          {/* Institution procedure number */}
          <div className="space-y-1.5">
            <Label htmlFor="institution-procedure-number">N° trámite en la institución</Label>
            <Input
              id="institution-procedure-number"
              type="text"
              placeholder="Número de referencia del trámite..."
              value={institutionProcedureNumber}
              onChange={(e) => setInstitutionProcedureNumber(e.target.value)}
              className="min-h-[48px]"
            />
          </div>

          {/* Institution case number */}
          <div className="space-y-1.5">
            <Label htmlFor="institution-case-number">N° caso en la institución</Label>
            <Input
              id="institution-case-number"
              type="text"
              placeholder="Número de caso asignado por la institución..."
              value={institutionCaseNumber}
              onChange={(e) => setInstitutionCaseNumber(e.target.value)}
              className="min-h-[48px]"
            />
          </div>

          {/* Physical location */}
          <div className="space-y-1.5">
            <Label htmlFor="physical-location">Ubicación del Expediente</Label>
            <Input
              id="physical-location"
              type="text"
              placeholder="Ej. Archivo A, Gaveta 3..."
              value={physicalLocation}
              onChange={(e) => setPhysicalLocation(e.target.value)}
              className="min-h-[48px]"
            />
          </div>
        </div>
      )}

      {/* Step 4: Observations, has_digital_file, summary */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="observations">Observaciones</Label>
            <textarea
              id="observations"
              rows={5}
              placeholder="Notas internas, aclaraciones adicionales..."
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>

          <div className="flex items-center gap-3 rounded-lg border p-4">
            <input
              id="has-digital-file"
              type="checkbox"
              checked={hasDigitalFile}
              onChange={(e) => setHasDigitalFile(e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-integra-navy focus:ring-integra-navy"
            />
            <div>
              <Label htmlFor="has-digital-file" className="cursor-pointer font-medium">
                Expediente digital disponible
              </Label>
              <p className="text-xs text-gray-500">
                Marcar si existe versión digital del expediente físico
              </p>
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-lg border bg-gray-50 p-4 space-y-2">
            <p className="text-sm font-medium text-gray-700">Resumen del caso</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-gray-500">Código:</span>
              <span className="font-mono font-medium">{previewCode}</span>
              <span className="text-gray-500">Cliente:</span>
              <span className="font-medium">{clientSearch || "—"}</span>
              <span className="text-gray-500">Clasificación:</span>
              <span>{selectedClassification?.name ?? "—"}</span>
              <span className="text-gray-500">Apertura:</span>
              <span>{openedAt}</span>
            </div>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Navigation buttons */}
      <div className="mt-6 flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={step === 1 ? () => router.back() : handleBack}
          disabled={isPending}
          className="min-h-[48px] px-5"
        >
          <ChevronLeft size={16} className="mr-1" />
          {step === 1 ? "Cancelar" : "Anterior"}
        </Button>

        {step < TOTAL_STEPS ? (
          <Button
            type="button"
            onClick={handleNext}
            disabled={isPending}
            className="min-h-[48px] bg-integra-navy px-5 hover:bg-integra-navy/90"
          >
            Siguiente
            <ChevronRight size={16} className="ml-1" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="min-h-[48px] bg-integra-gold px-5 text-integra-navy hover:bg-integra-gold/90"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save size={16} className="mr-2" />
                {mode === "create" ? "Crear Caso" : "Guardar Cambios"}
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
