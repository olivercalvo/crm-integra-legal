"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Landmark, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CobroSinAsiento } from "@/lib/finanzas/api/asignaciones-documentos";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

/** El banco de varios cobros sin asiento, de una vez. */
export function AsignarBancos({
  cobros,
  bancos,
  seleccionado,
}: {
  cobros: CobroSinAsiento[];
  bancos: { code: string; name: string }[];
  seleccionado: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(seleccionado ? [seleccionado] : []));
  const [banco, setBanco] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function alternar(id: string) {
    const n = new Set(marcados);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setMarcados(n);
  }

  function asignar() {
    setError(null);
    setOk(null);
    const n = marcados.size;
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/asientos/documentos-existentes/bancos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payment_ids: Array.from(marcados), payment_account_code: banco }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo asignar el banco.");
          return;
        }
        setOk(`Banco ${banco} asignado a ${n} cobro(s).`);
        router.refresh();
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  if (cobros.length === 0) {
    return <p className="rounded-xl border bg-white p-5 text-sm text-gray-600">No hay cobros sin asiento en este mes.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 space-y-3 rounded-xl border border-integra-gold/40 bg-white p-4 shadow-sm">
        <p className="text-sm text-integra-navy">Marcados: <strong>{marcados.size}</strong> cobro(s).</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1">
            <label htmlFor="banco" className="mb-1 block text-xs font-medium">Banco donde entró la plata</label>
            <select id="banco" value={banco} onChange={(e) => setBanco(e.target.value)} className="min-h-[48px] w-full rounded-md border border-gray-300 px-3 text-sm">
              <option value="">Elige el banco</option>
              {bancos.map((b) => <option key={b.code} value={b.code}>{b.code} {b.name}</option>)}
            </select>
          </div>
          <Button type="button" className="min-h-[48px] gap-2" disabled={isPending || !banco || marcados.size === 0} onClick={asignar}>
            {isPending ? <Loader2 size={16} className="animate-spin" /> : <Landmark size={16} />}
            Asignar banco a {marcados.size} cobro(s)
          </Button>
        </div>
        {ok && <p className="text-sm text-emerald-700" role="status">{ok}</p>}
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" onClick={() => setMarcados(new Set(cobros.filter((c) => !c.banco).map((c) => c.id)))} className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-gray-300 bg-white px-3 font-semibold text-integra-navy">
          <CheckSquare size={16} /> Marcar los que no tienen banco
        </button>
        <button type="button" onClick={() => setMarcados(new Set())} className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-gray-300 bg-white px-3 font-semibold text-gray-600">
          <Square size={16} /> Desmarcar todo
        </button>
      </div>

      <ul className="space-y-2">
        {cobros.map((c) => (
          <li key={c.id} id={c.id} className={`rounded-xl border bg-white px-4 shadow-sm ${c.id === seleccionado ? "ring-2 ring-integra-gold" : ""}`}>
            <label className="flex min-h-[56px] cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={marcados.has(c.id)} onChange={() => alternar(c.id)} className="h-5 w-5" aria-label={`Marcar el cobro ${c.numero}`} />
              <span className="flex-1">
                <span className="font-semibold text-integra-navy">{fechaCorta(c.fecha)} · {c.numero}</span>
                <span className="block text-gray-700">{c.cliente} · <span className="font-mono">{money(c.monto)}</span></span>
              </span>
              <span className={c.banco ? "text-gray-600" : "font-semibold text-red-700"}>{c.banco ?? "sin banco"}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
