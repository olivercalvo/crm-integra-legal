"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, PencilLine, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface Props {
  id: string;
  /** Si el usuario puede mutar (admin/abogada/contador). Solo el asistente queda sin acceso al módulo. */
  canMutate: boolean;
  /**
   * 096: si la compra está contabilizada fuera, el motivo. «Eliminar» queda
   * deshabilitado y el texto se muestra debajo; la ruta responde 409 igual.
   */
  bloqueoEliminar?: string | null;
  /**
   * 103: si la compra está contabilizada, «Editar» pasa a «Corregir» (reversa
   * el asiento y registra el corregido). `bloqueo` es por qué no se puede
   * (pagos, NC, mes cerrado): el botón queda deshabilitado y el motivo se ve
   * ANTES de editar, no al guardar.
   */
  correccion?: { contabilizada: boolean; bloqueo: string | null };
}

/**
 * Botones de acción en la página de detalle de la compra: Editar (o Corregir,
 * si está contabilizada) y Eliminar (con confirmación).
 *
 * "Marcar como pagado" ya no vive acá (Bloque 3, 21/09/2026): el pago es una
 * entidad (`supplier_payments`, 048) y se registra desde la sección "Pagos"
 * del detalle (`supplier-payments-section.tsx`), con monto, banco y asiento.
 * El botón viejo escribía una columna que la tabla no tenía (FND-009).
 *
 * Sin permisos de mutación se renderiza solo un texto explicativo.
 */
export function BusinessExpenseActions({ id, canMutate, bloqueoEliminar = null, correccion }: Props) {
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
    <div className="flex basis-full flex-col items-end gap-1 sm:basis-auto">
      <div className="flex flex-wrap gap-2">
        {correccion?.contabilizada && correccion.bloqueo ? (
          <Button variant="outline" disabled title={correccion.bloqueo} className="min-h-[44px]">
            <PencilLine size={16} className="mr-1.5" />
            Corregir
          </Button>
        ) : (
          <Link href={`/finanzas/gastos-bufete/${id}/editar`}>
            <Button variant="outline" disabled={isPending} className="min-h-[44px]">
              {correccion?.contabilizada ? <PencilLine size={16} className="mr-1.5" /> : <Pencil size={16} className="mr-1.5" />}
              {correccion?.contabilizada ? "Corregir" : "Editar"}
            </Button>
          </Link>
        )}
        <Button
          variant="outline"
          onClick={() => setShowDelete(true)}
          disabled={isPending || !!bloqueoEliminar}
          title={bloqueoEliminar ?? undefined}
          className="min-h-[44px] border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          <Trash2 size={16} className="mr-1.5" />
          Eliminar
        </Button>
      </div>
      {correccion?.contabilizada && correccion.bloqueo && (
        <p className="max-w-sm text-right text-xs text-amber-800" role="note">
          <span className="font-semibold">No se puede corregir: </span>
          {correccion.bloqueo}
        </p>
      )}
      {bloqueoEliminar && <p className="mt-2 max-w-md text-xs text-slate-600">{bloqueoEliminar}</p>}

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
    </div>
  );
}
