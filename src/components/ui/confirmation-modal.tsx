"use client";

import { useEffect } from "react";
import { AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
  title: string;
  children: React.ReactNode;
  confirmButtonText?: string;
  cancelButtonText?: string;
}

export function ConfirmationModal({
  open,
  onClose,
  onConfirm,
  loading = false,
  title,
  children,
  confirmButtonText = "Confirmar",
  cancelButtonText = "Cancelar",
}: ConfirmationModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, loading, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={loading ? undefined : onClose}
      />
      <div className="relative w-full max-w-md rounded-lg bg-white shadow-xl">
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
          aria-label="Cerrar"
        >
          <X size={20} />
        </button>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-integra-gold/20">
              <AlertCircle size={20} className="text-integra-navy" />
            </div>
            <h3 className="text-lg font-bold text-integra-navy">{title}</h3>
          </div>
          <div className="text-sm text-gray-700">{children}</div>
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={loading}
              className="min-h-[48px] flex-1"
            >
              {cancelButtonText}
            </Button>
            <Button
              onClick={onConfirm}
              disabled={loading}
              className="min-h-[48px] flex-1 bg-integra-navy text-white hover:bg-integra-navy/90"
            >
              {loading ? "Procesando..." : confirmButtonText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
