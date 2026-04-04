"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, MessageSquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AddCommentFormProps {
  caseId: string;
}

export function AddCommentForm({ caseId }: AddCommentFormProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState("");
  const [followUpDate, setFollowUpDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setText("");
    setShowForm(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    startTransition(async () => {
      try {
        const response = await fetch(`/api/cases/${caseId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed, follow_up_date: followUpDate }),
        });

        if (!response.ok) {
          const json = await response.json().catch(() => ({}));
          setError(json.error ?? `Error ${response.status}: ${response.statusText}`);
          return;
        }

        reset();
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        setError(`Error de conexión: ${message}. Verifica tu conexión a internet.`);
      }
    });
  };

  if (!showForm) {
    return (
      <Button
        onClick={() => { setShowForm(true); setError(null); }}
        variant="outline"
        className="min-h-[56px] w-full border-blue-200 text-blue-700 hover:bg-blue-50 font-semibold text-base gap-2"
      >
        <MessageSquarePlus size={20} />
        + Agregar Comentario/Seguimiento
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-blue-200 bg-blue-50/30 p-4 space-y-3">
      <h4 className="font-semibold text-blue-800 flex items-center gap-2">
        <MessageSquarePlus size={18} />
        Nuevo Comentario
      </h4>
      <div className="space-y-1">
        <label htmlFor="follow-up-date" className="text-sm font-medium text-gray-700">
          Fecha de seguimiento
        </label>
        <input
          id="follow-up-date"
          type="date"
          value={followUpDate}
          onChange={(e) => setFollowUpDate(e.target.value)}
          disabled={isPending}
          className="block w-full min-h-[48px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Agregar un comentario o seguimiento..."
        rows={3}
        disabled={isPending}
        autoFocus
        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
      />
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
      <div className="flex gap-2 justify-end">
        <Button type="button" onClick={reset} variant="ghost" disabled={isPending} className="min-h-[44px]">
          <X size={16} className="mr-1" /> Cancelar
        </Button>
        <Button
          type="submit"
          disabled={isPending || !text.trim()}
          className="min-h-[44px] bg-blue-600 px-4 hover:bg-blue-700"
        >
          {isPending ? (
            <>
              <Loader2 size={16} className="mr-2 animate-spin" />
              Enviando...
            </>
          ) : (
            <>
              <Send size={16} className="mr-2" />
              Comentar
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
