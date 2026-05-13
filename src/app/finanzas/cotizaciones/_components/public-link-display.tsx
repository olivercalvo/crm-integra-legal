"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  link: string;
}

/**
 * Display copy-paste del link público del portal del cliente. Se muestra
 * en el detalle cuando status='enviada'. Incluye el banner D4 sobre que
 * el portal aún no está disponible (Fase 2E.4).
 */
export function PublicLinkDisplay({ link }: Props) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={link}
          className="font-mono text-xs"
          onFocus={(e) => e.target.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copyLink}
          className="shrink-0 min-h-[40px]"
        >
          {copied ? (
            <>
              <Check size={14} className="mr-1 text-green-600" />
              Copiado
            </>
          ) : (
            <>
              <Copy size={14} className="mr-1" />
              Copiar
            </>
          )}
        </Button>
      </div>
      <div
        role="alert"
        className="flex items-start gap-2 rounded-md border-l-4 border-amber-400 bg-amber-50 p-2 text-xs text-amber-900"
      >
        <ExternalLink size={12} className="mt-0.5 shrink-0 text-amber-600" />
        <p>
          El portal público estará disponible en una próxima actualización.
          Por ahora pega este link en el email o WhatsApp que envíes al
          cliente como referencia interna.
        </p>
      </div>
    </div>
  );
}
