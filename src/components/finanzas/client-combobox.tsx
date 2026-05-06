"use client";

import { useState, useRef, useEffect } from "react";
import { Search, X, ChevronDown, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { matchesSearchQuery } from "@/lib/utils/search";
import type { ClientOption } from "@/lib/finanzas/types/invoice";

interface ClientComboboxProps {
  clients: ClientOption[];
  value: string | null;
  onChange: (clientId: string | null, client: ClientOption | null) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * Combobox de clientes — patrón "Input + lista filtrada" del repo
 * (consistente con case-form.tsx). NO usa shadcn Combobox / cmdk.
 * Búsqueda case-insensitive y sin acentos via matchesSearchQuery.
 */
export function ClientCombobox({
  clients,
  value,
  onChange,
  error,
  disabled,
}: ClientComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selected = clients.find((c) => c.id === value) ?? null;

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = query.trim()
    ? clients.filter((c) => matchesSearchQuery(query, c.name, c.client_number, c.ruc))
    : clients;

  return (
    <div ref={wrapperRef} className="relative">
      {/* Trigger */}
      {!open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 min-h-[48px] text-sm bg-white text-left transition-colors ${
            error ? "border-red-300" : "border-gray-300"
          } ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-integra-navy"}`}
        >
          <span className={selected ? "text-gray-900 truncate" : "text-gray-400"}>
            {selected
              ? `${selected.name}${selected.client_number ? ` · ${selected.client_number}` : ""}`
              : "Seleccionar cliente…"}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {selected && !disabled && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null, null);
                }}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Limpiar selección"
              >
                <X size={14} />
              </span>
            )}
            <ChevronDown size={16} className="text-gray-400" />
          </span>
        </button>
      ) : (
        <div className="rounded-md border border-integra-navy bg-white shadow-sm">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, número o RUC…"
              className="pl-9 border-0 focus-visible:ring-0 min-h-[48px]"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto border-t" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-gray-500 text-center">
                Sin resultados
              </li>
            ) : (
              filtered.map((c) => {
                const isSel = c.id === value;
                return (
                  <li
                    key={c.id}
                    role="option"
                    aria-selected={isSel}
                    onClick={() => {
                      onChange(c.id, c);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex items-center justify-between gap-2 px-3 py-2 min-h-[44px] cursor-pointer text-sm hover:bg-gray-50 ${
                      isSel ? "bg-integra-navy/5" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{c.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {c.client_number}
                        {c.ruc ? ` · RUC ${c.ruc}` : ""}
                      </p>
                    </div>
                    {isSel && <Check size={16} className="text-integra-gold shrink-0" />}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
