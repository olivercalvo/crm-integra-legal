"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  link: string;
}

/**
 * Display copy-paste del enlace público del portal del cliente. Se muestra
 * en el detalle cuando status='enviada'.
 *
 * El banner D4 que vivía acá decía que el portal "estará disponible en una
 * próxima actualización". Quedó desactualizado cuando la Fase 2E.4 lo puso en
 * marcha, y siguió mintiendo hasta el 02/09/2026: el enlace ya viaja dentro del
 * correo de la cotización (`quote-email-template`, en el HTML y en el texto
 * plano), y el cliente acepta o rechaza desde ahí con firma electrónica.
 *
 * Esta pantalla NO sabe si el correo salió — `email_sent` es el resultado del
 * POST /send, no una columna de `quotes` —, así que el texto está redactado para
 * ser cierto en los dos casos. El aviso de "el correo no salió, hay que mandar
 * el enlace a mano" vive donde ese dato existe: `send-quote-dialog`.
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
      <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
        <ExternalLink size={12} className="mt-0.5 shrink-0 text-gray-400" />
        <p>
          Este es el enlace del portal que acompaña al correo de la cotización.
          Está acá por si hace falta hacérselo llegar al cliente por otro medio.
          Desde el portal el cliente acepta o rechaza con su firma electrónica y
          la cotización cambia de estado sola.
        </p>
      </div>
    </div>
  );
}
