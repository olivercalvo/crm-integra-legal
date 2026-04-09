"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationModal } from "@/components/ui/delete-confirmation-modal";

interface DeleteCaseButtonProps {
  caseId: string;
  caseCode: string;
  clientName: string;
  description: string | null;
}

export function DeleteCaseButton({
  caseId,
  caseCode,
  clientName,
  description,
}: DeleteCaseButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/cases/${caseId}/delete`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || "Error al eliminar el caso");
        setLoading(false);
        return;
      }

      // Redirect to cases list — the page will show a success message via query param
      router.push(`/abogada/casos?deleted=${encodeURIComponent(caseCode)}`);
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
        Eliminar caso
      </Button>

      <DeleteConfirmationModal
        open={open}
        onClose={() => !loading && setOpen(false)}
        onConfirm={handleDelete}
        loading={loading}
        title="Eliminar caso"
        confirmCode={caseCode}
        warningText="Esta accion no se puede deshacer. Se eliminaran tambien los gastos, tareas, comentarios y documentos asociados a este caso."
        confirmButtonText="Si, eliminar caso"
      >
        <div className="space-y-2">
          <p><span className="font-medium">Codigo:</span> {caseCode}</p>
          <p><span className="font-medium">Cliente:</span> {clientName}</p>
          {description && (
            <p><span className="font-medium">Descripcion:</span> {description}</p>
          )}
        </div>
      </DeleteConfirmationModal>
    </>
  );
}
