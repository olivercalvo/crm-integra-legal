"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Undo2 } from "lucide-react";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

/**
 * Deshacer una importación COMPLETA: cada asiento se reversa con la fecha de
 * hoy (067, `reverse_journal_import`). Nada se borra. Una sola transacción.
 */
export function DeshacerImportacion({ importId, cantidad }: { importId: string; cantidad: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/finanzas/asientos/importaciones/${importId}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: motivo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se deshizo nada.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMotivo("");
          setError(null);
          setOpen(true);
        }}
        className="inline-flex min-h-[48px] items-center gap-2 rounded-md border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-800 hover:bg-amber-50"
      >
        <Undo2 size={16} />
        Deshacer la importación
      </button>
      <ConfirmationModal
        open={open}
        onClose={() => {
          if (!isPending) setOpen(false);
        }}
        onConfirm={submit}
        loading={isPending}
        confirmDisabled={motivo.trim().length < 3}
        title="Deshacer la importación"
        confirmButtonText={isPending ? "Deshaciendo…" : `Reversar ${cantidad} asiento${cantidad === 1 ? "" : "s"}`}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-3">
          <p>
            Se registrarán {cantidad} asiento{cantidad === 1 ? "" : "s"} de reversión con la fecha de hoy. Los asientos
            importados no se borran: quedan en el libro junto con su espejo. Si alguno ya se había reversado a mano, se
            deja como está.
          </p>
          <label className="block text-sm">
            Motivo *
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              maxLength={1000}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Ej: El archivo tenía montos del mes equivocado…"
            />
          </label>
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}
