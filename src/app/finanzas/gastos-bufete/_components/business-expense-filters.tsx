"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  BUSINESS_EXPENSE_STATUS_LABEL,
  type BusinessExpenseStatus,
} from "@/lib/finanzas/types/business-expense";
import type { ExpenseAccountOption } from "@/lib/finanzas/queries/business-expenses";

interface Props {
  accounts: ExpenseAccountOption[];
  initial: {
    search: string;
    status: BusinessExpenseStatus | "";
    accountCode: string;
    fromDate: string;
    toDate: string;
    hasItbms: "true" | "false" | "";
  };
}

const STATUSES: BusinessExpenseStatus[] = ["pendiente_pago", "pagado"];

/**
 * Filtros del listado de gastos del bufete. Cada cambio reescribe los
 * searchParams (page=1) y el server component refetchea. La búsqueda libre
 * se debouncea client-side.
 */
export function BusinessExpenseFilters({ accounts, initial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(initial.search);
  const [status, setStatus] = useState<BusinessExpenseStatus | "">(initial.status);
  const [accountCode, setAccountCode] = useState(initial.accountCode);
  const [fromDate, setFromDate] = useState(initial.fromDate);
  const [toDate, setToDate] = useState(initial.toDate);
  const [hasItbms, setHasItbms] = useState<"true" | "false" | "">(initial.hasItbms);

  // Debounce búsqueda libre (description + supplier_name)
  useEffect(() => {
    if (search === initial.search) return;
    const t = setTimeout(() => apply({ search }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function apply(patch: Partial<{
    search: string;
    status: string;
    accountCode: string;
    fromDate: string;
    toDate: string;
    hasItbms: string;
  }>) {
    const params = new URLSearchParams(searchParams.toString());
    const merged = {
      search: patch.search ?? search,
      status: patch.status ?? status,
      accountCode: patch.accountCode ?? accountCode,
      fromDate: patch.fromDate ?? fromDate,
      toDate: patch.toDate ?? toDate,
      hasItbms: patch.hasItbms ?? hasItbms,
    };
    if (merged.search.trim()) params.set("q", merged.search.trim());
    else params.delete("q");
    if (merged.status) params.set("status", merged.status);
    else params.delete("status");
    if (merged.accountCode) params.set("account", merged.accountCode);
    else params.delete("account");
    if (merged.fromDate) params.set("from", merged.fromDate);
    else params.delete("from");
    if (merged.toDate) params.set("to", merged.toDate);
    else params.delete("to");
    if (merged.hasItbms) params.set("has_itbms", merged.hasItbms);
    else params.delete("has_itbms");
    params.delete("page");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function clearAll() {
    setSearch("");
    setStatus("");
    setAccountCode("");
    setFromDate("");
    setToDate("");
    setHasItbms("");
    startTransition(() => router.push(pathname));
  }

  const hasFilters = !!(search || status || accountCode || fromDate || toDate || hasItbms);

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4 shadow-sm">
      {/* Búsqueda */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por descripción o proveedor…"
          className="pl-9 min-h-[44px]"
        />
      </div>

      {/* Filtros estructurados */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select
          value={status}
          onChange={(e) => {
            const v = e.target.value as BusinessExpenseStatus | "";
            setStatus(v);
            apply({ status: v });
          }}
          className="rounded-md border border-gray-300 px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
        >
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {BUSINESS_EXPENSE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>

        <select
          value={accountCode}
          onChange={(e) => {
            setAccountCode(e.target.value);
            apply({ accountCode: e.target.value });
          }}
          className="rounded-md border border-gray-300 px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
        >
          <option value="">Todas las cuentas</option>
          {accounts.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>

        <select
          value={hasItbms}
          onChange={(e) => {
            const v = e.target.value as "true" | "false" | "";
            setHasItbms(v);
            apply({ hasItbms: v });
          }}
          className="rounded-md border border-gray-300 px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
        >
          <option value="">Con o sin ITBMS</option>
          <option value="true">Con ITBMS</option>
          <option value="false">Exentos (sin ITBMS)</option>
        </select>

        <div className="grid grid-cols-2 gap-1">
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              apply({ fromDate: e.target.value });
            }}
            className="min-h-[44px]"
            title="Desde"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              apply({ toDate: e.target.value });
            }}
            className="min-h-[44px]"
            title="Hasta"
          />
        </div>
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
