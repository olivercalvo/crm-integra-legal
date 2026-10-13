"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookCheck, Eye, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtImporte } from "@/lib/utils/importe";
import type { LineaDeCierre } from "@/lib/finanzas/contabilidad/cierre-anual";

export interface EjercicioParaCerrar {
  anio: number;
  vigente: { entry_id: string; entry_number: number; reference: string | null } | null;
}

interface Vista {
  anio: number;
  ok: boolean;
  mensaje?: string;
  lineas: LineaDeCierre[];
  utilidad: number;
}

/**
 * CIERRE DEL EJERCICIO (E11, migración `080`).
 *
 * Primero la VISTA PREVIA (las líneas que va a llevar el asiento, armadas con
 * `construirAsientoDeCierre`, la misma función que usa el servidor) y recién
 * después la confirmación. El servidor vuelve a armar las líneas con los saldos
 * del momento y la base las verifica: si algo se registró en el medio, rechaza.
 *
 * Un ejercicio cerrado muestra su asiento; para deshacerlo se reversa desde el
 * detalle del asiento (la 080 lo permite), y el año se puede volver a cerrar.
 */
export function CierreDelEjercicio({ ejercicios }: { ejercicios: EjercicioParaCerrar[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  // Cerrar el año sólo se deshace con una reversión: se confirma ESCRIBIENDO el
  // año, no con un clic al lado de «Cancelar» (recorrido del 03/10/2026).
  const [anioEscrito, setAnioEscrito] = useState("");

  function verVistaPrevia(anio: number) {
    setError(null);
    setHecho(null);
    setVista(null);
    setAnioEscrito("");
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/periodos/cierre-anual?anio=${anio}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo armar la vista previa.");
          return;
        }
        const a = data.armado ?? {};
        setVista({
          anio,
          ok: Boolean(a.ok),
          mensaje: a.mensaje,
          lineas: a.lineas ?? [],
          utilidad: Number(a.utilidad ?? 0),
        });
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  function confirmar(anio: number) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/periodos/cierre-anual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anio }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo cerrar el ejercicio.");
          return;
        }
        setVista(null);
        setHecho(`Ejercicio ${anio} cerrado con el asiento ${data.entry_number}${data.reference ? ` (${data.reference})` : ""}.`);
        router.refresh();
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  const totalDebe = vista ? vista.lineas.reduce((s, l) => s + l.debit, 0) : 0;
  const totalHaber = vista ? vista.lineas.reduce((s, l) => s + l.credit, 0) : 0;

  return (
    <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-start gap-2">
        <BookCheck size={18} className="mt-0.5 text-integra-gold" />
        <div>
          <h2 className="text-base font-semibold text-integra-navy">Cierre del ejercicio</h2>
          <p className="text-xs text-gray-500">
            Un asiento al 31 de diciembre que lleva a cero las cuentas de ingreso, costo y gasto
            contra 300002 (resultados acumulados). Los ejercicios se cierran en orden y diciembre
            tiene que estar abierto. El Estado de Resultado sigue mostrando el año cerrado.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {ejercicios.map((e) => (
          <li key={e.anio} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
            <span className="text-sm font-semibold text-integra-navy">Ejercicio {e.anio}</span>
            {e.vigente ? (
              <span className="flex items-center gap-1.5 text-sm text-emerald-800">
                <Lock size={14} />
                Cerrado con el{" "}
                {/* nav-guard-ok: esta pantalla ya es admin+contador, los mismos de /finanzas/asientos. */}
                <Link href={`/finanzas/asientos/${e.vigente.entry_id}`} className="font-mono underline">
                  asiento {e.vigente.entry_number}
                  {e.vigente.reference ? ` (${e.vigente.reference})` : ""}
                </Link>
              </span>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => verVistaPrevia(e.anio)}
                className="min-h-[44px] gap-1.5"
              >
                {isPending && vista === null ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
                Cerrar el ejercicio {e.anio}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {vista && (
        <div className="space-y-3 rounded-md border border-integra-gold/40 bg-gray-50 p-4">
          <h3 className="text-sm font-semibold text-integra-navy">Vista previa: cierre del ejercicio {vista.anio}</h3>
          {!vista.ok ? (
            <p className="text-sm text-amber-800">{vista.mensaje}</p>
          ) : (
            <>
              <p className="text-sm">
                {vista.utilidad >= 0 ? "Utilidad" : "Pérdida"} del ejercicio:{" "}
                <span className="font-mono font-semibold">B/. {fmtImporte(Math.abs(vista.utilidad))}</span>, que pasa a
                300002.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-1.5 pr-3">Cuenta</th>
                      <th className="py-1.5 pr-3 text-right">Debe</th>
                      <th className="py-1.5 text-right">Haber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vista.lineas.map((l, i) => (
                      <tr key={`${l.account_code}-${i}`} className="border-b last:border-0">
                        <td className="py-1.5 pr-3">
                          <span className="font-mono text-xs text-gray-500">{l.account_code}</span> {l.account_name}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono">{l.debit ? fmtImporte(l.debit) : ""}</td>
                        <td className="py-1.5 text-right font-mono">{l.credit ? fmtImporte(l.credit) : ""}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="py-1.5 pr-3">Totales</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{fmtImporte(totalDebe)}</td>
                      <td className="py-1.5 text-right font-mono">{fmtImporte(totalHaber)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 border-t pt-3">
                <label htmlFor="confirmar-anio" className="block text-sm text-gray-700">
                  Cerrar el ejercicio postea un asiento que sólo se deshace con una reversión. Para confirmar,
                  escribe el año <span className="font-mono font-semibold">{vista.anio}</span>:
                </label>
                <Input
                  id="confirmar-anio"
                  inputMode="numeric"
                  autoComplete="off"
                  value={anioEscrito}
                  onChange={(e) => setAnioEscrito(e.target.value)}
                  disabled={isPending}
                  className="max-w-[10rem] font-mono"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setVista(null)}
                    disabled={isPending}
                    className="min-h-[44px]"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    onClick={() => confirmar(vista.anio)}
                    disabled={isPending || anioEscrito.trim() !== String(vista.anio)}
                    className="min-h-[44px] gap-1.5"
                  >
                    {isPending ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                    Sí, cerrar el ejercicio {vista.anio}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {hecho && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{hecho}</p>}
    </section>
  );
}
