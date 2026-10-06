"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fechaCorta } from "@/lib/finanzas/contabilidad/inicio-contable";

/**
 * 096: el INICIO CONTABLE del bufete. Los documentos con fecha anterior están
 * contabilizados fuera (QuickBooks): no generan asiento.
 *
 * Leen los tres roles de finanzas; editan admin y contador. Si el cambio dejara
 * documentos del lado equivocado, la base lo rechaza y el mensaje los nombra.
 */
export function InicioContableCard({ fecha, canEdit }: { fecha: string; canEdit: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [valor, setValor] = useState(fecha);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function guardar() {
    setError(null);
    setOk(false);
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/configuracion/inicio-contable", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fecha_inicio_contable: valor }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.errors?.fecha_inicio_contable ?? data.error ?? "No se pudo guardar el inicio contable.");
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
        <Archive size={18} className="mt-0.5 text-integra-gold" />
        <div>
          <h2 className="text-base font-semibold text-integra-navy">Inicio contable</h2>
          <p className="text-xs text-gray-500">
            Desde esta fecha, cada factura, nota de crédito, cobro, compra, gasto de trámite y pago
            genera su asiento en el libro. Lo anterior ya está en los libros del contador
            (QuickBooks): se ve con la etiqueta «Contabilizado fuera», sigue contando en la
            antigüedad de saldos y en el estado de cuenta, y no genera asiento. Se compara la fecha
            de cada documento.
          </p>
        </div>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="fecha_inicio_contable" className="mb-1 block text-xs font-medium">
              Fecha de inicio contable
            </label>
            <input
              id="fecha_inicio_contable"
              type="date"
              value={valor}
              onChange={(e) => {
                setValor(e.target.value);
                setOk(false);
              }}
              disabled={isPending}
              className="min-h-[44px] rounded-md border border-gray-300 px-3 font-mono text-sm"
            />
          </div>
          <Button
            type="button"
            onClick={guardar}
            disabled={isPending || !valor || valor === fecha}
            className="min-h-[44px] gap-1.5"
          >
            {isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Guardar fecha
          </Button>
        </div>
      ) : (
        <p className="text-sm">
          Inicio contable: <span className="font-mono font-semibold">{fechaCorta(fecha)}</span>
        </p>
      )}

      {canEdit && (
        <p className="text-xs text-gray-500">
          No se puede mover si deja documentos del lado equivocado: hacia adelante, documentos que ya
          tienen asiento; hacia atrás, documentos sin asiento. El mensaje dice cuáles. Cada cambio
          queda en la bitácora contable.
        </p>
      )}

      {error && <p className="whitespace-pre-line text-sm text-red-700">{error}</p>}
      {ok && <p className="text-sm text-emerald-700">Inicio contable guardado.</p>}
    </section>
  );
}
