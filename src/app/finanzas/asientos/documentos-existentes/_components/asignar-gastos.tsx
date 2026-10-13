"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Loader2, Square, Tags, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GastoSinAsiento } from "@/lib/finanzas/api/asignaciones-documentos";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

/**
 * Proveedor (por gasto) y cuenta (por línea), en lote. Marcar un gasto marca
 * todas sus líneas; también se marcan líneas sueltas. El proveedor va a los
 * gastos de las líneas marcadas; la cuenta, a las líneas marcadas.
 */
export function AsignarGastos({
  gastos,
  proveedores,
  cuentas,
  seleccionado,
}: {
  gastos: GastoSinAsiento[];
  proveedores: { id: string; nombre: string }[];
  cuentas: { code: string; name: string; sugerida: boolean }[];
  seleccionado: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [soloIncompletos, setSoloIncompletos] = useState(true);
  const [lineas, setLineas] = useState<Set<string>>(
    () => new Set(gastos.filter((g) => g.id === seleccionado).flatMap((g) => g.lineas.map((l) => l.id)))
  );
  const [proveedor, setProveedor] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const incompleto = (g: GastoSinAsiento) => !g.proveedorId || g.lineas.length === 0 || g.lineas.some((l) => !l.cuenta);
  const visibles = useMemo(
    () => gastos.filter((g) => !soloIncompletos || incompleto(g) || g.id === seleccionado),
    [gastos, soloIncompletos, seleccionado]
  );
  const gastosMarcados = gastos.filter((g) => g.lineas.some((l) => lineas.has(l.id)));
  const todoMarcado = (g: GastoSinAsiento) => g.lineas.length > 0 && g.lineas.every((l) => lineas.has(l.id));

  function alternarGasto(g: GastoSinAsiento) {
    const n = new Set(lineas);
    const todo = todoMarcado(g);
    for (const l of g.lineas) {
      if (todo) n.delete(l.id);
      else n.add(l.id);
    }
    setLineas(n);
  }
  function alternarLinea(id: string) {
    const n = new Set(lineas);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setLineas(n);
  }
  function marcarVisibles() {
    const n = new Set(lineas);
    for (const g of visibles) for (const l of g.lineas) n.add(l.id);
    setLineas(n);
  }

  function enviar(body: Record<string, unknown>, exito: string) {
    setError(null);
    setOk(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/asientos/documentos-existentes/gastos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo asignar.");
          return;
        }
        setOk(exito);
        router.refresh();
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  if (gastos.length === 0) {
    return <p className="rounded-xl border bg-white p-5 text-sm text-gray-600">No hay gastos de trámite sin asiento en este mes.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 space-y-3 rounded-xl border border-integra-gold/40 bg-white p-4 shadow-sm">
        <p className="text-sm text-integra-navy">
          Marcados: <strong>{gastosMarcados.length}</strong> gasto(s), <strong>{lineas.size}</strong> línea(s).
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1">
            <label htmlFor="proveedor" className="mb-1 block text-xs font-medium">Proveedor</label>
            <select id="proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="min-h-[48px] w-full rounded-md border border-gray-300 px-3 text-sm">
              <option value="">Elige un proveedor</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <Button
            type="button"
            className="min-h-[48px] gap-2"
            disabled={isPending || !proveedor || gastosMarcados.length === 0}
            onClick={() => enviar({ expense_ids: gastosMarcados.map((g) => g.id), supplier_id: proveedor },
              `Proveedor asignado a ${gastosMarcados.length} gasto(s).`)}
          >
            {isPending ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />}
            Asignar proveedor a {gastosMarcados.length} gasto(s)
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1">
            <label htmlFor="cuenta" className="mb-1 block text-xs font-medium">Cuenta</label>
            <select id="cuenta" value={cuenta} onChange={(e) => setCuenta(e.target.value)} className="min-h-[48px] w-full rounded-md border border-gray-300 px-3 text-sm">
              <option value="">Elige una cuenta</option>
              <optgroup label="Sugeridas para un trámite">
                {cuentas.filter((c) => c.sugerida).map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}
              </optgroup>
              <optgroup label="Todas las que acepta un gasto">
                {cuentas.filter((c) => !c.sugerida).map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}
              </optgroup>
            </select>
          </div>
          <Button
            type="button"
            className="min-h-[48px] gap-2"
            disabled={isPending || !cuenta || lineas.size === 0}
            onClick={() => enviar({ line_ids: Array.from(lineas), chart_account_code: cuenta }, `Cuenta ${cuenta} asignada a ${lineas.size} línea(s).`)}
          >
            {isPending ? <Loader2 size={16} className="animate-spin" /> : <Tags size={16} />}
            Asignar cuenta a {lineas.size} línea(s)
          </Button>
        </div>
        {ok && <p className="text-sm text-emerald-700" role="status">{ok}</p>}
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex min-h-[44px] items-center gap-2">
          <input type="checkbox" checked={soloIncompletos} onChange={(e) => setSoloIncompletos(e.target.checked)} className="h-5 w-5" />
          Sólo los que les falta proveedor o cuenta
        </label>
        <button type="button" onClick={marcarVisibles} className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-gray-300 bg-white px-3 font-semibold text-integra-navy">
          <CheckSquare size={16} /> Marcar los {visibles.length} de la lista
        </button>
        <button type="button" onClick={() => setLineas(new Set())} className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-gray-300 bg-white px-3 font-semibold text-gray-600">
          <Square size={16} /> Desmarcar todo
        </button>
      </div>

      <ul className="space-y-3">
        {visibles.map((g) => (
          <li key={g.id} id={g.id} className={`rounded-xl border bg-white p-4 shadow-sm ${g.id === seleccionado ? "ring-2 ring-integra-gold" : ""}`}>
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
              <input type="checkbox" checked={todoMarcado(g)} onChange={() => alternarGasto(g)} className="mt-1 h-5 w-5" aria-label={`Marcar el gasto ${g.concepto}`} />
              <span className="flex-1 text-sm">
                <span className="font-semibold text-integra-navy">{fechaCorta(g.fecha)} · {g.numero ?? "sin número"}{g.caso ? ` · caso ${g.caso}` : ""}</span>
                <span className="block text-gray-700">{g.concepto} · <span className="font-mono">{money(g.monto)}</span></span>
                <span className={`block ${g.proveedor ? "text-gray-600" : "font-semibold text-red-700"}`}>
                  Proveedor: {g.proveedor ?? "sin proveedor"}
                </span>
              </span>
            </label>
            <ul className="mt-2 space-y-1 border-t pt-2 pl-8">
              {g.lineas.length === 0 && <li className="text-sm font-semibold text-red-700">Sin líneas: no se puede contabilizar.</li>}
              {g.lineas.map((l) => (
                <li key={l.id}>
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm">
                    <input type="checkbox" checked={lineas.has(l.id)} onChange={() => alternarLinea(l.id)} className="h-5 w-5" aria-label={`Marcar la línea ${l.descripcion}`} />
                    <span className="flex-1">{l.descripcion} · <span className="font-mono">{money(l.monto)}</span></span>
                    <span className={l.cuenta ? "text-gray-600" : "font-semibold text-red-700"}>{l.cuenta ?? "sin cuenta"}</span>
                  </label>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
