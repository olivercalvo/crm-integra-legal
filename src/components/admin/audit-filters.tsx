"use client";

import { useCallback, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ENTITY_OPTIONS, ACTION_OPTIONS } from "@/lib/constants/audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserOption {
  id: string;
  full_name: string;
  email: string;
}

interface AuditFiltersProps {
  /** Pre-fetched list of users for the user selector */
  users: UserOption[];
  /** Current active filter values (read from URL searchParams) */
  currentFilters: {
    entity: string;
    user_id: string;
    action: string;
    date_from: string;
    date_to: string;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AuditFilters({ users, currentFilters }: AuditFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  /** Merge a single param change into the current URL, always reset to page 1 */
  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page"); // reset to page 1 on any filter change
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams]
  );

  const hasActiveFilters =
    currentFilters.entity ||
    currentFilters.user_id ||
    currentFilters.action ||
    currentFilters.date_from ||
    currentFilters.date_to;

  const clearFilters = () => {
    startTransition(() => {
      router.push(pathname);
    });
  };

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-integra-navy">
          <Filter size={15} />
          Filtros
        </div>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs text-gray-500 hover:text-red-600"
            onClick={clearFilters}
            disabled={isPending}
          >
            <X size={13} />
            Limpiar filtros
          </Button>
        )}
      </div>

      {/* Filter grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {/* Entity */}
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-500">Entidad</Label>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-integra-navy/30 disabled:opacity-50"
            value={currentFilters.entity || "all"}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setParam("entity", e.target.value === "all" ? "" : e.target.value)
            }
            disabled={isPending}
          >
            <option value="all">Todas las entidades</option>
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* User */}
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-500">Usuario</Label>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-integra-navy/30 disabled:opacity-50"
            value={currentFilters.user_id || "all"}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setParam("user_id", e.target.value === "all" ? "" : e.target.value)
            }
            disabled={isPending}
          >
            <option value="all">Todos los usuarios</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.email}
              </option>
            ))}
          </select>
        </div>

        {/* Action */}
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-500">Acción</Label>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-integra-navy/30 disabled:opacity-50"
            value={currentFilters.action || "all"}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setParam("action", e.target.value === "all" ? "" : e.target.value)
            }
            disabled={isPending}
          >
            <option value="all">Todas las acciones</option>
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Date from */}
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-500">Desde</Label>
          <Input
            type="date"
            className="h-10 text-sm"
            value={currentFilters.date_from}
            onChange={(e) => setParam("date_from", e.target.value)}
            disabled={isPending}
          />
        </div>

        {/* Date to */}
        <div className="space-y-1.5">
          <Label className="text-xs text-gray-500">Hasta</Label>
          <Input
            type="date"
            className="h-10 text-sm"
            value={currentFilters.date_to}
            onChange={(e) => setParam("date_to", e.target.value)}
            disabled={isPending}
          />
        </div>
      </div>
    </div>
  );
}
