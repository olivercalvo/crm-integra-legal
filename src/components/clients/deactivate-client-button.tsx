"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, UserX } from "lucide-react";

interface DeactivateClientButtonProps {
  clientId: string;
  clientName: string;
}

export function DeactivateClientButton({ clientId, clientName }: DeactivateClientButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleClick = () => {
    if (!confirming) {
      setConfirming(true);
      // Auto-cancel confirmation after 5 seconds
      setTimeout(() => setConfirming(false), 5000);
      return;
    }
    handleDeactivate();
  };

  const handleDeactivate = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/clients/${clientId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || "Error al desactivar el cliente");
        return;
      }

      router.push("/abogada/clientes");
      router.refresh();
    } catch {
      alert("Error de conexión. Intenta de nuevo.");
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {confirming && !loading && (
        <span className="text-sm text-red-600 font-medium">
          ¿Confirmar desactivación de {clientName}?
        </span>
      )}
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={loading}
        className={`min-h-[48px] border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 ${
          confirming ? "border-red-400 bg-red-50" : ""
        }`}
      >
        {loading ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Desactivando…
          </>
        ) : (
          <>
            <UserX size={18} />
            {confirming ? "Sí, desactivar" : "Desactivar"}
          </>
        )}
      </Button>
      {confirming && !loading && (
        <Button
          variant="ghost"
          onClick={() => setConfirming(false)}
          className="min-h-[48px] text-gray-500"
        >
          Cancelar
        </Button>
      )}
    </div>
  );
}
