"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseTaxRatePercent } from "@/lib/finanzas/types/tax-code";

/**
 * E10: la tasa de IMPUESTO SOBRE LA RENTA del Estado de Resultado (078).
 *
 * La pantalla pide el PORCENTAJE y muestra la FRACCIÓN que se va a guardar, igual
 * que las tasas de impuesto: «25» tiene que verse como 0.2500 antes de guardar.
 * Leen los tres roles de finanzas; editan admin y contador.
 */
export function TasaIsrCard({ tasa, canEdit }: { tasa: number; canEdit: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pct, setPct] = useState(() => String(Math.round(tasa * 10000) / 100));
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const fraccion = parseTaxRatePercent(pct);
  const valida = fraccion !== null && fraccion >= 0 && fraccion <= 1;

  function guardar() {
    setError(null);
    setOk(false);
    if (!valida) {
      setError("Escribe un porcentaje entre 0 y 100.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/configuracion/parametros", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isr_rate: fraccion }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.errors?.isr_rate ?? data.error ?? "No se pudo guardar la tasa.");
          return;
        }
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
        <Landmark size={18} className="mt-0.5 text-integra-gold" />
        <div>
          <h2 className="text-base font-semibold text-integra-navy">Impuesto sobre la renta</h2>
          <p className="text-xs text-gray-500">
            Tasa con la que el Estado de Resultado calcula la línea de impuesto sobre la renta. Para
            una sociedad civil es 0 %. Es un cálculo del reporte: no genera asientos.
          </p>
        </div>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="tasa_isr" className="mb-1 block text-xs font-medium">
              Tasa (%)
            </label>
            <input
              id="tasa_isr"
              type="text"
              inputMode="decimal"
              value={pct}
              onChange={(e) => {
                setPct(e.target.value);
                setOk(false);
              }}
              disabled={isPending}
              className={`min-h-[44px] w-32 rounded-md border px-3 text-right font-mono text-sm ${
                valida ? "border-gray-300" : "border-red-300"
              }`}
            />
          </div>
          <p className="pb-3 text-xs text-gray-500">
            Se guarda como <span className="font-mono">{valida ? fraccion!.toFixed(4) : "?"}</span>
          </p>
          <Button type="button" onClick={guardar} disabled={isPending || !valida} className="min-h-[44px] gap-1.5">
            {isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Guardar tasa
          </Button>
        </div>
      ) : (
        <p className="text-sm">
          Tasa vigente: <span className="font-mono font-semibold">{Math.round(tasa * 10000) / 100} %</span>
        </p>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
      {ok && <p className="text-sm text-emerald-700">Tasa guardada. El Estado de Resultado ya la usa.</p>}
    </section>
  );
}
