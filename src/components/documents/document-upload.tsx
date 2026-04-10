"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, X, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { directUpload } from "@/lib/storage/direct-upload";

interface DocumentUploadProps {
  entityType: "client" | "case" | "task" | "comment";
  entityId: string;
}

export function DocumentUpload({ entityType, entityId }: DocumentUploadProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Validate each file size
    const oversized = files.find((f) => f.size > 10 * 1024 * 1024);
    if (oversized) {
      setError(`Archivo demasiado grande: ${oversized.name} (máximo 10MB)`);
      return;
    }
    setSelectedFiles((prev) => [...prev, ...files]);
    setError(null);
    setSuccess(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setError(null);
    setProgress(0);
    let uploadedCount = 0;

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        setCurrentFileIndex(i);
        const file = selectedFiles[i];

        // Upload directly to Supabase Storage
        const { storagePath, fileName } = await directUpload({
          file,
          pathPrefix: `${entityType}/${entityId}`,
          onProgress: (pct) => {
            // Combine file-level progress with overall progress
            const overall = Math.round(((i + pct / 100) / selectedFiles.length) * 100);
            setProgress(overall);
          },
        });

        // Register metadata via lightweight JSON API
        const res = await fetch("/api/documents/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entity_type: entityType,
            entity_id: entityId,
            file_name: fileName,
            storage_path: storagePath,
          }),
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Error al registrar documento");
        }

        uploadedCount++;
      }

      setSelectedFiles([]);
      setSuccess(`${uploadedCount} documento(s) subido(s) correctamente`);
      setTimeout(() => setSuccess(null), 3000);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      setError(message);
    } finally {
      setUploading(false);
      setProgress(0);
      setCurrentFileIndex(0);
    }
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
          disabled={uploading}
        >
          <Upload size={22} className="mr-2" />
          Adjuntar Documento
        </Button>
        <p className="text-center text-xs text-gray-400">
          PDF, Word, Excel, imágenes — máximo 10MB por archivo
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
              {!uploading && (
                <button
                  onClick={() => removeFile(i)}
                  className="rounded p-1 text-gray-400 hover:text-red-500"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}

          {/* Progress bar */}
          {uploading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Subiendo archivo {currentFileIndex + 1} de {selectedFiles.length}...</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-integra-gold transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <Button
            onClick={handleUpload}
            disabled={uploading}
            className="mt-2 min-h-[44px] w-full bg-integra-navy hover:bg-integra-navy/90"
          >
            {uploading ? (
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
