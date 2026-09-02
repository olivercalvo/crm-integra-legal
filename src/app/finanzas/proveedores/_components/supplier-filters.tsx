"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

/** Filtros del listado. Viajan por la URL para que un listado sea compartible. */
export function SupplierFilters({ search, active }: { search: string; active: string }) {
  const router = useRouter();
  const [texto, setTexto] = useState(search);

  function navegar(q: string, a: string) {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (a) p.set("active", a);
    const qs = p.toString();
    router.push(`/finanzas/proveedores${qs ? `?${qs}` : ""}`);
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        navegar(texto, active);
      }}
    >
      <div className="min-w-[220px] flex-1">
        <label htmlFor="q" className="mb-1 block text-xs font-medium text-gray-600">
          Buscar
        </label>
        <input
          id="q"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Razón social, razón comercial o RUC"
          className="block w-full rounded-md border border-gray-300 px-3 min-h-[44px] text-sm focus:border-integra-navy focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="active" className="mb-1 block text-xs font-medium text-gray-600">
          Estado
        </label>
        <select
          id="active"
          value={active}
          onChange={(e) => navegar(texto, e.target.value)}
          className="block rounded-md border border-gray-300 bg-white px-3 min-h-[44px] text-sm focus:border-integra-navy focus:outline-none"
        >
          <option value="">Todos</option>
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
        </select>
      </div>

      <button
        type="submit"
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-integra-navy px-4 text-sm font-medium text-white hover:bg-integra-navy/90"
      >
        <Search size={16} />
        Buscar
      </button>
    </form>
  );
}
