"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Reintento del envío a la DGI desde la lista de pendientes (03/10/2026).
 * Usa los mismos endpoints que el detalle del documento; el servidor vuelve a
 * validar, bloquea el mes anterior y guarda el motivo si no autoriza.
 */
export function ReintentarEnvioDgi({
  tipo,
  id,
  numero,
  esReintento,
}: {
  tipo: "factura" | "nota_debito" | "nota_credito";
  id: string;
  numero: string;
  esReintento: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const endpoint =
    tipo === "nota_credito" ? `/api/finanzas/credit-notes/${id}/emit` : `/api/finanzas/invoices/${id}/emit-efactura`;

  function enviar() {
    setMensaje(null);
    startTransition(async () => {
      try {
        const res = await fetch(endpoint, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMensaje({ ok: false, texto: data.error ?? "No se pudo enviar a la DGI." });
        } else if (data.feEstado === "authorized" || data.ok === true) {
          setMensaje({ ok: true, texto: `${numero} autorizada por la DGI.` });
        } else {
          setMensaje({ ok: false, texto: data.errorMessage ?? data.mensaje ?? "La DGI no la autorizó. El motivo quedó guardado." });
        }
        setConfirmando(false);
        router.refresh();
      } catch {
        setMensaje({ ok: false, texto: "Error de red. Intenta de nuevo." });
      }
    });
  }

  return (
    <div className="space-y-1">
      {confirmando ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-700">¿Enviar {numero} a la DGI?</span>
          <Button type="button" size="sm" onClick={enviar} disabled={isPending} className="min-h-[40px] gap-1">
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Sí, enviar
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirmando(false)} disabled={isPending} className="min-h-[40px]">
            Cancelar
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmando(true)} className="min-h-[40px] gap-1">
          <RefreshCw size={14} />
          {esReintento ? "Reintentar" : "Enviar a la DGI"}
        </Button>
      )}
      {mensaje && (
        <p className={`whitespace-pre-line text-xs ${mensaje.ok ? "text-emerald-700" : "text-red-700"}`}>{mensaje.texto}</p>
      )}
    </div>
  );
}
