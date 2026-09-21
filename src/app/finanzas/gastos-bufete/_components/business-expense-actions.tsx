"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface Props {
  id: string;
  /** Si el usuario puede mutar (admin/abogada/contador). Solo el asistente queda sin acceso al módulo. */
  canMutate: boolean;
}

/**
 * Botones de acción en la página de detalle de la compra: Editar y Eliminar
 * (con confirmación).
 *
 * "Marcar como pagado" ya no vive acá (Bloque 3, 21/09/2026): el pago es una
 * entidad (`supplier_payments`, 048) y se registra desde la sección "Pagos"
 * del detalle (`supplier-payments-section.tsx`), con monto, banco y asiento.
 * El botón viejo escribía una columna que la tabla no tenía (FND-009).
 *
 * Sin permisos de mutación se renderiza solo un texto explicativo.
 */
export function BusinessExpenseActions({ id, canMutate }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showDelete, setShowDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!canMutate) {
    return <p className="text-xs text-gray-500">Solo lectura.</p>;
  }

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/business-expenses/${id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setDeleteError(data.error ?? "Error al eliminar");
          return;
        }
        router.push("/finanzas/gastos-bufete?deleted=1");
        router.refresh();
      } catch {
        setDeleteError("Error de red. Intente de nuevo.");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Link href={`/finanzas/gastos-bufete/${id}/editar`}>
          <Button variant="outline" disabled={isPending} className="min-h-[44px]">
            <Pencil size={16} className="mr-1.5" />
            Editar
          </Button>
        </Link>
        <Button
          variant="outline"
          onClick={() => setShowDelete(true)}
          disabled={isPending}
          className="min-h-[44px] border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          <Trash2 size={16} className="mr-1.5" />
          Eliminar
        </Button>
      </div>

      <ConfirmationModal
        open={showDelete}
        onClose={() => !isPending && setShowDelete(false)}
        onConfirm={handleDelete}
        loading={isPending}
        title="Eliminar gasto"
        confirmButtonText={isPending ? "Eliminando…" : "Sí, eliminar"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-3">
          <p>
            Esta acción es permanente. Se eliminarán todos los datos del gasto y el comprobante adjunto
            (si lo tiene). No se puede deshacer.
          </p>
          <p className="text-xs text-gray-500">
            Una compra contabilizada no se borra (se reversa), y una compra con pagos tampoco: primero se
            eliminan o reversan sus pagos.
          </p>
          {deleteError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{deleteError}</span>
            </div>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}
