"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StatusOption {
  id: string;
  name: string;
}

interface CaseStatusChangerProps {
  caseId: string;
  currentStatusId: string | null;
  currentStatusName: string;
  statuses: StatusOption[];
}

export function CaseStatusChanger({
  caseId,
  currentStatusId,
  currentStatusName,
  statuses,
}: CaseStatusChangerProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(currentStatusId ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleChange = async () => {
    if (!selectedId || selectedId === currentStatusId) {
      setIsOpen(false);
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/cases/${caseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "change-status", status_id: selectedId }),
        });

        const json = await response.json();

        if (!response.ok) {
          setError(json.error ?? "Error al cambiar el estado");
          return;
        }

        setIsOpen(false);
        setError(null);
        router.refresh();
      } catch {
        setError("Error de conexión");
      }
    });
  };

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        onClick={() => setIsOpen(true)}
        className="min-h-[48px] px-4"
      >
        <RefreshCw size={16} className="mr-1" />
        Cambiar Estado
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        disabled={isPending}
        className="min-h-[48px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Seleccionar nuevo estado"
      >
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <Button
        onClick={handleChange}
        disabled={isPending || selectedId === currentStatusId}
        className="min-h-[48px] bg-integra-navy px-3 hover:bg-integra-navy/90"
      >
        {isPending ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Check size={16} />
        )}
        <span className="sr-only">Confirmar cambio de estado</span>
      </Button>
      <Button
        variant="ghost"
        onClick={() => { setIsOpen(false); setError(null); }}
        disabled={isPending}
        className="min-h-[48px] px-3 text-gray-500"
      >
        ✕
      </Button>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
