"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, KeyRound, Loader2, Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { validarCufe } from "@/lib/finanzas/validators/cufe";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  /** admin y abogada. El contador no: el dato sale del portal, no del libro. */
  puedeCargar: boolean;
}

/**
 * «Esta factura no tiene CUFE» — el aviso y, si corresponde, cómo arreglarlo.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * DOS CASOS QUE SE VEN IGUAL EN LA BASE Y NO SON LO MISMO
 * ═════════════════════════════════════════════════════════════════════════════
 * · **Caso B** — la factura se emitió A MANO en el portal de ideati (las
 *   anteriores al 8 de julio de 2026, punto `050`). **El CUFE existe ante la
 *   DGI**: el CRM nunca lo guardó. Se copia del portal y se pega acá.
 * · **Caso C** — la factura nunca pasó por la DGI. No hay CUFE en ningún lado y
 *   **no hay nada que cargar**.
 *
 * El sistema no puede distinguirlos solo, y adivinar sería peor que preguntar.
 * Así que la tarjeta dice las dos cosas y deja que decida quien sabe.
 *
 * 🔴 Sin CUFE **no se puede emitir la nota de crédito electrónica**, porque el
 * documento que va a la DGI tiene que decir qué factura corrige. Referenciarla
 * por número de factura en papel no es una alternativa: el PAC responde con una
 * excepción suya (ver `map-referencia-fiscal.ts`).
 *
 * ⚠️ Cargar el CUFE **no marca la factura como emitida por el sistema**. Queda
 * `fe_estado = 'no_emitida'` con `dgi_cufe_origen = 'portal_050'`, que es la
 * verdad: este sistema no la emitió.
 */
export function CufeDelPortalCard({ invoiceId, invoiceNumber, puedeCargar }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState("");
  const [isPending, startTransition] = useTransition();
  const [errorServidor, setErrorServidor] = useState<string | null>(null);

  // 🔴 La MISMA función que usa el servidor. Acá sirve para avisar mientras se
  //    escribe; el que decide sigue siendo el servidor, que la vuelve a correr.
  const revisado = valor.trim().length > 0 ? validarCufe(valor) : null;
  const puedeGuardar = revisado?.ok === true && !isPending;

  function guardar() {
    if (!puedeGuardar) return;
    setErrorServidor(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/invoices/${invoiceId}/cufe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cufe: valor }),
        });
        const json = (await res.json()) as {
          error?: string;
          fieldErrors?: { cufe?: string };
        };
        if (!res.ok) {
          setErrorServidor(json.fieldErrors?.cufe ?? json.error ?? "No se pudo guardar el CUFE.");
          return;
        }
        setAbierto(false);
        setValor("");
        router.refresh();
      } catch {
        setErrorServidor("No se pudo guardar el CUFE. Intente de nuevo.");
      }
    });
  }

  return (
    <div
      role="note"
      className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          {/* El texto que pidió el bufete, palabra por palabra. */}
          <p className="font-semibold">
            Esta factura no tiene CUFE. Consulta con administración antes de hacer la nota de
            crédito.
          </p>
          <p className="mt-1">
            Sin el CUFE no se puede enviar una nota de crédito a la DGI, porque el documento tiene
            que decir qué factura corrige.
          </p>

          {puedeCargar && !abierto && (
            <>
              <p className="mt-2">
                Si la factura <strong>{invoiceNumber}</strong> se emitió en el portal de ideati, su
                CUFE existe: se copia de ahí y se pega acá.
              </p>
              <button
                type="button"
                onClick={() => setAbierto(true)}
                className="mt-3 inline-flex min-h-[48px] items-center gap-2 rounded-md border border-amber-600 bg-white px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                <KeyRound size={16} />
                Cargar el CUFE del portal
              </button>
            </>
          )}

          {puedeCargar && abierto && (
            <div className="mt-3 space-y-2 rounded-md border border-amber-300 bg-white p-3">
              <Label htmlFor="cufe-portal" className="text-gray-800">
                CUFE de la factura, copiado del portal
              </Label>
              <textarea
                id="cufe-portal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder="FE01…"
                className="w-full rounded-md border border-gray-300 p-2 font-mono text-xs text-gray-900 focus:border-integra-navy focus:outline-none"
              />
              <p className="text-xs text-gray-500">
                Se puede pegar tal como aparece en el portal, aunque venga cortado en varias
                líneas: los espacios se limpian solos.
              </p>

              {/* El validador dice qué está mal Y qué pudo haber pasado. */}
              {revisado && !revisado.ok && (
                <p className="rounded bg-red-50 p-2 text-xs text-red-800">{revisado.mensaje}</p>
              )}
              {/* Avisos que NO bloquean: mismo criterio que `avisosDeRuc()`. */}
              {revisado?.ok &&
                revisado.avisos.map((a) => (
                  <p key={a} className="flex items-start gap-1.5 rounded bg-blue-50 p-2 text-xs text-blue-900">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    <span>{a}</span>
                  </p>
                ))}
              {errorServidor && (
                <p className="rounded bg-red-50 p-2 text-xs text-red-800">{errorServidor}</p>
              )}

              <p className="text-xs text-gray-500">
                Nadie puede verificar acá que el CUFE exista ante la DGI: si está mal, se va a ver
                como un rechazo al enviar la nota de crédito.
              </p>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={guardar}
                  disabled={!puedeGuardar}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-md bg-integra-navy px-4 py-2 text-sm font-medium text-white hover:bg-integra-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                  {isPending ? "Guardando…" : "Guardar el CUFE"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAbierto(false);
                    setValor("");
                    setErrorServidor(null);
                  }}
                  disabled={isPending}
                  className="inline-flex min-h-[48px] items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
