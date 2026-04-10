"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DeleteDocumentButtonProps {
  documentId: string;
  fileName: string;
  createdAt: string;
}

export function DeleteDocumentButton({
  documentId,
  fileName,
  createdAt,
}: DeleteDocumentButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/documents/${documentId}/delete`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || "Error al eliminar el documento");
        setLoading(false);
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      alert("Error de conexion. Intenta de nuevo.");
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
        title="Eliminar documento"
      >
        <Trash2 size={16} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={loading ? undefined : () => setOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-lg bg-white shadow-xl">
            <button
              onClick={() => setOpen(false)}
              disabled={loading}
              className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              <X size={20} />
            </button>

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                  <AlertTriangle size={20} className="text-red-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">
                  Eliminar documento
                </h3>
              </div>

              <p className="text-sm text-gray-600">
                ¿Estas seguro de que deseas eliminar este documento?
              </p>

              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 space-y-1">
                <p className="text-sm font-medium text-gray-800 break-all">
                  {fileName}
                </p>
                <p className="text-xs text-gray-500">Subido: {createdAt}</p>
              </div>

              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-sm font-medium text-red-700">
                  Esta accion no se puede deshacer.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={loading}
                  className="min-h-[48px] flex-1"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleDelete}
                  disabled={loading}
                  className="min-h-[48px] flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {loading ? "Eliminando..." : "Si, eliminar"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
