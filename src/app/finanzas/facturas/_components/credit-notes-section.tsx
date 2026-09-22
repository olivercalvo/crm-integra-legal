import Link from "next/link";
import { FileMinus, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/utils/format-date";
import { fmtImporte } from "@/lib/utils/importe";
import { NcFeEstadoBadge } from "@/components/finanzas/nc-fe-estado-badge";
import { CreditNotePdfButton } from "@/components/finanzas/credit-note-pdf-button";

export interface CreditNoteListItem {
  id: string;
  credit_note_number: string;
  issue_date: string;
  reason: string;
  grand_total: number;
  fe_estado: string;
}

interface Props {
  notas: CreditNoteListItem[];
  isAnulada: boolean;
  creditedTotal: number;
}

/**
 * Las notas de crédito de una factura (Bloque 5). Reemplaza a la card que
 * mostraba UNA sola NC "generada al anular": ahora una factura puede tener
 * varias (parciales, con fecha de hoy) y seguir emitida. Cada fila enlaza al
 * detalle de la NC (donde está su asiento) y baja el PDF.
 */
export function CreditNotesSection({ notas, isAnulada, creditedTotal }: Props) {
  if (notas.length === 0) return null;
  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-integra-gold/15">
          <FileMinus size={20} className="text-integra-navy" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-integra-navy">
            {notas.length === 1 ? "Nota de crédito" : "Notas de crédito"}
          </h2>
          <p className="text-xs text-gray-500">
            {isAnulada
              ? "Generada al anular esta factura."
              : `Acreditado B/. ${fmtImporte(creditedTotal)} sobre esta factura.`}
          </p>
        </div>
      </div>

      <ul className="divide-y rounded-md border">
        {notas.map((nc) => (
          <li key={nc.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/finanzas/notas-credito/${nc.id}`}
                  className="inline-flex items-center gap-1 font-mono font-semibold text-integra-navy hover:underline"
                >
                  {nc.credit_note_number}
                  <ExternalLink size={12} className="text-gray-400" />
                </Link>
                <NcFeEstadoBadge estado={nc.fe_estado} />
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                {formatDate(nc.issue_date)} · {nc.reason}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono font-semibold text-integra-navy">
                B/. {fmtImporte(nc.grand_total)}
              </span>
              <CreditNotePdfButton creditNoteId={nc.id} compact />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
