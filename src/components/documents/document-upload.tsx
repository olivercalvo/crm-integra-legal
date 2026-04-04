"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, X, FileText, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DocumentUploadProps {
  entityType: "client" | "case" | "task" | "comment";
  entityId: string;
}

export function DocumentUpload({ entityType, entityId }: DocumentUploadProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setSelectedFiles((prev) => [...prev, ...files]);
    setError(null);
    setSuccess(null);
    // Reset input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = () => {
    if (selectedFiles.length === 0) return;

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("entity_type", entityType);
        formData.append("entity_id", entityId);
        selectedFiles.forEach((file) => formData.append("files", file));

        const response = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const json = await response.json().catch(() => ({}));
          setError(json.error ?? `Error ${response.status}: ${response.statusText}`);
          return;
        }

        setSelectedFiles([]);
        setError(null);
        setSuccess(`${selectedFiles.length} documento(s) subido(s) correctamente`);
        setTimeout(() => setSuccess(null), 3000);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        setError(`Error de conexión: ${message}`);
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          className="min-h-[56px] px-8 bg-integra-gold text-integra-navy hover:bg-integra-gold/90 font-semibold text-base shadow-sm"
          disabled={isPending}
        >
          <Upload size={22} className="mr-2" />
          Adjuntar Documento
        </Button>
        <p className="text-center text-xs text-gray-400">
          PDF, Word, Excel, imágenes — se almacenan en Supabase Storage
        </p>
      </div>

      {/* Selected files preview */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2 rounded-lg border border-integra-gold/30 bg-integra-gold/5 p-3">
          <p className="text-sm font-medium text-integra-navy">
            Archivos seleccionados ({selectedFiles.length}):
          </p>
          {selectedFiles.map((file, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <Paperclip size={14} className="text-gray-400" />
              <span className="flex-1 truncate">{file.name}</span>
              <span className="text-xs text-gray-400">
                {(file.size / 1024).toFixed(0)} KB
              </span>
              <button
                onClick={() => removeFile(i)}
                className="rounded p-1 text-gray-400 hover:text-red-500"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <Button
            onClick={handleUpload}
            disabled={isPending}
            className="mt-2 min-h-[44px] w-full bg-integra-navy hover:bg-integra-navy/90"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Subiendo...
              </>
            ) : (
              <>
                <Upload size={16} className="mr-2" />
                Subir {selectedFiles.length} archivo(s)
              </>
            )}
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {success}
        </div>
      )}
    </div>
  );
}
