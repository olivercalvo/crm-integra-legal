"use client";

import { useState, useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DeleteConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
  title: string;
  confirmCode: string;
  children: React.ReactNode;
  warningText: string;
  confirmButtonText: string;
  /** When true, the confirm button stays disabled regardless of input */
  forceDisabled?: boolean;
}

export function DeleteConfirmationModal({
  open,
  onClose,
  onConfirm,
  loading,
  title,
  confirmCode,
  children,
  warningText,
  confirmButtonText,
  forceDisabled = false,
}: DeleteConfirmationModalProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isMatch = inputValue === confirmCode;

  useEffect(() => {
    if (open) {
      setInputValue("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

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
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={loading ? undefined : onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-lg bg-white shadow-xl">
        {/* Close button */}
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >
          <X size={20} />
        </button>

        <div className="p-6 space-y-4">
          {/* Icon + Title */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle size={20} className="text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          </div>

          {/* Content (details about what will be deleted) */}
          <div className="text-sm text-gray-600">{children}</div>

          {/* Warning */}
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-sm font-medium text-red-700">{warningText}</p>
          </div>

          {/* Confirmation input — hidden when deletion is blocked */}
          {!forceDisabled && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Escribe <span className="font-mono font-bold text-red-600">{confirmCode}</span> para confirmar
              </label>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={`Escribe ${confirmCode} para confirmar`}
                disabled={loading}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
              />
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            {forceDisabled ? (
              <Button
                variant="outline"
                onClick={onClose}
                className="min-h-[48px] flex-1"
              >
                Cerrar
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={loading}
                  className="min-h-[48px] flex-1"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={onConfirm}
                  disabled={!isMatch || loading}
                  className="min-h-[48px] flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {loading ? "Eliminando..." : confirmButtonText}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
