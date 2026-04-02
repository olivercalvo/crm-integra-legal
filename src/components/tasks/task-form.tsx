"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlusCircle, Loader2 } from "lucide-react";
import type { User } from "@/types/database";

interface TaskFormProps {
  caseId: string;
  onSuccess?: () => void;
}

export function TaskForm({ caseId, onSuccess }: TaskFormProps) {
  const router = useRouter();

  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [assistants, setAssistants] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchAssistants() {
      try {
        const res = await fetch("/api/users?role=asistente");
        if (res.ok) {
          const data: User[] = await res.json();
          setAssistants(data);
        }
      } catch {
        // Non-critical: dropdown remains empty
      } finally {
        setLoadingUsers(false);
      }
    }
    fetchAssistants();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!description.trim()) {
      setError("La descripción es requerida.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          description: description.trim(),
          deadline: deadline || null,
          assigned_to: assignedTo || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al crear la tarea.");
        setLoading(false);
        return;
      }

      setDescription("");
      setDeadline("");
      setAssignedTo("");
      onSuccess?.();
      router.refresh();
    } catch {
      setError("Error de conexión. Intente de nuevo.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Description */}
      <div className="space-y-1.5">
        <Label htmlFor="task-description" className="text-sm font-medium text-integra-navy">
          Descripción de la Tarea
        </Label>
        <Input
          id="task-description"
          type="text"
          placeholder="Ej. Presentar recurso de apelación..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          className="h-11 border-gray-200 focus:border-integra-gold focus:ring-integra-gold"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Deadline */}
        <div className="space-y-1.5">
          <Label htmlFor="task-deadline" className="text-sm font-medium text-integra-navy">
            Fecha Límite <span className="text-gray-400 font-normal">(opcional)</span>
          </Label>
          <Input
            id="task-deadline"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="h-11 border-gray-200 focus:border-integra-gold focus:ring-integra-gold"
          />
        </div>

        {/* Assigned To */}
        <div className="space-y-1.5">
          <Label htmlFor="task-assigned" className="text-sm font-medium text-integra-navy">
            Asignar a <span className="text-gray-400 font-normal">(opcional)</span>
          </Label>
          <select
            id="task-assigned"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            disabled={loadingUsers}
            className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold disabled:opacity-50"
          >
            <option value="">-- Sin asignar --</option>
            {assistants.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <Button
        type="submit"
        disabled={loading}
        className="h-11 w-full bg-integra-navy text-white hover:bg-integra-navy/90 font-medium"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Creando...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <PlusCircle size={16} />
            Crear Tarea
          </span>
        )}
      </Button>
    </form>
  );
}
