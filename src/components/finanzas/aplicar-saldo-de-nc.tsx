"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtImporte } from "@/lib/utils/importe";

/**
 * «APLICAR SALDO A FAVOR» de una nota de crédito sin documento (E8, `076`).
 * Una sola pieza para venta (a una factura del cliente) y compra (a una compra
 * del proveedor). No genera asiento: el crédito ya está en la cuenta control a
 * nombre del tercero. El RPC valida los dos saldos con candado.
 */
export function AplicarSaldoDeNc({
  endpoint,
  campo,
  documentos,
  saldo,
  queDocumento,
}: {
  /** `/api/finanzas/credit-notes/{id}/apply` o el de proveedores. */
  endpoint: string;
  campo: "invoice_id" | "business_expense_id";
  documentos: { id: string; numero: string; saldo: number }[];
  saldo: number;
  /** «factura» o «compra», para los textos. */
  queDocumento: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [docId, setDocId] = useState(documentos[0]?.id ?? "");
  const doc = documentos.find((d) => d.id === docId) ?? null;
  const tope = doc ? Math.min(saldo, doc.saldo) : saldo;
  const [monto, setMonto] = useState(tope.toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  if (documentos.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No hay ninguna {queDocumento} con saldo de este tercero a la que aplicarlo.
      </p>
    );
  }

  function aplicar() {
    setError(null);
    setOk(null);
    const m = Number(String(monto).replace(",", "."));
    if (!(m > 0)) {
      setError("Escribe un monto mayor que cero.");
      return;
    }
    if (m > tope + 0.005) {
      setError(`Lo máximo que se puede aplicar es B/. ${fmtImporte(tope)}.`);
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [campo]: docId, amount: m }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo aplicar el saldo.");
          return;
        }
        setOk(`Se aplicaron B/. ${fmtImporte(m)}.`);
        router.refresh();
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
        <label className="text-sm">
          A qué {queDocumento}
          <select
            value={docId}
            onChange={(e) => {
              setDocId(e.target.value);
              const d = documentos.find((x) => x.id === e.target.value);
              if (d) setMonto(Math.min(saldo, d.saldo).toFixed(2));
            }}
            disabled={isPending}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 min-h-[44px] text-sm"
          >
            {documentos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.numero} · saldo B/. {fmtImporte(d.saldo)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Monto
          <input
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            disabled={isPending}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 min-h-[44px] text-right font-mono text-sm"
          />
        </label>
        <Button type="button" onClick={aplicar} disabled={isPending} className="min-h-[44px] bg-integra-navy text-white">
          {isPending ? <Loader2 size={16} className="mr-1.5 animate-spin" /> : <CheckCircle2 size={16} className="mr-1.5" />}
          Aplicar saldo a favor
        </Button>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {ok && <p role="status" className="text-sm text-emerald-700">{ok}</p>}
    </div>
  );
}
