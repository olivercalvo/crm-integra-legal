"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, FileText, AlertTriangle } from "lucide-react";

import type { FilaMayor } from "@/lib/finanzas/reports/libro-mayor";

/**
 * Una fila de movimiento del Libro Mayor, que se abre para mostrar el ASIENTO
 * COMPLETO al que pertenece.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ PIDIÓ EL CONTADOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Ver "las fracciones" de dónde sale el monto **sin salir de la pantalla**. El
 * ícono que lleva al documento de origen sigue existiendo, pero pasó a ser una
 * acción secundaria DENTRO del bloque desplegado: la acción principal de la fila
 * ahora es abrirla.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALEN LAS LÍNEAS: DE NINGUNA CONSULTA NUEVA
 * ─────────────────────────────────────────────────────────────────────────────
 * `fila.lineas` ya viene armada desde el servidor. `loadMovimientosDeCuenta`
 * traía todas las líneas de cada asiento —para resolver la contrapartida— y las
 * descartaba; ahora se propagan. Consecuencias, las dos buenas:
 *
 *   · No hay carga bajo demanda, ni endpoint, ni estado de "cargando", ni N+1.
 *   · Lo que se despliega es EXACTAMENTE lo que produjo la contrapartida que la
 *     fila ya muestra en su columna. No pueden contradecirse.
 *
 * ⚠️ `lineas` INCLUYE la línea propia del movimiento. Está verificado en el
 * query (no tiene filtro de exclusión) y en el builder (busca la propia dentro
 * de `hermanas`). Por eso el pie suma las líneas tal cual y tiene que dar cero;
 * si se excluyera la propia, TODOS los asientos mostrarían un descuadre falso.
 */

function money(n: number): string {
  return n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Monto({ value, bold }: { value: number; bold?: boolean }) {
  const tone = value < 0 ? "text-red-600" : value === 0 ? "text-gray-400" : "text-gray-800";
  return (
    <span className={`font-mono text-sm tabular-nums ${tone} ${bold ? "font-bold" : ""}`}>
      {money(value)}
    </span>
  );
}

/** Celda de un importe del asiento: el cero se muestra apagado, no en 0.00. */
function ImporteAsiento({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return <span className="text-gray-300">—</span>;
  return <span className="font-mono text-sm tabular-nums text-gray-800">{money(value)}</span>;
}

const COLUMNAS_DEL_MAYOR = 9;

export function FilaExpandible({
  fila,
  destino,
  abierta,
  onToggle,
}: {
  fila: FilaMayor;
  /** Ruta del documento de origen, o null si el asiento no tiene documento. */
  destino: string | null;
  abierta: boolean;
  onToggle: () => void;
}) {
  const totalDebitos = fila.lineas.reduce((s, l) => s + l.debit, 0);
  const totalCreditos = fila.lineas.reduce((s, l) => s + l.credit, 0);
  const diferencia = Math.round((totalDebitos - totalCreditos) * 100) / 100;
  const cuadra = Math.abs(diferencia) < 0.005;

  return (
    <>
      <tr
        className={
          "cursor-pointer border-b border-gray-100 transition-colors " +
          (abierta ? "bg-integra-navy/5" : "hover:bg-gray-50")
        }
        onClick={onToggle}
        aria-expanded={abierta}
        title={abierta ? "Cerrar el asiento" : "Ver el asiento completo"}
      >
        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">
          <span className="inline-flex items-center gap-1">
            {abierta ? (
              <ChevronDown size={14} className="shrink-0 text-integra-navy" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-gray-400" />
            )}
            {fila.cuentaDistribucion}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">
          {fila.fecha}
        </td>
        <td className="px-3 py-2 text-sm text-gray-700">{fila.tipoTransaccion}</td>
        <td className="px-3 py-2 font-mono text-xs text-gray-500">{fila.numero}</td>
        <td className="px-3 py-2 text-sm text-gray-700">{fila.nombre || "—"}</td>
        <td className="px-3 py-2 text-sm text-gray-600">{fila.descripcion}</td>
        <td className="px-3 py-2 text-sm text-gray-600">
          {fila.contrapartida}
          {fila.contrapartidaAmbigua && (
            <span
              className="ml-1 cursor-help text-amber-600"
              title="El asiento tiene más de una cuenta del lado opuesto. Cómo se muestra este caso está pendiente de confirmación del contador."
            >
              *
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <Monto value={fila.importe} />
        </td>
        <td className="px-3 py-2 text-right">
          <Monto value={fila.saldo} />
        </td>
      </tr>

      {abierta && (
        <tr className="border-b border-gray-200 bg-gray-50/70">
          <td colSpan={COLUMNAS_DEL_MAYOR} className="px-3 py-3">
            <div className="rounded-lg border border-gray-200 bg-white">
              {/* ---------- Encabezado del asiento ---------- */}
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-integra-navy/5 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-integra-navy">
                    Asiento {fila.numero}
                    <span className="ml-2 font-normal text-gray-500">{fila.fecha}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-gray-600">{fila.descripcion}</p>
                </div>

                {/* La acción secundaria: el documento que originó el asiento. */}
                {destino && (
                  <Link
                    href={destino}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-integra-navy/30 px-3 text-xs font-medium text-integra-navy hover:bg-integra-navy hover:text-white"
                    title="Abrir el documento que originó este movimiento"
                  >
                    <FileText size={13} />
                    Abrir el documento
                  </Link>
                )}
              </div>

              {/* ---------- Las líneas ---------- */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="px-3 py-1.5 font-semibold">Código</th>
                      <th className="px-3 py-1.5 font-semibold">Nombre de cuenta</th>
                      <th className="px-3 py-1.5 font-semibold">Descripción</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Débito</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Crédito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fila.lineas.map((l) => {
                      // Por POSICIÓN, no por cuenta: un asiento puede tocar la
                      // misma cuenta dos veces y son dos renglones distintos del
                      // mayor. Comparar por código resaltaría los dos.
                      const esLaPropia = l.line_order === fila.lineOrderPropia;
                      return (
                        <tr
                          key={l.line_order}
                          className={
                            "border-b border-gray-100 last:border-0 " +
                            (esLaPropia ? "bg-integra-gold/15" : "")
                          }
                        >
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-600">
                            {esLaPropia && (
                              <span
                                className="mr-1 font-sans font-bold text-integra-gold"
                                title="Es la línea que estás mirando en el mayor"
                              >
                                ▸
                              </span>
                            )}
                            {l.code}
                          </td>
                          <td
                            className={
                              "px-3 py-1.5 text-sm " +
                              (esLaPropia ? "font-semibold text-integra-navy" : "text-gray-700")
                            }
                          >
                            {l.name}
                          </td>
                          <td className="px-3 py-1.5 text-sm text-gray-600">
                            {l.descripcion?.trim() || <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <ImporteAsiento value={l.debit} />
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <ImporteAsiento value={l.credit} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className={"border-t-2 " + (cuadra ? "border-gray-200" : "border-red-300 bg-red-50")}>
                      <td colSpan={3} className="px-3 py-2 text-right text-xs text-gray-600">
                        {cuadra ? (
                          "Totales del asiento"
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                            <AlertTriangle size={13} />
                            El asiento NO cuadra · diferencia {money(diferencia)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={
                            "font-mono text-sm font-bold tabular-nums " +
                            (cuadra ? "text-gray-800" : "text-red-700")
                          }
                        >
                          {money(totalDebitos)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={
                            "font-mono text-sm font-bold tabular-nums " +
                            (cuadra ? "text-gray-800" : "text-red-700")
                          }
                        >
                          {money(totalCreditos)}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
