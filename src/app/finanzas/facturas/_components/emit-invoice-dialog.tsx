"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { INVOICE_KIND_LABEL, type InvoiceKind } from "@/lib/finanzas/types/invoice";
import { fmtImporte } from "@/lib/utils/importe";
import { SelectorDeEnvio, type ModoDeEnvio } from "@/components/finanzas/selector-de-envio";

interface Props {
  invoiceId: string;
  invoiceKind: InvoiceKind;
  /** Preview del próximo número (puede ser null si la query falló). */
  nextNumberPreview: string | null;
  /** Total a emitir, en USD. Para mostrar al confirmar. */
  grandTotal: number;
  disabled?: boolean;
  /**
   * El documento no se puede mandar a la DGI desde el sistema (hoy, la nota de
   * débito: `PERMITIR_ND_A_LA_DGI`). Lo decide la página, que es server: este
   * componente no importa el orquestador.
   */
  sinDgi?: boolean;
  /**
   * La NOTA DE DÉBITO elige al emitir «Enviar a la DGI» o «Interna»
   * (03/10/2026). Una factura sigue como siempre: emitir y después enviar.
   */
  elegirEnvio?: boolean;
}

/**
 * Botón "Emitir" + modal de confirmación con preview del número.
 *
 * El preview es informativo: si entre el render y el click otra factura
 * consume la secuencia, el número final puede diferir. La app muestra el
 * número definitivo después del POST exitoso.
 */
export function EmitInvoiceDialog({
  invoiceId,
  invoiceKind,
  nextNumberPreview,
  grandTotal,
  disabled,
  sinDgi = false,
  elegirEnvio = false,
}: Props) {
  const [envio, setEnvio] = useState<ModoDeEnvio | null>(null);
  // «factura» o «nota de débito»: los dos son femeninos, el resto del texto no cambia.
  const nombre = invoiceKind === "NOTA_DEBITO" ? "nota de débito" : "factura";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function emit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/invoices/${invoiceId}/emit`, {
          method: "POST",
          ...(elegirEnvio
            ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ envio }) }
            : {}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? `No se pudo emitir la ${nombre}`);
          return;
        }
        setOpen(false);
        // Propagar número emitido vía URL para que InvoiceSuccessToast lo
        // surface en el detalle. router.refresh recarga la data.
        const num = data.invoice_number as string | undefined;
        // Eligió la DGI y el envío no terminó bien: el documento igual quedó
        // emitido; el detalle lo avisa y la tarjeta ofrece reintentar.
        const fallo = data.envio?.envio === "dgi" && data.envio?.fe && !data.envio.fe.ok;
        if (num) {
          router.push(
            `/finanzas/facturas/${invoiceId}?emitted=${encodeURIComponent(num)}${fallo ? "&envio=fallo" : ""}`
          );
        }
        router.refresh();
      } catch {
        setError("Error de red. Intente de nuevo.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={disabled || isPending}
        className="bg-integra-gold text-integra-navy hover:bg-integra-gold/90 min-h-[48px]"
      >
        <Send size={16} className="mr-2" />
        Emitir {nombre} interna
      </Button>

      <ConfirmationModal
        open={open}
        onClose={() => !isPending && setOpen(false)}
        onConfirm={emit}
        loading={isPending}
        title={`Emitir ${nombre} interna`}
        confirmButtonText={`Sí, emitir ${nombre} interna`}
        cancelButtonText="Cancelar"
        confirmDisabled={elegirEnvio && !envio}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Esta acción asigna el número definitivo y cambia el estado a{" "}
            <span className="font-semibold text-integra-navy">emitida</span>. La{" "}
            {nombre} ya no podrá editarse ni eliminarse.
          </p>

          {elegirEnvio && (
            <SelectorDeEnvio valor={envio} onChange={setEnvio} disabled={isPending} nombre={nombre} />
          )}

          <div
            className={`rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 ${elegirEnvio ? "hidden" : ""}`}
          >
            {sinDgi ? (
              <p>
                <span className="font-semibold">Queda como documento interno.</span>{" "}
                La {nombre} todavía no se envía a la DGI desde el sistema: se registra en
                el libro y vale para la cuenta del cliente.
              </p>
            ) : (
              <p>
                <span className="font-semibold">Todavía no vale ante la DGI.</span>{" "}
                Después de emitirla, envíala a la DGI desde esta misma {nombre} con el
                botón «Enviar a la DGI».
              </p>
            )}
          </div>

          <div className="rounded-md border bg-gray-50 p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Tipo</span>
              <span className="font-medium text-gray-900">
                {INVOICE_KIND_LABEL[invoiceKind]}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Número que se asignará</span>
              <span className="font-mono font-semibold text-integra-navy">
                {nextNumberPreview ?? "—"}
              </span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-gray-500">Total</span>
              <span className="font-mono font-semibold text-gray-900">
                B/. {fmtImporte(grandTotal)}
              </span>
            </div>
          </div>

          {nextNumberPreview && (
            <p className="text-xs text-gray-500">
              El número es preview. Si otro documento del mismo tipo se emite antes,
              el número final será el siguiente disponible.
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isPending && (
            <p className="text-xs text-gray-500 inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Emitiendo…
            </p>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}
