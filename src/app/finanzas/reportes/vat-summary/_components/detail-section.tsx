"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  /** Mostrar abierto al cargar la página. Default false. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * Sección colapsable de detalle del VAT Summary. Header con título +
 * subtítulo (típicamente "X items, total B/. X,XXX.XX"). El cuerpo se monta
 * pero se oculta vía display:none — así la primera apertura no fetchea nada
 * (todo el detalle ya viene server-side renderizado).
 */
export function DetailSection({ title, subtitle, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50 rounded-xl"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0">
          {open ? (
            <ChevronDown size={18} className="shrink-0 text-integra-navy" />
          ) : (
            <ChevronRight size={18} className="shrink-0 text-gray-500" />
          )}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-integra-navy">{title}</h2>
            {subtitle && (
              <p className="text-xs text-gray-500">{subtitle}</p>
            )}
          </div>
        </div>
      </button>
      <div className={open ? "border-t" : "hidden"}>
        {children}
      </div>
    </section>
  );
}
