"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface CodRes {
  dCodRes?: string;
  dMsgRes?: string;
}

/**
 * Subset del payload EmitToEfacturaResult definido en
 * src/lib/finanzas/efactura/orchestration/emit-invoice-to-efactura.ts.
 * Solo consumimos los campos que afectan al toast/redirect — el resto
 * los lee el server component tras router.refresh().
 */
interface EmitToEfacturaResult {
  feEstado: "authorized" | "pending" | "error";
  errorKind: "pac_rejected" | "pac_duplicate" | "transport" | null;
  errorMessage: string | null;
  codRes: CodRes[];
}

interface Props {
  invoiceId: string;
  /** Número interno ya asignado (ej. FAC-HON-000123). Para preview en modal. */
  invoiceNumber: string;
  /** Total fiscal en USD. */
  grandTotal: number;
  /** RUC del receptor (puede ser null si el cliente no tiene tax_id). */
  receptorRuc: string | null;
  /** Nombre del cliente — solo para preview. */
  receptorNombre: string | null;
  /** Si es un reintento tras error previo, copy del CTA cambia. */
  isRetry: boolean;
  disabled?: boolean;
}

/**
 * Botón "Enviar al PAC" + modal de confirmación con preview de receptor/total
 * y advertencia fiscal. Dispara POST /api/finanzas/invoices/[id]/emit-efactura.
 *
 * Comportamiento por feEstado de la respuesta:
 *   - authorized → cierra modal + ?fe=sent + router.refresh()
 *   - pending    → cierra modal + ?fe=pending + router.refresh()
 *   - error      → DEJA el modal abierto y pinta detalle (errorMessage +
 *                  codRes[]). El usuario decide cerrar manualmente.
 *
 * El gate de visibilidad (status='emitida' && fe_estado IN ('no_emitida',
 * 'error')) lo evalúa el caller; este componente solo se renderiza si
 * el envío es legal.
 */
export function EmitEfacturaDialog({
  invoiceId,
  invoiceNumber,
  grandTotal,
  receptorRuc,
  receptorNombre,
  isRetry,
  disabled,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [codRes, setCodRes] = useState<CodRes[]>([]);
  const [errorKind, setErrorKind] = useState<
    "pac_rejected" | "pac_duplicate" | "transport" | null
  >(null);

  const ctaLabel = isRetry ? "Reintentar envío" : "Enviar al PAC";
  const ctaIcon = isRetry ? RotateCw : Send;
  const Icon = ctaIcon;

  function submit() {
    setError(null);
    setCodRes([]);
    setErrorKind(null);

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/finanzas/invoices/${invoiceId}/emit-efactura`,
          { method: "POST" }
        );
        const data = await res.json().catch(() => ({}));

        // 400/403/409/500 — error de pre-condición o sistémico (NO es
        // "PAC rechazó"). El backend devuelve { error: string }.
        if (!res.ok) {
          setError(data.error ?? "No se pudo enviar al PAC.");
          return;
        }

        // 200 OK con EmitToEfacturaResult. Tres caminos:
        const result = data as EmitToEfacturaResult;

        if (result.feEstado === "authorized") {
          setOpen(false);
          const url = new URL(window.location.href);
          url.searchParams.set("fe", "sent");
          router.replace(url.pathname + url.search, { scroll: false });
          router.refresh();
          return;
        }

        if (result.feEstado === "pending") {
          setOpen(false);
          const url = new URL(window.location.href);
          url.searchParams.set("fe", "pending");
          router.replace(url.pathname + url.search, { scroll: false });
          router.refresh();
          return;
        }

        // result.feEstado === 'error' → dejar modal abierto con detalles
        setError(result.errorMessage ?? "El PAC rechazó la factura.");
        setCodRes(result.codRes ?? []);
        setErrorKind(result.errorKind);
        // refrescamos en segundo plano para que la card del detalle
        // pase a estado 'error' aunque el usuario no cierre el modal
        router.refresh();
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setError(null);
          setCodRes([]);
          setErrorKind(null);
          setOpen(true);
        }}
        disabled={disabled || isPending}
        className="bg-integra-gold text-integra-navy hover:bg-integra-gold/90 min-h-[48px]"
      >
        <Icon size={16} className="mr-2" />
        {ctaLabel}
      </Button>

      <ConfirmationModal
        open={open}
        onClose={() => !isPending && setOpen(false)}
        onConfirm={submit}
        loading={isPending}
        title={isRetry ? "Reintentar envío al PAC" : "Enviar al PAC eFactura"}
        confirmButtonText={
          isRetry ? "Sí, reintentar envío" : "Sí, enviar al PAC"
        }
        cancelButtonText="Cerrar"
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Esta acción registra la factura ante la DGI a través del PAC
            autorizado. Una vez autorizada, los datos fiscales (CUFE,
            protocolo, fecha) quedan registrados oficialmente.
          </p>

          <div className="rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              <span className="font-semibold">Verifica antes de enviar.</span>{" "}
              Si el receptor o los montos están incorrectos, la corrección
              tendrá que hacerse en eFactura (no en el CRM).
            </p>
          </div>

          <div className="rounded-md border bg-gray-50 p-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Factura</span>
              <span className="font-mono font-semibold text-integra-navy truncate">
                {invoiceNumber}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Receptor</span>
              <span className="font-medium text-gray-900 truncate text-right">
                {receptorNombre ?? "—"}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">RUC receptor</span>
              <span className="font-mono text-gray-900 truncate">
                {receptorRuc ?? (
                  <span className="italic text-red-600">sin RUC</span>
                )}
              </span>
            </div>
            <div className="flex justify-between gap-3 border-t pt-2">
              <span className="text-gray-500">Total</span>
              <span className="font-mono font-semibold text-gray-900">
                ${grandTotal.toFixed(2)}
              </span>
            </div>
          </div>

          {error && (
            <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span className="font-medium">{error}</span>
              </div>
              {errorKind === "pac_duplicate" && (
                <p className="text-xs italic">
                  Es posible que un envío anterior haya quedado autorizado en
                  DGI. Revisa el portal eFactura antes de reintentar.
                </p>
              )}
              {codRes.length > 0 && (
                <ul className="ml-6 list-disc space-y-0.5 text-xs">
                  {codRes.map((c, i) => (
                    <li key={i}>
                      {c.dCodRes ? (
                        <span className="font-mono font-semibold">
                          {c.dCodRes}
                        </span>
                      ) : null}
                      {c.dCodRes && c.dMsgRes ? ": " : null}
                      {c.dMsgRes ?? ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isPending && (
            <p className="text-xs text-gray-500 inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Enviando al PAC…
            </p>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}
