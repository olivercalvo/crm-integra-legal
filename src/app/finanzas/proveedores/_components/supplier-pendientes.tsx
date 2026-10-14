import Link from "next/link";

/**
 * «Saldo por pagar» en la ficha del proveedor (14/10/2026).
 *
 * Los documentos con saldo de la antigüedad por pagar de hoy: compras, gastos
 * de trámite, NC y partidas del libro (importación de asientos, apertura) con
 * este proveedor como tercero. El total es el de su fila en la antigüedad.
 */

export interface PendienteDeProveedor {
  id: string;
  numero: string;
  /** AAAA-MM-DD: la fecha desde la que cuenta la antigüedad. */
  fecha: string;
  diasVencido: number;
  saldo: number;
  /** Una partida de diario o de apertura, no un documento del módulo. */
  esPartida: boolean;
  href: string | null;
}

function money(n: number): string {
  return n.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

export function SupplierPendientes({ saldo, documentos }: { saldo: number; documentos: PendienteDeProveedor[] }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-gray-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-integra-navy">
          Saldo por pagar ({documentos.length} {documentos.length === 1 ? "documento" : "documentos"})
        </h2>
        <p className="text-xs text-gray-600">
          Total:{" "}
          <span className="font-mono font-semibold text-gray-900">{money(saldo)}</span>
          {" · "}el mismo de la antigüedad por pagar de hoy
        </p>
      </div>
      {documentos.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-500">No se le debe nada a este proveedor.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-semibold">Documento</th>
                <th className="px-3 py-2 font-semibold">Origen</th>
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 text-right font-semibold">Días</th>
                <th className="px-3 py-2 text-right font-semibold">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {documentos.map((d) => (
                <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm">
                    {d.href ? (
                      <Link href={d.href} className="text-integra-navy underline decoration-dotted underline-offset-2 hover:text-integra-gold">
                        {d.numero}
                      </Link>
                    ) : (
                      d.numero
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                    {d.esPartida ? "Asiento del libro" : "Documento"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">{fechaCorta(d.fecha)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-gray-600">
                    {d.diasVencido > 0 ? d.diasVencido : "al día"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm tabular-nums text-gray-800">{money(d.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
