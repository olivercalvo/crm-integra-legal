"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, History, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CUENTA_TRAMITE_DEFAULT } from "@/lib/finanzas/types/expense-line";

/**
 * LISTA DE GASTOS DE TRÁMITE ENTRE CASOS, con la limpieza de los sin clasificar.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE, Y POR QUÉ ACÁ
 * ═════════════════════════════════════════════════════════════════════════════
 * La migración `036` dejó 128 gastos históricos sin cuenta contable. No es un
 * error: se cargaron cuando el sistema no pedía la cuenta, y ponerles una por
 * defecto habría sido inventar el dato.
 *
 * Pero hasta hoy **no existía ninguna pantalla que listara gastos individuales**
 * —`/legal/gastos` es un balance por caso y los gastos sueltos solo viven dentro
 * del detalle del caso—, así que resolverlos habría significado entrar caso por
 * caso. Eso no es "de a poco": es que no se hace nunca.
 *
 * Va como una VISTA de `/legal/gastos` y no como una pantalla
 * `/gastos/sin-clasificar` aparte, porque una pantalla dedicada a una limpieza es
 * un arreglo temporal que se vuelve deuda permanente: hay que acordarse de
 * borrarla. Una lista de gastos entre casos sirve igual después.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🎨 CÓMO SE PRESENTA LO "SIN CLASIFICAR": UN ESTADO, NO UNA ALARMA
 * ─────────────────────────────────────────────────────────────────────────────
 * · **Chip de filtro, no banner.** Un cartel arriba de todo se lee como que algo
 *   se rompió. Un chip al lado de los otros filtros se lee como un estado.
 * · **Ámbar y reloj, nunca rojo y triángulo.** Rojo dice "esto está mal". Acá no
 *   está mal nada: es trabajo pendiente que hasta hoy era invisible.
 * · **El chip DESAPARECE al llegar a cero.** Un contador en cero para siempre es
 *   ruido, y además es la señal de que la limpieza terminó.
 * · **Cuenta regresiva, no deuda.** Una vez empezada muestra "84 de 128": ver
 *   avance es lo que sostiene una tarea larga.
 * · **La explicación aparece una sola vez**, en gris chico y solo con el filtro
 *   activo. No un cartel permanente.
 */

export interface GastoIndividualRow {
  id: string;
  date: string;
  concept: string;
  amount: number;
  case_id: string;
  case_code: string;
  client_name: string;
  lineas_sin_clasificar: number;
  lineas_total: number;
  linea_sin_clasificar_id: string | null;
}

export interface CuentaOption {
  code: string;
  name: string;
}

interface Props {
  rows: GastoIndividualRow[];
  cuentas: CuentaOption[];
  /** Estado global de la limpieza, para el chip. */
  sinClasificar: number;
  totalLineas: number;
  /** true si el filtro "sin clasificar" está activo. */
  filtroActivo: boolean;
}

function fmtMoney(n: number): string {
  return `B/. ${Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function GastosIndividualesTable({
  rows,
  cuentas,
  sinClasificar,
  totalLineas,
  filtroActivo,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [cuentaMasiva, setCuentaMasiva] = useState(CUENTA_TRAMITE_DEFAULT);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  /** Las filas que se pueden clasificar en lote: una sola línea sin cuenta. */
  const clasificables = useMemo(
    () => rows.filter((r) => r.linea_sin_clasificar_id !== null),
    [rows]
  );

  const nombreCuentaMasiva =
    cuentas.find((c) => c.code === cuentaMasiva)?.name ?? "";

  function alternar(lineaId: string) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(lineaId)) next.delete(lineaId);
      else next.add(lineaId);
      return next;
    });
    setConfirmando(false);
  }

  function alternarTodas() {
    setConfirmando(false);
    setSeleccion((prev) =>
      prev.size === clasificables.length
        ? new Set()
        : new Set(clasificables.map((r) => r.linea_sin_clasificar_id as string))
    );
  }

  /** Clasificación individual: se guarda al elegir, sin botón. */
  async function clasificarUna(lineaId: string, code: string) {
    if (!code) return;
    setError(null);
    setGuardando(lineaId);
    try {
      const res = await fetch(`/api/expenses/lines/${lineaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chart_account_code: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "No se pudo guardar la cuenta");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Error de conexión. Revise su internet e intente de nuevo.");
    } finally {
      setGuardando(null);
    }
  }

  async function aplicarMasiva() {
    setError(null);
    try {
      const res = await fetch("/api/expenses/lines/bulk-classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_ids: Array.from(seleccion),
          chart_account_code: cuentaMasiva,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "No se pudieron clasificar los gastos");
        return;
      }
      setSeleccion(new Set());
      setConfirmando(false);
      startTransition(() => router.refresh());
    } catch {
      setError("Error de conexión. Revise su internet e intente de nuevo.");
    }
  }

  const clasificadas = totalLineas - sinClasificar;

  return (
    <div className="space-y-4">
      {/* ── Chip de estado ───────────────────────────────────────────────
          Solo existe mientras quede algo por clasificar. Al llegar a cero
          desaparece: un contador en cero para siempre es ruido. */}
      {sinClasificar > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={
              filtroActivo
                ? "/legal/gastos?vista=gastos"
                : "/legal/gastos?vista=gastos&filtro=sin-clasificar"
            }
            className={
              "inline-flex min-h-[40px] items-center gap-2 rounded-full border px-4 text-sm font-semibold transition " +
              (filtroActivo
                ? "border-amber-400 bg-amber-100 text-amber-900"
                : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100")
            }
          >
            <History size={15} />
            Sin clasificar · {sinClasificar}
            {clasificadas > 0 && (
              <span className="font-normal text-amber-700">de {totalLineas}</span>
            )}
            {filtroActivo && <X size={14} />}
          </Link>

          {filtroActivo && (
            <span className="text-xs text-gray-500">Tocá el chip para quitar el filtro</span>
          )}
        </div>
      )}

      {/* La explicación aparece UNA vez, con el filtro activo, y en gris chico. */}
      {filtroActivo && (
        <p className="text-sm text-gray-500">
          Estos gastos se cargaron antes de que el sistema pidiera la cuenta contable, así
          que <strong className="font-semibold text-gray-600">nadie los clasificó</strong>.
          No se les asignó una por defecto porque pudieron ser fondos del cliente o costo
          propio del bufete. Se pueden ir resolviendo de a poco: elegí la cuenta en cada
          fila, o marcá varias y asignales la misma de una vez. Los gastos nuevos ya no
          pueden quedar así.
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* ── Acción masiva ─────────────────────────────────────────────── */}
      {seleccion.size > 0 && (
        <div className="rounded-xl border border-integra-navy/25 bg-integra-navy/5 p-4">
          {!confirmando ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[16rem] flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Asignar esta cuenta a los {seleccion.size} seleccionados
                </label>
                <select
                  value={cuentaMasiva}
                  onChange={(e) => setCuentaMasiva(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 bg-white px-2 min-h-[44px] text-sm focus:border-integra-navy focus:outline-none"
                >
                  {cuentas.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={() => setConfirmando(true)}
                className="min-h-[44px] bg-integra-navy hover:bg-integra-navy/90"
              >
                Asignar a {seleccion.size}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setSeleccion(new Set())}
                className="min-h-[44px]"
              >
                Cancelar
              </Button>
            </div>
          ) : (
            /* La confirmación DICE EL NÚMERO Y LA CUENTA. Nada de "¿Confirmar?"
               a secas: lo que se confirma tiene que estar escrito. */
            <div className="space-y-3">
              <p className="text-sm text-integra-navy">
                Se va a asignar{" "}
                <strong className="font-semibold">
                  {cuentaMasiva} {nombreCuentaMasiva}
                </strong>{" "}
                a{" "}
                <strong className="font-semibold">
                  {seleccion.size} {seleccion.size === 1 ? "gasto" : "gastos"} sin
                  clasificar
                </strong>
                .
              </p>
              <p className="text-xs text-gray-500">
                Solo se escriben los que están sin cuenta. Ninguna clasificación ya
                hecha se pisa.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={aplicarMasiva}
                  disabled={isPending}
                  className="min-h-[44px] bg-integra-navy hover:bg-integra-navy/90"
                >
                  {isPending ? (
                    <Loader2 size={16} className="mr-1 animate-spin" />
                  ) : (
                    <Check size={16} className="mr-1" />
                  )}
                  Sí, asignar
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmando(false)}
                  className="min-h-[44px]"
                >
                  Volver
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tabla ─────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <Check size={36} className="mb-3 text-green-400" />
          <p className="font-medium text-gray-600">
            {filtroActivo
              ? "No queda ningún gasto sin clasificar."
              : "No hay gastos de trámite registrados."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left">
                <th className="px-3 py-2 w-10">
                  {clasificables.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todos los sin clasificar"
                      checked={
                        seleccion.size === clasificables.length && clasificables.length > 0
                      }
                      onChange={alternarTodas}
                      className="h-4 w-4"
                    />
                  )}
                </th>
                <th className="px-3 py-2 font-semibold text-gray-600">Fecha</th>
                <th className="px-3 py-2 font-semibold text-gray-600">Caso</th>
                <th className="px-3 py-2 font-semibold text-gray-600">Concepto</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Monto</th>
                <th className="px-3 py-2 font-semibold text-gray-600">Cuenta contable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lineaId = r.linea_sin_clasificar_id;
                const seleccionada = lineaId ? seleccion.has(lineaId) : false;
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50/60">
                    <td className="px-3 py-2.5">
                      {lineaId && (
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${r.concept}`}
                          checked={seleccionada}
                          onChange={() => alternar(lineaId)}
                          className="h-4 w-4"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                      {r.date}
                    </td>
                    <td className="px-3 py-2.5">
                      {/* nav-guard-ok: /legal/gastos es admin y abogada, los dos
                          roles que entran a /legal/casos. El contador no llega
                          a esta pantalla. */}
                      <Link
                        href={`/legal/casos/${r.case_id}`}
                        className="font-mono text-xs text-integra-navy hover:underline"
                      >
                        {r.case_code}
                      </Link>
                      <p className="text-xs text-gray-400">{r.client_name}</p>
                    </td>
                    <td className="px-3 py-2.5 text-gray-900">{r.concept}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">
                      {fmtMoney(r.amount)}
                    </td>
                    <td className="px-3 py-2.5">
                      {lineaId ? (
                        <div className="flex items-center gap-2">
                          <select
                            defaultValue=""
                            disabled={guardando === lineaId}
                            onChange={(e) => clasificarUna(lineaId, e.target.value)}
                            className="block min-w-[13rem] rounded-md border border-amber-300 bg-amber-50 px-2 min-h-[40px] text-xs text-amber-900 focus:border-integra-navy focus:outline-none"
                          >
                            <option value="">Sin clasificar — elegir cuenta</option>
                            {cuentas.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.code} · {c.name}
                              </option>
                            ))}
                          </select>
                          {guardando === lineaId && (
                            <Loader2 size={14} className="animate-spin text-gray-400" />
                          )}
                        </div>
                      ) : r.lineas_sin_clasificar > 1 ? (
                        /* No debería pasar: el backfill hace UNA línea por gasto y
                           desde la 037 ninguna nueva puede nacer en NULL. Se
                           contempla igual — un invariante que la UI asume sin
                           verificar es el que revienta el día que alguien corre un
                           script. */
                        <Link
                          href={`/finanzas/gastos-tramite/${r.id}`}
                          className="text-xs font-semibold text-amber-700 hover:underline"
                        >
                          {r.lineas_sin_clasificar} líneas sin clasificar — abrir
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700">
                          <Check size={13} /> Clasificado
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
