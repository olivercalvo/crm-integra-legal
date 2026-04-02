"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";

interface MarkTaskButtonProps {
  taskId: string;
  /** Optional callback invoked after successful completion */
  onSuccess?: () => void;
}

export function MarkTaskButton({ taskId, onSuccess }: MarkTaskButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cumplida" }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Error al completar la tarea");
        return;
      }

      onSuccess?.();
      router.refresh();
    } catch {
      setError("Error de conexión. Intente de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleClick}
        disabled={loading}
        className="min-h-[48px] min-w-[48px] border-green-300 text-green-700 hover:bg-green-50 hover:border-green-400 active:bg-green-100"
        aria-label="Marcar tarea como cumplida"
      >
        {loading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <CheckCircle2 size={16} className="shrink-0" />
        )}
        <span className="ml-1.5">
          {loading ? "Completando..." : "Marcar Cumplida"}
        </span>
      </Button>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
