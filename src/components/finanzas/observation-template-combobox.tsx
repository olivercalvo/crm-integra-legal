"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { ObservationTemplate } from "@/lib/finanzas/types/observation-template";

interface Props {
  templates: ObservationTemplate[];
  /** Llamado con el content de la plantilla elegida — el caller decide cómo anexarlo al textarea. */
  onInsert: (content: string) => void;
  disabled?: boolean;
}

/**
 * Combobox de plantillas de observaciones (Sprint QUOTES-POLISH, D11).
 *
 * Comportamiento:
 *   - Dropdown anclado a un trigger "+ Insertar plantilla".
 *   - Lista plantillas activas ordenadas por sort_order (NULLS LAST), luego name.
 *   - Cada item: name (bold, navy) + primeros 60 chars del content (gris).
 *   - Al hacer click sobre una plantilla: llama onInsert(content) pero NO
 *     cierra el dropdown — la abogada puede insertar varias plantillas
 *     consecutivas sin reabrir.
 *   - Cerrar: click afuera o ESC.
 *   - Si no hay plantillas activas: render disabled con mensaje.
 *
 * No filtra ni busca (típicamente <= 10 plantillas, render directo).
 */
export function ObservationTemplateCombobox({
  templates,
  onInsert,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const isEmpty = templates.length === 0;
  const triggerDisabled = disabled || isEmpty;

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        disabled={triggerDisabled}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors min-h-[36px] ${
          triggerDisabled
            ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
            : "border-integra-navy/30 bg-white text-integra-navy hover:bg-integra-navy/5"
        }`}
        title={isEmpty ? "No hay plantillas configuradas" : "Insertar plantilla de observaciones"}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Plus size={14} />
        Insertar plantilla
        <ChevronDown size={14} className="text-gray-400" />
      </button>

      {open && !isEmpty && (
        <div
          className="absolute z-20 mt-1 w-[320px] rounded-md border border-integra-navy bg-white shadow-lg max-h-[320px] overflow-y-auto"
          role="listbox"
        >
          <ul>
            {templates.map((tpl) => {
              const preview = tpl.content.length > 60
                ? tpl.content.slice(0, 60).trimEnd() + "…"
                : tpl.content;
              return (
                <li
                  key={tpl.id}
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    onInsert(tpl.content);
                    // NO cerramos — D11 permite múltiples inserciones consecutivas.
                  }}
                  className="flex flex-col gap-0.5 px-3 py-2 cursor-pointer hover:bg-integra-navy/5 border-b last:border-b-0"
                >
                  <span className="text-sm font-semibold text-integra-navy">{tpl.name}</span>
                  <span className="text-xs text-gray-500 line-clamp-2">{preview}</span>
                </li>
              );
            })}
          </ul>
          <div className="px-3 py-2 text-[11px] text-gray-500 bg-gray-50 border-t">
            Click en una plantilla para anexar al campo. Puedes combinar varias.
          </div>
        </div>
      )}
    </div>
  );
}
