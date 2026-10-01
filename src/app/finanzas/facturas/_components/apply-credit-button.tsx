"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtImporte } from "@/lib/utils/importe";

interface Props {
  paymentId: string;
  paymentNumber: string | null;
  invoiceId: string;
  /** Lo que se aplica: el menor entre el saldo a favor y el saldo de la factura. */
  monto: number;
}

/**
 * «Aplicar saldo a favor» (074): consume el saldo sin aplicar de un cobro del
 * mismo cliente contra esta factura. Sin asiento: el dinero ya está en 100004.
 * Sin diálogo del navegador: el botón dice exactamente qué va a hacer.
 */
export function ApplyCreditButton({ paymentId, paymentNumber, invoiceId, monto }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function aplicar() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/payments/${paymentId}/apply-credit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applications: [{ invoice_id: invoiceId, amount: monto }] }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo aplicar el saldo a favor.");
          return;
        }
        router.refresh();
      } catch {
        setError("Error de red. Intente de nuevo.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" onClick={aplicar} disabled={isPending} className="min-h-[44px] gap-1.5">
        {isPending ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
        Aplicar B/. {fmtImporte(monto)} de {paymentNumber ?? "el cobro"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
