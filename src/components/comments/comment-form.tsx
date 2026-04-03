"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MessageSquarePlus, Loader2 } from "lucide-react";

interface CommentFormProps {
  caseId: string;
  onSuccess?: () => void;
}

export function CommentForm({ caseId, onSuccess }: CommentFormProps) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [followUpDate, setFollowUpDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!text.trim()) {
      setError("El comentario no puede estar vacío.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: caseId, text: text.trim(), follow_up_date: followUpDate }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al agregar el comentario.");
        setLoading(false);
        return;
      }

      setText("");
      onSuccess?.();
      router.refresh();
    } catch {
      setError("Error de conexión. Intente de nuevo.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="follow-up-date" className="text-sm font-medium text-integra-navy">
          Fecha de seguimiento
        </Label>
        <input
          id="follow-up-date"
          type="date"
          value={followUpDate}
          onChange={(e) => setFollowUpDate(e.target.value)}
          disabled={loading}
          className="block w-full rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="comment-text" className="text-sm font-medium text-integra-navy">
          Agregar Comentario
        </Label>
        <textarea
          id="comment-text"
          rows={3}
          placeholder="Escriba su comentario aquí..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
          className="w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold"
        />
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <Button
        type="submit"
        disabled={loading || !text.trim()}
        className="h-11 w-full bg-integra-navy text-white hover:bg-integra-navy/90 font-medium sm:w-auto sm:px-6"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Publicando...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <MessageSquarePlus size={16} />
            Publicar Comentario
          </span>
        )}
      </Button>
    </form>
  );
}
