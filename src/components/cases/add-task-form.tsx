"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, X, Loader2, CheckCircle, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UserOption {
  id: string;
  full_name: string;
}

interface AddTaskFormProps {
  caseId: string;
  users: UserOption[];
}

export function AddTaskForm({ caseId, users }: AddTaskFormProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [assignedTo, setAssignedTo] = useState("");

  const reset = () => {
    setDescription("");
    setDeadline("");
    setAssignedTo("");
    setShowForm(false);
    setError(null);
  };

  const handleSubmit = () => {
    if (!description.trim()) {
      setError("La descripción de la tarea es requerida");
      return;
    }
    startTransition(async () => {
      try {
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            case_id: caseId,
            description: description.trim(),
            deadline: deadline || null,
            assigned_to: assignedTo || null,
          }),
        });
        if (!response.ok) {
          const json = await response.json().catch(() => ({}));
          setError(json.error ?? `Error ${response.status}: ${response.statusText}`);
          return;
        }
        reset();
        router.refresh();
      } catch {
        setError("Error de conexión. Verifica tu conexión a internet.");
      }
    });
  };

  return (
    <div className="space-y-3">
      {!showForm && (
        <Button
          onClick={() => { setShowForm(true); setError(null); }}
          className="min-h-[56px] w-full bg-integra-navy hover:bg-integra-navy/90 font-semibold text-base gap-2"
        >
          <ClipboardList size={20} />
          + Nueva Tarea para Asistente
        </Button>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <div className="rounded-xl border border-integra-navy/20 bg-integra-navy/5 p-4 space-y-3">
          <h4 className="font-semibold text-integra-navy">Nueva Tarea</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Descripción</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ej: Recoger documentos en Registro Público"
                className="min-h-[48px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fecha límite</Label>
              <Input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="min-h-[48px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Asignar a</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Sin asignar</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button onClick={reset} variant="ghost" disabled={isPending} className="min-h-[44px]">
              <X size={16} className="mr-1" /> Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isPending} className="min-h-[44px] bg-integra-navy hover:bg-integra-navy/90">
              {isPending ? <Loader2 size={16} className="mr-1 animate-spin" /> : <Save size={16} className="mr-1" />}
              Crear Tarea
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface CompleteTaskButtonProps {
  taskId: string;
}

export function CompleteTaskButton({ taskId }: CompleteTaskButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleComplete = () => {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "cumplida" }),
        });
        if (response.ok) {
          router.refresh();
        }
      } catch {
        // silently fail
      }
    });
  };

  return (
    <Button
      onClick={handleComplete}
      disabled={isPending}
      variant="ghost"
      size="sm"
      className="min-h-[36px] text-green-600 hover:text-green-700 hover:bg-green-50"
      title="Marcar como cumplida"
    >
      {isPending ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <CheckCircle size={14} />
      )}
    </Button>
  );
}
