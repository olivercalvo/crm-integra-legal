"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ClientListSearchProps {
  defaultSearch?: string;
}

export function ClientListSearch({ defaultSearch = "" }: ClientListSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultSearch);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateUrl = useCallback(
    (search: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (search) {
        params.set("q", search);
      } else {
        params.delete("q");
      }
      // Reset to page 1 on new search
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => updateUrl(newValue), 300);
  };

  const handleClear = () => {
    setValue("");
    if (timerRef.current) clearTimeout(timerRef.current);
    updateUrl("");
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="relative w-full sm:max-w-xs">
      <Search
        size={16}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
      />
      <Input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder="Buscar por nombre, RUC o número…"
        className="pl-9 pr-9 min-h-[44px]"
        aria-label="Buscar clientes"
      />
      {value && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label="Limpiar búsqueda"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

interface PaginationProps {
  page: number;
  totalPages: number;
}

export function ClientListPagination({ page, totalPages }: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newPage <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(newPage));
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <button
        onClick={() => goToPage(page - 1)}
        disabled={page <= 1}
        className="min-h-[44px] min-w-[44px] rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40 hover:bg-gray-100 transition-colors"
        aria-label="Página anterior"
      >
        ← Anterior
      </button>
      <span className="px-3 py-2 text-sm text-gray-600">
        {page} / {totalPages}
      </span>
      <button
        onClick={() => goToPage(page + 1)}
        disabled={page >= totalPages}
        className="min-h-[44px] min-w-[44px] rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40 hover:bg-gray-100 transition-colors"
        aria-label="Página siguiente"
      >
        Siguiente →
      </button>
    </div>
  );
}
