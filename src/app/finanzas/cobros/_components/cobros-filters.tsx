"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ClientOption } from "@/lib/finanzas/types/invoice";

interface Filtros {
  search: string;
  clientId: string;
  from: string;
  to: string;
  estado: string;
}

interface Props {
  clients: ClientOption[];
  initial: Filtros;
}

/**
 * Filtros del listado de cobros: número de recibo, cliente, rango de fechas
 * (sobre `payment_date`) y estado. Cada cambio reescribe los searchParams y
 * el server component refetchea. Mismo patrón que `invoices-filters.tsx`.
 */
export function CobrosFilters({ clients, initial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(initial.search);
  const [clientId, setClientId] = useState(initial.clientId);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [estado, setEstado] = useState(initial.estado);

  // Debounce de la búsqueda por número
  useEffect(() => {
    if (search === initial.search) return;
    const t = setTimeout(() => apply({ search }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function apply(patch: Partial<Filtros>) {
    const params = new URLSearchParams(searchParams.toString());
    const merged: Filtros = {
      search: patch.search ?? search,
      clientId: patch.clientId ?? clientId,
      from: patch.from ?? from,
      to: patch.to ?? to,
      estado: patch.estado ?? estado,
    };
    const set = (k: string, v: string) => (v ? params.set(k, v) : params.delete(k));
    set("q", merged.search.trim());
    set("client", merged.clientId);
    set("from", merged.from);
    set("to", merged.to);
    set("estado", merged.estado);
    params.delete("page");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function clearAll() {
    setSearch("");
    setClientId("");
    setFrom("");
    setTo("");
    setEstado("");
    startTransition(() => router.push(pathname));
  }

  const hasFilters = !!(search || clientId || from || to || estado);
  const selectClass =
    "rounded-md border border-gray-300 px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none";

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4 shadow-sm">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por número de recibo (ej. REC-000012)…"
          className="pl-9 min-h-[44px]"
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            apply({ clientId: e.target.value });
          }}
          className={selectClass}
          aria-label="Cliente"
        >
          <option value="">Todos los clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <Input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => {
            setFrom(e.target.value);
            apply({ from: e.target.value });
          }}
          className="min-h-[44px]"
          aria-label="Desde"
        />

        <Input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => {
            setTo(e.target.value);
            apply({ to: e.target.value });
          }}
          className="min-h-[44px]"
          aria-label="Hasta"
        />

        <select
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value);
            apply({ estado: e.target.value });
          }}
          className={selectClass}
          aria-label="Estado"
        >
          <option value="">Vigentes y reversados</option>
          <option value="vigentes">Solo vigentes</option>
          <option value="reversados">Solo reversados</option>
        </select>
      </div>

      {hasFilters && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={clearAll} disabled={isPending}>
            <X size={14} className="mr-1" />
            Limpiar filtros
          </Button>
          {isPending && <span className="text-xs text-gray-500">Actualizando…</span>}
        </div>
      )}
    </div>
  );
}
