"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";

interface Props {
  content: string;
}

const PREVIEW_CHARS = 200;

/**
 * Muestra los T&C de una cotización con expand/collapse. Por defecto muestra
 * los primeros ~200 caracteres + "Ver más". Si el contenido es más corto que
 * el límite, no muestra el toggle.
 */
export function QuoteTermsCollapsible({ content }: Props) {
  const [open, setOpen] = useState(false);
  const text = content?.trim() ?? "";
  const isLong = text.length > PREVIEW_CHARS;
  const preview = isLong ? `${text.slice(0, PREVIEW_CHARS)}…` : text;

  if (!text) {
    return (
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <FileText size={16} className="text-integra-gold" />
          <h2 className="text-base font-semibold text-integra-navy">
            Términos y Condiciones
          </h2>
        </div>
        <p className="text-sm italic text-gray-400">
          Esta cotización no tiene Términos y Condiciones registrados.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-integra-gold" />
          <h2 className="text-base font-semibold text-integra-navy">
            Términos y Condiciones
          </h2>
        </div>
        {isLong && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-integra-navy hover:underline"
          >
            {open ? (
              <>
                Ver menos <ChevronUp size={14} />
              </>
            ) : (
              <>
                Ver más <ChevronDown size={14} />
              </>
            )}
          </button>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm text-gray-700">
        {open ? text : preview}
      </p>
    </div>
  );
}
