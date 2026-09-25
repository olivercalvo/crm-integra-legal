"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, FileMinus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { fmtImporte } from "@/lib/utils/importe";
import { formatDate } from "@/lib/utils/format-date";
import {
  calcularNcDeCompra,
  disponibleEnLinea,
  type LineaDeCompraParaNc,
} from "@/lib/finanzas/contabilidad/asiento-nota-credito-compra";

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
  compraLabel: string;
  notas: NcDeCompraFila[];
  lineas: LineaDeCompraParaNc[];
  /** `balance_due`: lo que falta pagar. Es el tope de la NC (J-3). */
  saldo: number;
  canMutate: boolean;
}

/**
 * Notas de crédito del PROVEEDOR sobre esta compra (3.5, migración `066`).
 *
 * 🔴 La vista previa usa `calcularNcDeCompra`, la MISMA función que usa el
 *    servidor antes de llamar al RPC. Lo que se ve es lo que se registra; y si
 *    algún día discrepan, la base lo rechaza (verifica el asiento).
 */
export function SupplierCreditNotesSection({ compraId, compraLabel, notas, lineas, saldo, canMutate }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const hoy = new Date().toISOString().slice(0, 10);
  const [doc, setDoc] = useState("");
  const [docFecha, setDocFecha] = useState(hoy);
  const [cufe, setCufe] = useState("");
  const [motivo, setMotivo] = useState("");
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const pedido = useMemo(
    () => lineas.map((l) => ({ expense_line_id: l.id, amount: Number(montos[l.id] || 0) })),
    [lineas, montos]
  );
  const calculo = useMemo(() => calcularNcDeCompra(lineas, pedido, saldo), [lineas, pedido, saldo]);
  const hayMontos = pedido.some((p) => p.amount > 0);
  const faltaDato = doc.trim().length === 0 || motivo.trim().length < 3 || !docFecha;
  const puedeConfirmar = hayMontos && calculo.ok && !faltaDato;

  function reset() {
    setDoc("");
    setDocFecha(hoy);
    setCufe("");
    setMotivo("");
    setMontos({});
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/supplier-credit-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_expense_id: compraId,
            supplier_document_number: doc,
            supplier_document_date: docFecha,
            supplier_cufe: cufe || null,
            reason: motivo,
            lineas: pedido.filter((p) => p.amount > 0),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const campos = data.fieldErrors ? Object.values(data.fieldErrors).join(" ") : "";
          setError([data.error, campos].filter(Boolean).join(" ") || "No se pudo registrar la nota de crédito.");
          return;
        }
        setOpen(false);
        reset();
        router.push(`/finanzas/notas-credito-proveedor/${data.id}?registrada=1`);
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

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
          <Button
            type="button"
            onClick={() => {
              reset();
              setOpen(true);
            }}
            className="min-h-[48px] bg-integra-navy text-white hover:bg-integra-navy/90"
          >
            <Plus size={16} className="mr-1.5" />
            Registrar nota de crédito del proveedor
          </Button>
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

      <ConfirmationModal
        open={open}
        onClose={() => {
          if (!isPending) {
            setOpen(false);
            reset();
          }
        }}
        onConfirm={submit}
        loading={isPending}
        confirmDisabled={!puedeConfirmar}
        title={`Nota de crédito del proveedor · ${compraLabel}`}
        confirmButtonText={isPending ? "Registrando…" : "Registrar nota de crédito"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Escribe cuánto acreditó el proveedor en cada línea (la base, sin ITBMS). El ITBMS se calcula
            con la tasa de la línea. Se registra con la fecha de hoy y baja el saldo de la compra y el
            ITBMS de compras del mes.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Número del documento del proveedor *
              <input
                value={doc}
                onChange={(e) => setDoc(e.target.value)}
                maxLength={100}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="Ej: NC-0045"
              />
            </label>
            <label className="text-sm">
              Fecha del documento *
              <input
                type="date"
                value={docFecha}
                onChange={(e) => setDocFecha(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block text-sm">
            CUFE (opcional, si el proveedor emitió factura electrónica)
            <input
              value={cufe}
              onChange={(e) => setCufe(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
            />
          </label>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="pb-1 pr-2">Línea</th>
                  <th className="pb-1 pr-2 text-right">Disponible</th>
                  <th className="pb-1 text-right">Base a acreditar</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lineas.map((l) => {
                  const disponible = disponibleEnLinea(l);
                  return (
                    <tr key={l.id}>
                      <td className="py-1.5 pr-2 text-gray-800">
                        {l.line_order}. {l.description}
                        <span className="ml-1 font-mono text-gray-500">({l.chart_account_code})</span>
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono">{fmtImporte(disponible)}</td>
                      <td className="py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            inputMode="decimal"
                            value={montos[l.id] ?? ""}
                            onChange={(e) => setMontos({ ...montos, [l.id]: e.target.value.replace(",", ".") })}
                            disabled={disponible <= 0}
                            aria-label={`Base a acreditar en la línea ${l.line_order}`}
                            className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-right font-mono"
                            placeholder="0.00"
                          />
                          <button
                            type="button"
                            disabled={disponible <= 0}
                            onClick={() => setMontos({ ...montos, [l.id]: disponible.toFixed(2) })}
                            className="min-h-[36px] rounded-md border px-2 text-xs text-integra-navy hover:bg-gray-50 disabled:opacity-40"
                          >
                            Todo
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <label className="block text-sm">
            Motivo *
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              maxLength={1000}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Ej: Descuento por servicio incompleto, devolución de mercancía…"
            />
          </label>

          <div className="rounded-md border bg-gray-50 p-3 text-sm">
            {hayMontos && calculo.ok ? (
              <div className="flex flex-wrap justify-between gap-2 font-mono">
                <span>Base B/. {fmtImporte(calculo.subtotal)}</span>
                <span>ITBMS B/. {fmtImporte(calculo.itbms)}</span>
                <span className="font-semibold text-integra-navy">Total B/. {fmtImporte(calculo.total)}</span>
              </div>
            ) : hayMontos && !calculo.ok ? (
              <p className="text-red-700">{calculo.mensaje}</p>
            ) : (
              <p className="text-gray-500">Lo que falta pagar de esta compra: B/. {fmtImporte(saldo)}. Es el máximo que se puede acreditar.</p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </ConfirmationModal>
    </section>
  );
}
