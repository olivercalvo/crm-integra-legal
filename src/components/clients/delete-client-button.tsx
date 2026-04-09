"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationModal } from "@/components/ui/delete-confirmation-modal";

interface DeleteClientButtonProps {
  clientId: string;
  clientNumber: string;
  clientName: string;
  caseCount: number;
}

export function DeleteClientButton({
  clientId,
  clientNumber,
  clientName,
  caseCount,
}: DeleteClientButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const hasCases = caseCount > 0;

  const handleDelete = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/clients/${clientId}/delete`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || "Error al eliminar el cliente");
        setLoading(false);
        return;
      }

      router.push(`/abogada/clientes?deleted=${encodeURIComponent(clientNumber)}`);
      router.refresh();
    } catch {
      alert("Error de conexión. Intenta de nuevo.");
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="min-h-[48px] border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
      >
        <Trash2 size={18} className="mr-1" />
        Eliminar cliente
      </Button>

      <DeleteConfirmationModal
        open={open}
        onClose={() => !loading && setOpen(false)}
        onConfirm={handleDelete}
        loading={loading}
        title="Eliminar cliente"
        confirmCode={clientNumber}
        warningText={
          hasCases
            ? `Este cliente tiene ${caseCount} caso(s) asociado(s). Debes eliminar los casos primero antes de poder eliminar el cliente.`
            : "Esta accion no se puede deshacer. Se eliminaran tambien los documentos asociados a este cliente."
        }
        confirmButtonText="Si, eliminar cliente"
        forceDisabled={hasCases}
      >
        <div className="space-y-2">
          <p><span className="font-medium">Codigo:</span> {clientNumber}</p>
          <p><span className="font-medium">Nombre:</span> {clientName}</p>
          {hasCases && (
            <p className="font-medium text-amber-700">
              Este cliente tiene {caseCount} caso(s) asociado(s).
            </p>
          )}
        </div>
      </DeleteConfirmationModal>
    </>
  );
}
