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

function Fila({
  fila,
  destinos,
  rotuloArranque,
}: {
  fila: FilaMayor;
  destinos: Map<string, string>;
  /** "Saldo inicial", o "Saldo al DD/MM/AAAA" si el filtro lo ajustó. */
  rotuloArranque: string;
}) {
  if (fila.kind === "saldo-inicial") {
    return (
      <tr className="border-b border-gray-200 bg-integra-navy/5">
        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">
          {fila.cuentaDistribucion}
        </td>
        <td className="px-3 py-2 font-mono text-xs text-gray-500">
          {fila.fecha ?? "—"}
        </td>
        <td className="px-3 py-2 text-sm" colSpan={5}>
          <span className="font-semibold text-integra-navy">{rotuloArranque}</span>
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
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">
        {fila.cuentaDistribucion}
      </td>
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

  // Con filtro de fechas, la primera fila NO es el saldo de apertura: es el
  // saldo al día en que arranca el rango. Decirle "Saldo inicial" a las dos
  // cosas es lo que haría dudar del reporte entero.
  const rotuloArranque = cuenta.arranque_ajustado
    ? `Saldo al ${cuenta.arranque_fecha ?? ""}`.trim()
    : "Saldo inicial";

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
          <table className="w-full min-w-[1120px]">
            <thead>
              {/* Orden y nombres EXACTOS del modelo que mandó Josuarth el
                  26/08/2026 (`Temas Contables/image001.png`). No reordenar sin
                  mirar esa captura: la revisa contra su propio reporte. */}
              <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-semibold">Cuenta de distribución</th>
                <th className="px-3 py-2 font-semibold">Fecha de la transacción</th>
                <th className="px-3 py-2 font-semibold">Tipo de transacción</th>
                <th className="px-3 py-2 font-semibold">Número</th>
                <th className="px-3 py-2 font-semibold">Nombre</th>
                <th className="px-3 py-2 font-semibold">Descripción</th>
                <th className="px-3 py-2 font-semibold">Cuenta de contrapartida</th>
                <th className="px-3 py-2 text-right font-semibold">Importe</th>
                <th className="px-3 py-2 text-right font-semibold">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <Fila
                  key={`${f.kind}-${i}`}
                  fila={f}
                  destinos={destinos}
                  rotuloArranque={rotuloArranque}
                />
              ))}
            </tbody>
            <tfoot>
              {/*
                El recuadro del pie es el NETO de movimientos del período, no el
                saldo final — así lo tiene el modelo de Josuarth, y se verifica
                con su propio ejemplo: Banco Pichincha abre en 14,381.27, cierra
                en 21,121.28 y el pie dice 6,740.01, que es la suma de los
                movimientos.

                El saldo final NO se repite acá: se lee en la última fila de la
                columna Saldo, que es donde él lo lee.
              */}
              <tr className="border-t-2 border-integra-navy/20 bg-gray-50/60">
                <td colSpan={7} className="px-3 py-2 text-right text-sm text-gray-600">
                  Débitos {money(totales.totalDebitos)} · Créditos{" "}
                  {money(totales.totalCreditos)}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="inline-block rounded border-2 border-integra-navy/40 px-2 py-1">
                    <Monto value={totales.netoDelPeriodo} bold />
                  </span>
                </td>
                <td className="px-3 py-2" />
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
