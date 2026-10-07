"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fechaCorta } from "@/lib/finanzas/contabilidad/inicio-contable";

/**
 * 100: la FECHA DE LA APERTURA. La decide el contador (30/06/2026, el día antes
 * del inicio contable, o 31/12/2025 con enero a junio importado). Siempre
 * anterior al inicio; no cambia con una apertura vigente.
 */
export function FechaAperturaCard({
  fecha,
  esParametro,
  inicio,
  conVigente,
  canEdit,
}: {
  fecha: string;
  esParametro: boolean;
  inicio: string;
  conVigente: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [valor, setValor] = useState(fecha);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function guardar(fechaApertura: string | null) {
    setError(null);
    setOk(false);
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/configuracion/fecha-apertura", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fecha_apertura: fechaApertura }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.errors?.fecha_apertura ?? data.error ?? "No se pudo guardar la fecha de la apertura.");
          return;
        }
        setValor(data.fecha_apertura);
        setOk(true);
        router.refresh();
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  return (
    <section className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-start gap-2">
        <CalendarClock size={18} className="mt-0.5 text-integra-gold" />
        <div>
          <h2 className="text-base font-semibold text-integra-navy">Fecha de la apertura</h2>
          <p className="text-xs text-gray-500">
            El día de los saldos iniciales que vienen de los libros del contador (Asientos de Diario › Apertura). Tiene que
            ser anterior al inicio contable ({fechaCorta(inicio)}). Al 31/12 la apertura lleva sólo cuentas de balance; a mitad
            de año, también lo acumulado de las cuentas de resultado.{" "}
            {esParametro ? "" : "Mientras no se elija, es el día anterior al inicio contable."}
          </p>
        </div>
      </div>

      {canEdit && !conVigente ? (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="fecha_apertura" className="mb-1 block text-xs font-medium">Fecha de la apertura</label>
            <input
              id="fecha_apertura"
              type="date"
              value={valor}
              onChange={(e) => { setValor(e.target.value); setOk(false); }}
              disabled={isPending}
              className="min-h-[44px] rounded-md border border-gray-300 px-3 font-mono text-sm"
            />
          </div>
          <Button type="button" onClick={() => guardar(valor)} disabled={isPending || !valor || (esParametro && valor === fecha)} className="min-h-[44px] gap-1.5">
            {isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Guardar fecha
          </Button>
          {esParametro && (
            <Button type="button" variant="outline" onClick={() => guardar(null)} disabled={isPending} className="min-h-[44px] gap-1.5">
              <RotateCcw size={16} />
              Volver al día anterior al inicio
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm">
          Fecha de la apertura: <span className="font-mono font-semibold">{fechaCorta(fecha)}</span>
          {conVigente && <span className="block text-xs text-gray-500">Hay una apertura vigente: la fecha no cambia mientras no se reverse.</span>}
        </p>
      )}

      {error && <p className="whitespace-pre-line text-sm text-red-700">{error}</p>}
      {ok && <p className="text-sm text-emerald-700">Fecha de la apertura guardada.</p>}
    </section>
  );
}
