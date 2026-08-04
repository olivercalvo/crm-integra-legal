"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationModal } from "@/components/ui/delete-confirmation-modal";
import {
  buildFinancialBlockMessage,
  type FinancialCounts,
} from "@/lib/clients/delete-guards";

interface DeleteClientButtonProps {
  clientId: string;
  clientNumber: string;
  clientName: string;
  caseCount: number;
  /**
   * Conteos de facturas/cotizaciones/NCs/pagos. Bloquean el borrado por FK
   * RESTRICT; se pasan para avisar ANTES de que la usuaria escriba el código.
   * El API valida igual — esto es solo UX.
   */
  financialCounts?: FinancialCounts;
}

export function DeleteClientButton({
  clientId,
  clientNumber,
  clientName,
  caseCount,
  financialCounts,
}: DeleteClientButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCases = caseCount > 0;
  const financialBlock = buildFinancialBlockMessage(financialCounts ?? {});
  // Mismo orden de precedencia que el route handler: casos primero.
  const blocked = hasCases || financialBlock !== null;

  const handleClose = () => {
    if (loading) return;
    setError(null);
    setOpen(false);
  };

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${clientId}/delete`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || "Error al eliminar el cliente");
        setLoading(false);
        return;
      }

      router.push(`/legal/clientes?deleted=${encodeURIComponent(clientNumber)}`);
      router.refresh();
    } catch {
      setError("Error de conexion. Intenta de nuevo.");
      setLoading(false);
    }
  };

  const warningText = hasCases
    ? `Este cliente tiene ${caseCount} caso(s) asociado(s). Debes eliminar los casos primero antes de poder eliminar el cliente.`
    : financialBlock
      ? financialBlock
      : "Esta accion no se puede deshacer. Se eliminaran tambien los documentos asociados a este cliente.";

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
        onClose={handleClose}
        onConfirm={handleDelete}
        loading={loading}
        title="Eliminar cliente"
        confirmCode={clientNumber}
        warningText={warningText}
        confirmButtonText="Si, eliminar cliente"
        forceDisabled={blocked}
      >
        <div className="space-y-2">
          <p><span className="font-medium">Codigo:</span> {clientNumber}</p>
          <p><span className="font-medium">Nombre:</span> {clientName}</p>
          {hasCases && (
            <p className="font-medium text-amber-700">
              Este cliente tiene {caseCount} caso(s) asociado(s).
            </p>
          )}
          {!hasCases && financialBlock && (
            <p className="font-medium text-amber-700">
              Tiene registros financieros asociados.
            </p>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
            >
              {error}
            </div>
          )}
        </div>
      </DeleteConfirmationModal>
    </>
  );
}
