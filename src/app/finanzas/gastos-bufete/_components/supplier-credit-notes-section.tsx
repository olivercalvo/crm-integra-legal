import Link from "next/link";
import { FileMinus, Plus } from "lucide-react";
import { fmtImporte } from "@/lib/utils/importe";
import { formatDate } from "@/lib/utils/format-date";

export interface NcDeCompraFila {
  id: string;
  credit_note_number: string;
  supplier_document_number: string;
  issue_date: string;
  status: string;
  grand_total: number;
}

interface Props {
  compraId: string;
  notas: NcDeCompraFila[];
  /** `balance_due`: lo que falta pagar. Sin saldo no se ofrece registrar otra. */
  saldo: number;
  canMutate: boolean;
}

/**
 * Notas de crédito del PROVEEDOR sobre esta compra (3.5, `066`; módulo propio
 * desde E8, `076`).
 *
 * E8: registrar una NC ya no es un modal acá. El botón abre la MISMA pantalla
 * que el listado de NC de proveedores, con la compra precargada: un solo
 * formulario, que usa `calcularNcDeCompra` igual que el servidor.
 */
export function SupplierCreditNotesSection({ compraId, notas, saldo, canMutate }: Props) {
  const vigentes = notas.filter((n) => n.status === "emitida");
  const acreditado = vigentes.reduce((s, n) => s + n.grand_total, 0);

  return (
    <section className="space-y-3 rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-integra-navy">
          <FileMinus size={16} className="text-integra-gold" />
          Notas de crédito del proveedor
        </h2>
        {canMutate && saldo > 0.001 && (
          <Link
            href={`/finanzas/notas-credito-proveedor/nueva?compra=${compraId}`}
            className="inline-flex min-h-[48px] items-center gap-1.5 rounded-md bg-integra-navy px-4 text-sm font-semibold text-white hover:bg-integra-navy/90"
          >
            <Plus size={16} />
            Registrar nota de crédito del proveedor
          </Link>
        )}
      </div>

      {notas.length === 0 ? (
        <p className="text-sm text-gray-500">El proveedor no ha acreditado nada sobre esta compra.</p>
      ) : (
        <>
          <p className="text-xs text-gray-600">
            Acreditado vigente: <span className="font-mono font-semibold">B/. {fmtImporte(acreditado)}</span>
          </p>
          <ul className="divide-y rounded-md border">
            {notas.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <Link href={`/finanzas/notas-credito-proveedor/${n.id}`} className="font-mono text-integra-navy hover:underline">
                  {n.credit_note_number}
                </Link>
                <span className="text-gray-600">Documento del proveedor {n.supplier_document_number}</span>
                <span className="text-gray-500">{formatDate(n.issue_date)}</span>
                <span className={n.status === "anulada" ? "text-red-700 line-through" : "font-mono"}>
                  B/. {fmtImporte(n.grand_total)}
                </span>
                {n.status === "anulada" && <span className="text-xs text-red-700">Anulada</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
