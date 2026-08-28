import Link from "next/link";
import { AlertTriangle, FileText } from "lucide-react";
import type { FilaMayor, MayorDeCuenta } from "@/lib/finanzas/reports/libro-mayor";

/**
 * Tabla del Libro Mayor, con las columnas del modelo de Josuar y en su orden.
 *
 * Los montos van en convención de BALANZA con signo, igual que el Balance
 * General — ver `importeDeLinea()` para por qué, y cuál es la consulta abierta.
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

/**
 * TRAZABILIDAD NIVEL 2 — del renglón del mayor al documento que lo originó.
 *
 * A dónde lleva cada tipo, y si el documento existe, lo resuelve
 * `loadDestinosDeOrigen()` en la capa de datos: el destino de un pago depende de
 * a qué factura se aplicó, y eso es una consulta. Acá solo se busca en el mapa.
 *
 *   · factura      → `/finanzas/facturas/{id}`
 *   · nota_credito → `/finanzas/facturas/{id}`      (la NC vive en el detalle)
 *   · gasto        → `/finanzas/gastos-bufete/{id}`
 *   · pago         → la factura que canceló, si fue una sola
 *   · manual, apertura, reversion → sin destino: no tienen documento de origen.
 *
 * Lo que no está en el mapa se muestra sin enlace, nunca como link roto.
 */
function destinoDelOrigen(fila: FilaMayor, destinos: Map<string, string>): string | null {
  if (!fila.sourceId) return null;
  return destinos.get(fila.sourceId) ?? null;
}

function Fila({ fila, destinos }: { fila: FilaMayor; destinos: Map<string, string> }) {
  if (fila.kind === "saldo-inicial") {
    return (
      <tr className="border-b border-gray-200 bg-integra-navy/5">
        <td className="px-3 py-2 font-mono text-xs text-gray-500">
          {fila.fecha ?? "—"}
        </td>
        <td className="px-3 py-2 text-sm" colSpan={5}>
          <span className="font-semibold text-integra-navy">Saldo inicial</span>
        </td>
        <td className="px-3 py-2 text-right text-gray-400">—</td>
        <td className="px-3 py-2 text-right">
          <Monto value={fila.saldo} bold />
        </td>
      </tr>
    );
  }

  const destino = destinoDelOrigen(fila, destinos);

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">
        {fila.fecha}
      </td>
      <td className="px-3 py-2 text-sm text-gray-700">{fila.tipoTransaccion}</td>
      <td className="px-3 py-2 font-mono text-xs text-gray-500">
        {destino ? (
          <Link
            href={destino}
            className="inline-flex items-center gap-1 text-integra-navy underline decoration-dotted underline-offset-2 hover:text-integra-gold"
            title="Abrir el documento que originó este movimiento"
          >
            <FileText size={12} />
            {fila.numero}
          </Link>
        ) : (
          fila.numero
        )}
      </td>
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
  );
}

export function LibroMayorTable({
  mayor,
  destinos,
}: {
  mayor: MayorDeCuenta;
  /** source_id → ruta del documento. Lo que no está acá no se enlaza. */
  destinos: Map<string, string>;
}) {
  const { cuenta, filas, totales, cantidadMovimientos } = mayor;
  const hayAmbiguas = filas.some((f) => f.contrapartidaAmbigua);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-white">
        <div className="border-b bg-integra-navy/5 px-4 py-3">
          <p className="font-mono text-sm font-bold text-integra-navy">
            {cuenta.code} · {cuenta.name}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {cantidadMovimientos} movimiento(s) en el período
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Tipo de transacción</th>
                <th className="px-3 py-2 font-semibold">Número</th>
                <th className="px-3 py-2 font-semibold">Nombre</th>
                <th className="px-3 py-2 font-semibold">Descripción</th>
                <th className="px-3 py-2 font-semibold">Contrapartida</th>
                <th className="px-3 py-2 text-right font-semibold">Importe</th>
                <th className="px-3 py-2 text-right font-semibold">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <Fila key={`${f.kind}-${i}`} fila={f} destinos={destinos} />
              ))}
            </tbody>
            <tfoot>
              {/*
                PENDIENTE — consulta 4. En el modelo de Josuar el recuadro del
                pie es el NETO de movimientos, no el saldo final. Como el
                requisito decía solo "cierra con su total", se muestran los dos
                rotulados: es más información, no menos.
              */}
              <tr className="border-t-2 border-integra-navy/20 bg-gray-50/60">
                <td colSpan={6} className="px-3 py-2 text-right text-sm text-gray-600">
                  Débitos {money(totales.totalDebitos)} · Créditos{" "}
                  {money(totales.totalCreditos)}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="block text-[10px] uppercase tracking-wide text-gray-500">
                    Neto del período
                  </span>
                  <Monto value={totales.netoDelPeriodo} bold />
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="block text-[10px] uppercase tracking-wide text-gray-500">
                    Saldo final
                  </span>
                  <Monto value={totales.saldoFinal} bold />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {hayAmbiguas && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Las contrapartidas marcadas con <strong>*</strong> corresponden a asientos con más
            de una cuenta del lado opuesto. Se muestran como &ldquo;Varios&rdquo;;{" "}
            <strong>qué mostrar en ese caso está pendiente de confirmación del contador</strong>.
          </span>
        </p>
      )}
    </div>
  );
}
