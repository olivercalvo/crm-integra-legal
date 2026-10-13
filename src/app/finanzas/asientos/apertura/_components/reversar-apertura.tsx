"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { MENSAJE_POSTEO_HISTORICO_APAGADO } from "@/lib/finanzas/posteo-historico-mensaje";

const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

/** Reversar la apertura vigente: con su misma fecha y el mes abierto (101). */
export function ReversarApertura({ fecha, referencia, habilitado }: { fecha: string; referencia: string; habilitado: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reversar() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/asientos/apertura/reversar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motivo }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo reversar la apertura.");
          return;
        }
        setAbierto(false);
        router.refresh();
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  return (
    <div>
      <Button type="button" variant="outline" className="min-h-[48px] gap-2" disabled={!habilitado} onClick={() => setAbierto(true)}>
        <Undo2 size={16} /> Reversar la apertura
      </Button>
      {!habilitado && <p className="mt-2 text-sm font-semibold text-amber-800">{MENSAJE_POSTEO_HISTORICO_APAGADO}</p>}
      <ConfirmationModal
        open={abierto}
        onClose={() => !isPending && setAbierto(false)}
        onConfirm={reversar}
        loading={isPending}
        title="Reversar la apertura"
        confirmButtonText={isPending ? "Reversando…" : "Sí, reversar"}
        confirmDisabled={motivo.trim().length < 3}
      >
        <div className="space-y-3 text-sm">
          <p>
            Se registra un asiento espejo de {referencia} con la MISMA fecha ({fechaCorta(fecha)}). Las dos quedan en el
            libro y suman cero. Después se puede cargar una apertura nueva.
          </p>
          <label htmlFor="motivo" className="block text-xs font-medium">Motivo (queda en el libro y en la bitácora)</label>
          <textarea
            id="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            maxLength={1000}
            className="w-full rounded-md border border-gray-300 p-2"
          />
          {error && <p className="text-red-700" role="alert">{error}</p>}
        </div>
      </ConfirmationModal>
    </div>
  );
}
