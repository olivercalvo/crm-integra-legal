"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  QUOTE_STATUS_LABEL,
  type QuoteStatus,
} from "@/lib/finanzas/types/quote";
import type { ClientOption, CaseOption } from "@/lib/finanzas/types/invoice";

interface Props {
  clients: ClientOption[];
  /** Lista de casos del tenant (sin filtrar por cliente; el usuario elige). */
  cases: Pick<CaseOption, "id" | "case_code" | "description">[];
  initial: {
    search: string;
    status: QuoteStatus | "";
    clientId: string;
    caseId: string;
  };
}

const STATUSES: QuoteStatus[] = [
  "borrador",
  "enviada",
  "aceptada",
  "rechazada",
  "expirada",
  "convertida",
  "cancelada_pre_envio",
];

/**
 * Filtros de la lista de cotizaciones. Cada cambio reescribe los searchParams
 * (page=1) y el server component refetchea. La búsqueda por número se
 * debouncea client-side. Mismo patrón que InvoicesFilters.
 */
export function QuotesFilters({ clients, cases, initial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(initial.search);
  const [status, setStatus] = useState<QuoteStatus | "">(initial.status);
  const [clientId, setClientId] = useState(initial.clientId);
  const [caseId, setCaseId] = useState(initial.caseId);

  // Debounce búsqueda por número
  useEffect(() => {
    if (search === initial.search) return;
    const t = setTimeout(() => {
      apply({ search });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function apply(patch: Partial<{ search: string; status: string; clientId: string; caseId: string }>) {
    const params = new URLSearchParams(searchParams.toString());
    const merged = {
      search: patch.search ?? search,
      status: patch.status ?? status,
      clientId: patch.clientId ?? clientId,
      caseId: patch.caseId ?? caseId,
    };
    if (merged.search.trim()) params.set("q", merged.search.trim());
    else params.delete("q");
    if (merged.status) params.set("status", merged.status);
    else params.delete("status");
    if (merged.clientId) params.set("client", merged.clientId);
    else params.delete("client");
    if (merged.caseId) params.set("case", merged.caseId);
    else params.delete("case");
    params.delete("page");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function clearAll() {
    setSearch("");
    setStatus("");
    setClientId("");
    setCaseId("");
    startTransition(() => router.push(pathname));
  }

  const hasFilters = !!(search || status || clientId || caseId);

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4 shadow-sm">
      {/* Búsqueda */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por número (ej. COT-001268)…"
          className="pl-9 min-h-[44px]"
        />
      </div>

      {/* Filtros estructurados */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          value={status}
          onChange={(e) => {
            const v = e.target.value as QuoteStatus | "";
            setStatus(v);
            apply({ status: v });
          }}
          className="rounded-md border border-gray-300 px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
        >
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "cancelada_pre_envio" ? "Cancelada" : QUOTE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>

        <select
          value={clientId}
          onChange={(e) => {
            const v = e.target.value;
            setClientId(v);
            apply({ clientId: v });
          }}
          className="rounded-md border border-gray-300 px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
        >
          <option value="">Todos los clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={caseId}
          onChange={(e) => {
            const v = e.target.value;
            setCaseId(v);
            apply({ caseId: v });
          }}
          className="rounded-md border border-gray-300 px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
        >
          <option value="">Todos los casos</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.case_code}
              {c.description ? ` · ${c.description.slice(0, 40)}` : ""}
            </option>
          ))}
        </select>
      </div>

      {hasFilters && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearAll}
            disabled={isPending}
          >
            <X size={14} className="mr-1" />
            Limpiar filtros
          </Button>
          {isPending && <span className="text-xs text-gray-500">Actualizando…</span>}
        </div>
      )}
    </div>
  );
}
