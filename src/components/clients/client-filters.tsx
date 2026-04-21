"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ClientFiltersProps {
  defaultSearch?: string;
  lawyers: { id: string; name: string }[];
}

export function ClientFilters({ defaultSearch = "", lawyers }: ClientFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(defaultSearch);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createQueryString = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, val]) => {
        if (val === null || val === "") params.delete(key);
        else params.set(key, val);
      });
      params.delete("page");
      return params.toString();
    },
    [searchParams]
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      startTransition(() => {
        router.push(`${pathname}?${createQueryString({ q: newValue || null })}`);
      });
    }, 300);
  };

  const handleFilterChange = (key: string, val: string) => {
    startTransition(() => {
      router.push(`${pathname}?${createQueryString({ [key]: val || null })}`);
    });
  };

  const hasFilters = searchParams.has("q") || searchParams.has("responsible");

  const clearAll = () => {
    setValue("");
    startTransition(() => {
      router.push(pathname);
    });
  };

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <div className="relative flex-1 sm:max-w-xs">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <Input
          type="text"
          value={value}
          onChange={handleSearchChange}
          placeholder="Buscar en todo: nombre, RUC, número, email, abogada, casos..."
          className="pl-9 pr-9 min-h-[44px]"
        />
        {value && (
          <button
            onClick={() => { setValue(""); handleFilterChange("q", ""); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        )}
      </div>
      {lawyers.length > 0 && (
        <select
          value={searchParams.get("responsible") ?? ""}
          onChange={(e) => handleFilterChange("responsible", e.target.value)}
          className="min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Todas las abogadas</option>
          {lawyers.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      )}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearAll} disabled={isPending} className="min-h-[44px] text-gray-500 hover:text-gray-700">
          <X size={14} className="mr-1" /> Limpiar
        </Button>
      )}
    </div>
  );
}
