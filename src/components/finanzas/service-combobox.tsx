"use client";

import { useState, useRef, useEffect } from "react";
import { Search, X, ChevronDown, Check, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { matchesSearchQuery } from "@/lib/utils/search";
import type { ServiceOption, InvoiceKind } from "@/lib/finanzas/types/invoice";

/**
 * Sentinel para la opción "Personalizado". Cuando el caller recibe
 * SERVICE_CUSTOM debe permitir editar todos los campos de la línea.
 */
export const SERVICE_CUSTOM = "__custom__";

interface ServiceComboboxProps {
  services: ServiceOption[];
  value: string | null; // null = ninguno seleccionado, SERVICE_CUSTOM = personalizado, UUID = servicio
  /** Filtrar por kind de la factura (HONORARIOS → service_type='honorarios', etc.). */
  filterKind?: InvoiceKind | null;
  onChange: (serviceId: string | null, service: ServiceOption | null) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * Combobox de servicios — incluye opción "Personalizado" como primer item
 * (D3). Al elegir un servicio, el caller debe pre-llenar description/
 * unit_price (default_price no existe en este schema, dejamos en 0) y el
 * tax_code default. Al elegir personalizado, todos los campos editables.
 *
 * Filtra opcionalmente por invoice_kind: si la factura es HONORARIOS,
 * mostramos solo service_type='honorarios'; si REEMBOLSO, solo 'reembolso'.
 */
export function ServiceCombobox({
  services,
  value,
  filterKind,
  onChange,
  error,
  disabled,
}: ServiceComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const isCustom = value === SERVICE_CUSTOM;
  const selected = !isCustom && value ? services.find((s) => s.id === value) ?? null : null;

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

  // Filtrar por tipo si aplica
  const kindFiltered = filterKind
    ? services.filter((s) =>
        filterKind === "HONORARIOS"
          ? s.service_type === "honorarios"
          : s.service_type === "reembolso"
      )
    : services;

  const filtered = query.trim()
    ? kindFiltered.filter((s) => matchesSearchQuery(query, s.code, s.name))
    : kindFiltered;

  const triggerLabel = isCustom
    ? "Personalizado"
    : selected
    ? `${selected.code} · ${selected.name}`
    : "Seleccionar servicio…";

  return (
    <div ref={wrapperRef} className="relative">
      {!open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 min-h-[44px] text-sm bg-white text-left transition-colors ${
            error ? "border-red-300" : "border-gray-300"
          } ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-integra-navy"}`}
        >
          <span className={selected || isCustom ? "text-gray-900 truncate" : "text-gray-400"}>
            {triggerLabel}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {(selected || isCustom) && !disabled && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null, null);
                }}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Limpiar"
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
              placeholder="Buscar servicio o código…"
              className="pl-9 border-0 focus-visible:ring-0 min-h-[44px]"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto border-t" role="listbox">
            {/* Opción "Personalizado" siempre primero */}
            <li
              role="option"
              aria-selected={isCustom}
              onClick={() => {
                onChange(SERVICE_CUSTOM, null);
                setOpen(false);
                setQuery("");
              }}
              className={`flex items-center gap-2 px-3 py-2 min-h-[44px] cursor-pointer text-sm border-b hover:bg-gray-50 ${
                isCustom ? "bg-integra-navy/5" : ""
              }`}
            >
              <Pencil size={14} className="text-integra-gold shrink-0" />
              <span className="font-medium text-gray-900">Personalizado</span>
              <span className="text-xs text-gray-500 ml-auto">Línea libre</span>
            </li>

            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-gray-500 text-center">
                {kindFiltered.length === 0
                  ? "No hay servicios para este tipo de factura"
                  : "Sin resultados"}
              </li>
            ) : (
              filtered.map((s) => {
                const isSel = s.id === value;
                return (
                  <li
                    key={s.id}
                    role="option"
                    aria-selected={isSel}
                    onClick={() => {
                      onChange(s.id, s);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex items-center justify-between gap-2 px-3 py-2 min-h-[44px] cursor-pointer text-sm hover:bg-gray-50 ${
                      isSel ? "bg-integra-navy/5" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{s.name}</p>
                      <p className="text-xs text-gray-500 truncate">{s.code}</p>
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
