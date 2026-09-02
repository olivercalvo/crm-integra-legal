import { AlertTriangle } from "lucide-react";
import type { MayorDeCuenta } from "@/lib/finanzas/reports/libro-mayor";
import { CuerpoMayor } from "./cuerpo-mayor";

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
 * TRAZABILIDAD NIVEL 2 y 3 — del renglón del mayor al asiento y al documento.
 *
 * NIVEL 3 (02/09/2026): al hacer clic en una fila se despliega el ASIENTO
 * COMPLETO con todas sus líneas. Lo pidió el contador para ver "las fracciones"
 * de dónde sale el monto sin salir de la pantalla. Vive en `fila-expandible.tsx`
 * y no cuesta una consulta: las líneas ya viajaban en la fila.
 *
 * NIVEL 2 — el documento de origen — sigue existiendo, pero pasó a ser una
 * acción SECUNDARIA dentro del bloque desplegado. A dónde lleva cada tipo lo
 * resuelve `loadDestinosDeOrigen()` en la capa de datos:
 *
 *   · factura      → `/finanzas/facturas/{id}`
 *   · nota_credito → `/finanzas/facturas/{id}`      (la NC vive en el detalle)
 *   · gasto        → `/finanzas/gastos-bufete/{id}`
 *   · pago         → la factura que canceló, si fue una sola
 *   · manual, apertura, reversion → sin destino: no tienen documento de origen.
 *
 * Lo que no está en el mapa se muestra sin enlace, nunca como link roto.
 */

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
            <CuerpoMayor
              filas={filas}
              destinos={Object.fromEntries(destinos)}
              rotuloArranque={rotuloArranque}
            />
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
            El <strong>*</strong> indica que ese movimiento tiene{" "}
            <strong>más de una cuenta del lado opuesto</strong>, así que no hay una única
            contrapartida y se muestra como &ldquo;Varios&rdquo;.{" "}
            <strong>El detalle completo se ve al abrir la fila.</strong>
          </span>
        </p>
      )}
    </div>
  );
}
