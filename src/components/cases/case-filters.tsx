"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface FilterOption {
  id: string;
  name: string;
}

interface CaseFiltersProps {
  statuses: FilterOption[];
  classifications: FilterOption[];
  team: FilterOption[];
  institutions: FilterOption[];
}

export function CaseFilters({
  statuses,
  classifications,
  team,
  institutions,
}: CaseFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const createQueryString = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      // Reset page on filter change
      params.delete("page");
      return params.toString();
    },
    [searchParams]
  );

  const handleChange = (key: string, value: string) => {
    startTransition(() => {
      router.push(`${pathname}?${createQueryString({ [key]: value || null })}`);
    });
  };

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      startTransition(() => {
        router.push(`${pathname}?${createQueryString({ q: value || null })}`);
      });
    }, 300);
  };

  const hasFilters =
    searchParams.has("q") ||
    searchParams.has("status") ||
    searchParams.has("classification") ||
    searchParams.has("responsible") ||
    searchParams.has("institution");

  const clearAll = () => {
    startTransition(() => {
      router.push(pathname);
    });
  };

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <Input
          type="text"
          placeholder="Buscar por código, descripción o cliente..."
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9 min-h-[48px]"
        />
      </div>

      {/* Filter dropdowns */}
      <div className="flex flex-wrap gap-2">
        <select
          value={searchParams.get("status") ?? ""}
          onChange={(e) => handleChange("status", e.target.value)}
          className="min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Filtrar por estado"
        >
          <option value="">Todos los estados</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <select
          value={searchParams.get("classification") ?? ""}
          onChange={(e) => handleChange("classification", e.target.value)}
          className="min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Filtrar por clasificación"
        >
          <option value="">Todas las clasificaciones</option>
          {classifications.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={searchParams.get("responsible") ?? ""}
          onChange={(e) => handleChange("responsible", e.target.value)}
          className="min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Filtrar por responsable"
        >
          <option value="">Todos los responsables</option>
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <select
          value={searchParams.get("institution") ?? ""}
          onChange={(e) => handleChange("institution", e.target.value)}
          className="min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Filtrar por institución"
        >
          <option value="">Todas las instituciones</option>
          {institutions.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            disabled={isPending}
            className="min-h-[40px] text-gray-500 hover:text-gray-700"
          >
            <X size={14} className="mr-1" />
            Limpiar
          </Button>
        )}
      </div>

      {isPending && (
        <p className="text-xs text-gray-400">Filtrando...</p>
      )}
    </div>
  );
}
