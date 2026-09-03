"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Lock, LockOpen, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  agruparPorAnio,
  codigoPeriodo,
  estadoDe,
  etiquetaPeriodo,
  type PeriodoRow,
} from "@/lib/finanzas/contabilidad/periodos";

/**
 * CIERRE Y REAPERTURA DE PERÍODOS CONTABLES.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * CERRAR Y REABRIR NO SON LA MISMA ACCIÓN CON EL SIGNO CAMBIADO
 * ═════════════════════════════════════════════════════════════════════════════
 * Cerrar es rutina: el contador termina el mes y lo cierra. Reabrir deshace algo
 * que **ya se certificó ante la DGI** y vuelve a admitir asientos en un ejercicio
 * que estaba congelado.
 *
 * Por eso las dos confirmaciones son distintas y no comparten componente:
 *
 *   · **Cerrar** — confirmación sobria, dice cuántos asientos quedan dentro y que
 *     desde ese momento no entran más.
 *   · **Reabrir** — confirmación en ámbar, dice EXPLÍCITAMENTE que el período ya
 *     fue cerrado, quién lo cerró y cuándo, y que reabrirlo permite registrar
 *     asientos en un ejercicio ya certificado.
 *
 * Un diálogo genérico de "¿Confirmar?" haría que las dos se lean igual, que es
 * justamente lo que hay que evitar: la peligrosa es la segunda.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRES ESTADOS, NO DOS
 * ─────────────────────────────────────────────────────────────────────────────
 * "Reabierto" se muestra distinto de "abierto" aunque en la base los dos sean
 * `status = 'abierto'`. Un período reabierto conserva su `closed_at`, y ese dato
 * es el que dice que alguien lo dio por cerrado y después lo deshizo. Mostrarlos
 * iguales escondería el hecho que hay que ver.
 */

interface Props {
  periodos: PeriodoRow[];
}

type Pendiente = { year: number; month: number; accion: "cerrar" | "reabrir" } | null;

function fmtFecha(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export function PeriodosManager({ periodos }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendiente, setPendiente] = useState<Pendiente>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const anios = useMemo(() => agruparPorAnio(periodos), [periodos]);

  const periodoPendiente = useMemo(
    () =>
      pendiente
        ? periodos.find((p) => p.year === pendiente.year && p.month === pendiente.month) ?? null
        : null,
    [pendiente, periodos]
  );

  async function aplicar() {
    if (!pendiente) return;
    setError(null);
    setAviso(null);
    setEnviando(true);
    try {
      const res = await fetch("/api/finanzas/periodos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendiente),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "No se pudo cambiar el período");
        return;
      }
      // El servidor contesta `sinCambios` cuando la acción no cambiaba nada —un
      // doble clic, o dos personas a la vez—. No es un error, pero tampoco hay
      // que decir que se hizo algo.
      if (data?.sinCambios) setAviso(data.mensaje);
      setPendiente(null);
      startTransition(() => router.refresh());
    } catch {
      setError("Error de conexión. Revise su internet e intente de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {aviso && (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          {aviso}
        </p>
      )}

      {/* ── Confirmación de CERRAR ─────────────────────────────────────── */}
      {pendiente?.accion === "cerrar" && periodoPendiente && (
        <div className="space-y-3 rounded-xl border border-integra-navy/25 bg-integra-navy/5 p-4">
          <div className="flex items-center gap-2 text-integra-navy">
            <Lock size={18} />
            <p className="text-sm font-semibold">
              Cerrar {etiquetaPeriodo(pendiente.year, pendiente.month)}
            </p>
          </div>
          <p className="text-sm text-gray-700">
            El período queda con{" "}
            <strong className="font-semibold">
              {periodoPendiente.asientos}{" "}
              {periodoPendiente.asientos === 1 ? "asiento" : "asientos"}
            </strong>
            . Desde el cierre, el sistema{" "}
            <strong className="font-semibold">rechaza cualquier asiento nuevo</strong> con
            fecha de ese mes.
          </p>
          <p className="text-xs text-gray-500">Se puede volver a abrir si hace falta.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={aplicar}
              disabled={enviando || isPending}
              className="min-h-[44px] bg-integra-navy hover:bg-integra-navy/90"
            >
              {enviando || isPending ? (
                <Loader2 size={16} className="mr-1.5 animate-spin" />
              ) : (
                <Lock size={16} className="mr-1.5" />
              )}
              Sí, cerrar el período
            </Button>
            <Button variant="ghost" onClick={() => setPendiente(null)} className="min-h-[44px]">
              Volver
            </Button>
          </div>
        </div>
      )}

      {/* ── Confirmación de REABRIR — deliberadamente distinta ─────────── */}
      {pendiente?.accion === "reabrir" && periodoPendiente && (
        <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-900">
            <AlertTriangle size={18} />
            <p className="text-sm font-semibold">
              Reabrir {etiquetaPeriodo(pendiente.year, pendiente.month)}
            </p>
          </div>

          <p className="text-sm text-amber-900">
            Este período{" "}
            <strong className="font-semibold">ya fue cerrado</strong>
            {periodoPendiente.closed_by_name ? ` por ${periodoPendiente.closed_by_name}` : ""}
            {periodoPendiente.closed_at ? ` el ${fmtFecha(periodoPendiente.closed_at)}` : ""}.
          </p>

          <p className="text-sm text-amber-900">
            Reabrirlo <strong className="font-semibold">permite registrar asientos en un
            ejercicio ya certificado</strong>. Los estados financieros de ese mes —que el
            contador pudo haber presentado ante la DGI— dejarían de reproducirse igual que
            cuando se emitieron.
          </p>

          <p className="text-xs text-amber-800">
            Queda registrado quién lo reabre y cuándo. El período seguirá marcado como
            reabierto aunque se vuelva a cerrar.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={aplicar}
              disabled={enviando || isPending}
              className="min-h-[44px] bg-amber-700 text-white hover:bg-amber-800"
            >
              {enviando || isPending ? (
                <Loader2 size={16} className="mr-1.5 animate-spin" />
              ) : (
                <LockOpen size={16} className="mr-1.5" />
              )}
              Entiendo, reabrir de todos modos
            </Button>
            <Button variant="ghost" onClick={() => setPendiente(null)} className="min-h-[44px]">
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* ── Los períodos, por año ──────────────────────────────────────── */}
      {anios.map((a) => (
        <div key={a.year} className="rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-3">
            <h2 className="font-serif text-lg text-integra-navy">{a.year}</h2>
            <span className="text-xs text-gray-500">
              {a.abiertos} {a.abiertos === 1 ? "mes abierto" : "meses abiertos"} ·{" "}
              {a.cerrados} {a.cerrados === 1 ? "cerrado" : "cerrados"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-4 py-2 font-semibold text-gray-600">Período</th>
                  <th className="px-4 py-2 font-semibold text-gray-600">Estado</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">Asientos</th>
                  <th className="px-4 py-2 font-semibold text-gray-600">Último cierre</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {a.periodos.map((p) => {
                  const estado = estadoDe(p);
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="text-gray-900">
                          {etiquetaPeriodo(p.year, p.month)}
                        </span>
                        <span className="ml-2 font-mono text-xs text-gray-400">
                          {codigoPeriodo(p.year, p.month)}
                        </span>
                      </td>

                      <td className="px-4 py-2.5">
                        {estado === "cerrado" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                            <Lock size={12} /> Cerrado
                          </span>
                        )}
                        {estado === "abierto" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                            <LockOpen size={12} /> Abierto
                          </span>
                        )}
                        {/* El tercer estado. Se muestra distinto de "abierto" a
                            propósito: dice que alguien lo dio por cerrado y
                            después lo deshizo. */}
                        {estado === "reabierto" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                            <RotateCcw size={12} /> Reabierto
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                        {p.asientos === 0 ? (
                          <span className="text-gray-300">0</span>
                        ) : (
                          p.asientos
                        )}
                      </td>

                      <td className="px-4 py-2.5 text-xs text-gray-500">
                        {p.closed_at ? (
                          <>
                            {fmtFecha(p.closed_at)}
                            {p.closed_by_name && (
                              <span className="ml-1 text-gray-400">· {p.closed_by_name}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-300">Nunca se cerró</span>
                        )}
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        {p.status === "abierto" ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPendiente({ year: p.year, month: p.month, accion: "cerrar" })
                            }
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:border-integra-navy hover:text-integra-navy"
                          >
                            <Lock size={13} /> Cerrar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setPendiente({ year: p.year, month: p.month, accion: "reabrir" })
                            }
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-amber-200 px-3 text-xs font-semibold text-amber-800 hover:border-amber-400 hover:bg-amber-50"
                          >
                            <LockOpen size={13} /> Reabrir
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
