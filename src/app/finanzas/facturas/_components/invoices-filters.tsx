"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  INVOICE_STATUS_LABEL,
  INVOICE_KIND_LABEL,
  type InvoiceKind,
  type InvoiceStatus,
} from "@/lib/finanzas/types/invoice";
import type { ClientOption } from "@/lib/finanzas/types/invoice";

interface Props {
  clients: ClientOption[];
  initial: {
    search: string;
    status: InvoiceStatus | "";
    kind: InvoiceKind | "";
    clientId: string;
  };
}

const STATUSES: InvoiceStatus[] = [
  "borrador",
  "emitida",
  "parcialmente_pagada",
  "pagada",
  "anulada",
  "cancelada_pre_emision",
];

const KINDS: InvoiceKind[] = ["HONORARIOS", "REEMBOLSO"];

/**
 * Filtros de la lista de facturas. Cada cambio reescribe los searchParams
 * (page=1) y el server component refetchea. La búsqueda por número se
 * debouncea client-side para evitar refetch en cada tecla.
 */
export function InvoicesFilters({ clients, initial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(initial.search);
  const [status, setStatus] = useState<InvoiceStatus | "">(initial.status);
  const [kind, setKind] = useState<InvoiceKind | "">(initial.kind);
  const [clientId, setClientId] = useState(initial.clientId);

  // Debounce búsqueda por número
  useEffect(() => {
    if (search === initial.search) return;
    const t = setTimeout(() => {
      apply({ search });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function apply(patch: Partial<{ search: string; status: string; kind: string; clientId: string }>) {
    const params = new URLSearchParams(searchParams.toString());
    const merged = {
      search: patch.search ?? search,
      status: patch.status ?? status,
      kind: patch.kind ?? kind,
      clientId: patch.clientId ?? clientId,
    };
    if (merged.search.trim()) params.set("q", merged.search.trim());
    else params.delete("q");
    if (merged.status) params.set("status", merged.status);
    else params.delete("status");
    if (merged.kind) params.set("kind", merged.kind);
    else params.delete("kind");
    if (merged.clientId) params.set("client", merged.clientId);
    else params.delete("client");
    params.delete("page"); // siempre vuelve a la página 1
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function clearAll() {
    setSearch("");
    setStatus("");
    setKind("");
    setClientId("");
    startTransition(() => router.push(pathname));
  }

  const hasFilters = !!(search || status || kind || clientId);

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4 shadow-sm">
      {/* Búsqueda */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por número de factura (ej. FAC-HON-000453)…"
          className="pl-9 min-h-[44px]"
        />
      </div>

      {/* Filtros estructurados */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          value={kind}
          onChange={(e) => {
            const v = e.target.value as InvoiceKind | "";
            setKind(v);
            apply({ kind: v });
          }}
          className="rounded-md border border-gray-300 px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
        >
          <option value="">Todos los tipos</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {INVOICE_KIND_LABEL[k]}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => {
            const v = e.target.value as InvoiceStatus | "";
            setStatus(v);
            apply({ status: v });
          }}
          className="rounded-md border border-gray-300 px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
        >
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {INVOICE_STATUS_LABEL[s]}
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
