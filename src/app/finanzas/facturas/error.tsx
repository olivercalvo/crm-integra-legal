"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary para /finanzas/facturas*. Captura errors no manejados en
 * server components o effects. Exposes 'reset' para reintentar.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[finanzas/facturas] error boundary:", error);
  }, [error]);

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <AlertTriangle size={32} className="mx-auto text-red-600 mb-2" />
      <h2 className="text-lg font-semibold text-red-700">
        Algo salió mal en Facturas
      </h2>
      <p className="mt-1 text-sm text-red-600">
        {error.message || "Error inesperado. Intentá recargar la página."}
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-red-500 font-mono">ref: {error.digest}</p>
      )}
      <div className="mt-4">
        <Button onClick={reset} variant="outline">
          Reintentar
        </Button>
      </div>
    </div>
  );
}
