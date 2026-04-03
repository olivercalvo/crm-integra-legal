"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AddCommentFormProps {
  caseId: string;
}

export function AddCommentForm({ caseId }: AddCommentFormProps) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [followUpDate, setFollowUpDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

        setText("");
        setError(null);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        setError(`Error de conexión: ${message}. Verifica tu conexión a internet.`);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
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
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Agregar un comentario..."
        rows={3}
        disabled={isPending}
        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
      />
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isPending || !text.trim()}
          className="min-h-[48px] bg-integra-navy px-4 hover:bg-integra-navy/90"
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
