"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Pencil, Trash2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import {
  BUSINESS_EXPENSE_PAYMENT_METHOD_LABEL,
  type BusinessExpensePaymentMethod,
  type BusinessExpenseStatus,
} from "@/lib/finanzas/types/business-expense";

interface Props {
  id: string;
  status: BusinessExpenseStatus;
  /** Si el usuario puede mutar (admin/abogada/contador). Solo el asistente queda sin acceso al módulo. */
  canMutate: boolean;
}

const PAYMENT_METHODS: BusinessExpensePaymentMethod[] = [
  "efectivo",
  "transferencia",
  "tarjeta",
  "cheque",
  "otro",
];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Botones de acción en la página de detalle:
 *   - Marcar como pagado (solo si status='pendiente_pago')
 *   - Editar
 *   - Eliminar (con confirmación)
 *
 * Sin permisos de mutación se renderiza solo un texto explicativo.
 */
export function BusinessExpenseActions({ id, status, canMutate }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Mark as paid
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState<BusinessExpensePaymentMethod | "">("");
  const [markPaidError, setMarkPaidError] = useState<string | null>(null);

  // Delete
  const [showDelete, setShowDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!canMutate) {
    return (
      <p className="text-xs text-gray-500">
        Solo administrador, abogada o contador pueden modificar este gasto.
      </p>
    );
  }

  function handleMarkPaid() {
    setMarkPaidError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/business-expenses/${id}/mark-paid`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment_date: paymentDate,
            payment_method: paymentMethod || null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMarkPaidError(data.error ?? "Error al marcar como pagado");
          return;
        }
        setShowMarkPaid(false);
        router.refresh();
      } catch {
        setMarkPaidError("Error de red. Intenta de nuevo.");
      }
    });
  }

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/business-expenses/${id}`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setDeleteError(data.error ?? "Error al eliminar");
          return;
        }
        router.push("/finanzas/gastos-bufete?deleted=1");
        router.refresh();
      } catch {
        setDeleteError("Error de red. Intenta de nuevo.");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === "pendiente_pago" && (
          <Button
            onClick={() => setShowMarkPaid(true)}
            disabled={isPending}
            className="bg-emerald-600 hover:bg-emerald-600/90 text-white min-h-[44px]"
          >
            <CheckCircle2 size={16} className="mr-1.5" />
            Marcar como pagado
          </Button>
        )}
        <Link href={`/finanzas/gastos-bufete/${id}/editar`}>
          <Button
            variant="outline"
            disabled={isPending}
            className="min-h-[44px]"
          >
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

      {/* Modal: Marcar como pagado */}
      {showMarkPaid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={isPending ? undefined : () => setShowMarkPaid(false)}
          />
          <div className="relative w-full max-w-md rounded-lg bg-white shadow-xl">
            <button
              onClick={() => setShowMarkPaid(false)}
              disabled={isPending}
              className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
              aria-label="Cerrar"
            >
              <X size={20} />
            </button>
            <div className="p-6 space-y-4">
              <h3 className="text-lg font-bold text-integra-navy">Marcar como pagado</h3>
              <div className="space-y-3">
                <div>
                  <Label className="mb-1 block">Fecha de pago *</Label>
                  <Input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    disabled={isPending}
                  />
                </div>
                <div>
                  <Label className="mb-1 block">Método de pago</Label>
                  <select
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(e.target.value as BusinessExpensePaymentMethod | "")
                    }
                    disabled={isPending}
                    className="block w-full rounded-md border border-gray-300 px-3 min-h-[44px] text-sm bg-white"
                  >
                    <option value="">Sin especificar</option>
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {BUSINESS_EXPENSE_PAYMENT_METHOD_LABEL[pm]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {markPaidError && (
                <p className="text-sm text-red-600">{markPaidError}</p>
              )}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setShowMarkPaid(false)}
                  disabled={isPending}
                  className="min-h-[48px] flex-1"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleMarkPaid}
                  disabled={isPending}
                  className="min-h-[48px] flex-1 bg-emerald-600 text-white hover:bg-emerald-600/90"
                >
                  {isPending ? (
                    <>
                      <Loader2 size={16} className="mr-1.5 animate-spin" />
                      Guardando…
                    </>
                  ) : (
                    "Confirmar pago"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Eliminar */}
      <ConfirmationModal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        loading={isPending}
        title="Eliminar gasto"
        confirmButtonText="Eliminar"
      >
        <p>
          Esta acción es permanente. Se eliminarán todos los datos del gasto y el comprobante adjunto (si lo tiene). No se puede deshacer.
        </p>
        {deleteError && (
          <p className="mt-3 text-sm text-red-600">{deleteError}</p>
        )}
      </ConfirmationModal>
    </>
  );
}
