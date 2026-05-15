"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, Trash2, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface Props {
  expenseId: string;
  /** Path en storage (bucket "documents"). NULL si no hay comprobante aún. */
  receiptUrl: string | null;
  receiptFilename: string | null;
  /** Si el usuario puede mutar (admin/contador). */
  canMutate: boolean;
  /** URL pública/firmada para previsualizar el comprobante existente, si aplica. */
  publicUrl: string | null;
}

const ALLOWED_EXTS = ["jpg", "jpeg", "png", "pdf"];
const MAX_SIZE_MB = 10;

/**
 * Carga / reemplazo / borrado de comprobante.
 *   - Sin recibo + canMutate: botón "Subir comprobante".
 *   - Con recibo: mostramos filename + link a previsualizar + reemplazar/borrar (si canMutate).
 *   - canMutate=false: solo permite previsualizar.
 */
export function ReceiptUploader({
  expenseId,
  receiptUrl,
  receiptFilename,
  canMutate,
  publicUrl,
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  function pickFile() {
    fileRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTS.includes(ext)) {
      setError(`Solo se permiten archivos ${ALLOWED_EXTS.join(", ").toUpperCase()}`);
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`El archivo excede el máximo de ${MAX_SIZE_MB}MB`);
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/finanzas/business-expenses/${expenseId}/receipt`,
          { method: "POST", body: formData }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Error al subir el comprobante");
          return;
        }
        router.refresh();
      } catch {
        setError("Error de red al subir. Intenta de nuevo.");
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/finanzas/business-expenses/${expenseId}/receipt`,
          { method: "DELETE" }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Error al borrar el comprobante");
          return;
        }
        setShowDelete(false);
        router.refresh();
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  if (!receiptUrl) {
    if (!canMutate) {
      return (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          No hay comprobante adjunto.
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center">
          <Upload size={28} className="mx-auto text-gray-400" />
          <p className="mt-2 text-sm text-gray-600">Sin comprobante adjunto</p>
          <Button
            type="button"
            onClick={pickFile}
            disabled={isPending}
            className="mt-3 bg-integra-navy text-white hover:bg-integra-navy/90 min-h-[44px]"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="mr-1.5 animate-spin" />
                Subiendo…
              </>
            ) : (
              <>
                <Upload size={16} className="mr-1.5" />
                Subir comprobante
              </>
            )}
          </Button>
          <p className="mt-2 text-xs text-gray-400">
            Formatos permitidos: JPG, PNG, PDF (máx. {MAX_SIZE_MB}MB)
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          onChange={handleFileChange}
          className="hidden"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  // Con receipt existente
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-md border border-integra-gold/40 bg-integra-gold/5 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={18} className="text-integra-gold shrink-0" />
          <span className="text-sm font-medium text-gray-900 truncate">
            {receiptFilename ?? "Comprobante adjunto"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {publicUrl && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-integra-navy hover:bg-white"
              title="Abrir en pestaña nueva"
            >
              <ExternalLink size={14} />
              Ver
            </a>
          )}
          {canMutate && (
            <>
              <button
                type="button"
                onClick={pickFile}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-white"
                title="Reemplazar"
              >
                <Upload size={14} />
                Reemplazar
              </button>
              <button
                type="button"
                onClick={() => setShowDelete(true)}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-white"
                title="Borrar comprobante"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".jpg,.jpeg,.png,.pdf"
        onChange={handleFileChange}
        className="hidden"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}

      <ConfirmationModal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        loading={isPending}
        title="Eliminar comprobante"
        confirmButtonText="Eliminar"
      >
        <p>
          El archivo se borrará del almacenamiento y la referencia se eliminará del gasto. Esta acción no afecta los montos.
        </p>
      </ConfirmationModal>
    </div>
  );
}
