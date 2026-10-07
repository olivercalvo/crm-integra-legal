"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, BookCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { MENSAJE_POSTEO_HISTORICO_APAGADO } from "@/lib/finanzas/posteo-historico-mensaje";

/**
 * Los dos botones del mes: el Excel EN SECO (no escribe nada) y «Contabilizar
 * el mes» (todo o nada, con confirmación). El segundo sólo se habilita si el
 * plan no tiene bloqueos; la ruta lo vuelve a verificar.
 */
export function ContabilizarMes({
  mes,
  puedeContabilizar,
  resumen,
  habilitado,
}: {
  mes: string;
  puedeContabilizar: boolean;
  resumen: string;
  /** Interruptor FINANZAS_POSTEO_HISTORICO_HABILITADO (la ruta lo vuelve a exigir). */
  habilitado: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function contabilizar() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/asientos/documentos-existentes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mes }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo contabilizar el mes.");
          return;
        }
        const a = data.asientos as { entry_number: number }[];
        setOk(`Contabilizado: ${a.length} asiento(s), del ${a[0]?.entry_number} al ${a[a.length - 1]?.entry_number}.`);
        setAbierto(false);
        router.refresh();
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <a
        href={`/api/finanzas/asientos/documentos-existentes?mes=${mes}`}
        className="inline-flex min-h-[48px] items-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-integra-navy hover:border-integra-navy"
      >
        <Download size={16} />
        Descargar en seco (Excel)
      </a>
      <Button
        type="button"
        onClick={() => setAbierto(true)}
        disabled={!habilitado || !puedeContabilizar || isPending}
        className="min-h-[48px] gap-2"
      >
        <BookCheck size={16} />
        Contabilizar el mes
      </Button>
      {!habilitado && <p className="text-sm font-semibold text-amber-800">{MENSAJE_POSTEO_HISTORICO_APAGADO}</p>}
      {ok && <p className="text-sm text-emerald-700">{ok}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <ConfirmationModal
        open={abierto}
        onClose={() => !isPending && setAbierto(false)}
        onConfirm={contabilizar}
        loading={isPending}
        title="Contabilizar el mes"
        confirmButtonText={isPending ? "Contabilizando…" : "Sí, contabilizar"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-2 text-sm">
          <p>Se van a registrar {resumen}. Los asientos no se borran: si algo está mal, se corrige con una reversión.</p>
          <p>Hazlo sólo después de que el contador revisó el Excel en seco de este mes.</p>
          {isPending && <Loader2 size={16} className="animate-spin" />}
        </div>
      </ConfirmationModal>
    </div>
  );
}
