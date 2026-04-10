"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MessageSquarePlus, Loader2, Paperclip, X } from "lucide-react";
import { directUpload } from "@/lib/storage/direct-upload";

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
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      // Upload attached files directly to Storage, then register metadata
      if (attachedFiles.length > 0 && data.id) {
        for (const file of attachedFiles) {
          try {
            const { storagePath, fileName } = await directUpload({
              file,
              pathPrefix: `comment/${data.id}`,
            });
            await fetch("/api/documents/register", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                entity_type: "comment",
                entity_id: data.id,
                file_name: fileName,
                storage_path: storagePath,
              }),
            });
          } catch {
            // Continue with remaining files if one fails
          }
        }
      }

      setText("");
      setAttachedFiles([]);
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

      {/* File attachments */}
      <div className="space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            setAttachedFiles((prev) => [...prev, ...files]);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-integra-navy"
        >
          <Paperclip size={14} />
          Adjuntar archivo
        </button>
        {attachedFiles.length > 0 && (
          <div className="space-y-1 rounded-md border border-gray-200 bg-gray-50 p-2">
            {attachedFiles.map((file, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Paperclip size={12} className="text-gray-400" />
                <span className="flex-1 truncate">{file.name}</span>
                <span className="text-gray-400">{(file.size / 1024).toFixed(0)} KB</span>
                <button
                  type="button"
                  onClick={() => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-gray-400 hover:text-red-500"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
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
