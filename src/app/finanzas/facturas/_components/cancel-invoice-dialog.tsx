"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XCircle, AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { Label } from "@/components/ui/label";
import {
  INVOICE_KIND_LABEL,
  type InvoiceKind,
  type FeEstado,
} from "@/lib/finanzas/types/invoice";
import {
  invoiceHasAuthorizedCufe,
  isCancelConfirmDisabled,
} from "./cancel-invoice-dialog.logic";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  invoiceKind: InvoiceKind;
  grandTotal: number;
  /** Total ya pagado en B/. Si > 0, el dialog se renderiza en modo bloqueo
   *  (sin textarea, mensaje pidiendo eliminar pagos primero). Sprint 2C, D3.d. */
  amountPaid: number;
  /** Estado eFactura de la factura. Junto con `dgiCufe` determina si la
   *  factura ya tiene CUFE autorizado por la DGI (→ disclaimer + checkbox). */
  feEstado?: FeEstado | null;
  /** CUFE registrado (vía PAC o carga manual). Ver `feEstado`. */
  dgiCufe?: string | null;
  disabled?: boolean;
}

/**
 * Botón "Anular factura" + modal con captura de razón. Es la única vía de
 * anulación post-emisión que tienen las abogadas (no hay acceso SQL en prod).
 *
 * Sprint 2C cambios:
 *   - Si amountPaid > 0: dialog en modo bloqueo, sin textarea, con mensaje
 *     pidiendo eliminar los pagos antes de anular.
 *   - Si OK: agrega nota explicando que se generará una NC automáticamente.
 *   - Tras success, redirige al detalle (router.refresh) que ahora muestra
 *     la card con la NC + botón "Ver PDF".
 */
export function CancelInvoiceDialog({
  invoiceId,
  invoiceNumber,
  invoiceKind,
  grandTotal,
  amountPaid,
  feEstado,
  dgiCufe,
  disabled,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [observations, setObservations] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [observationsError, setObservationsError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Confirmación DGI: solo relevante para facturas con CUFE autorizado.
  const [dgiConfirmed, setDgiConfirmed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const OBSERVATIONS_MAX = 2000;

  // ¿La factura ya tiene CUFE autorizado por la DGI? Anularla acá NO la anula
  // ante la DGI (cancelInvoice sólo cambia estado local) → disclaimer + checkbox.
  const hasCufe = invoiceHasAuthorizedCufe(feEstado, dgiCufe);

  // Autofocus al textarea cuando se abre el dialog. Pequeño delay para que
  // el render del modal termine antes; sin él el focus se pierde porque el
  // ConfirmationModal se monta después del onClick.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const trimmedLen = reason.trim().length;
  const meetsMinimum = trimmedLen >= 3;
  const REASON_MAX = 1000;
  const isBlocked = amountPaid > 0.001;

  function reset() {
    setReason("");
    setObservations("");
    setReasonError(null);
    setObservationsError(null);
    setSubmitError(null);
    setDgiConfirmed(false);
  }

  function submit() {
    setReasonError(null);
    setObservationsError(null);
    setSubmitError(null);

    // Guardia defensiva: el botón ya está deshabilitado sin el checkbox, pero
    // evitamos cualquier submit programático si falta la confirmación DGI.
    if (hasCufe && !dgiConfirmed) {
      return;
    }

    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setReasonError("La razón de anulación debe tener al menos 3 caracteres.");
      return;
    }
    const trimmedObs = observations.trim();
    if (trimmedObs.length > OBSERVATIONS_MAX) {
      setObservationsError(
        `Las observaciones no pueden tener más de ${OBSERVATIONS_MAX} caracteres.`
      );
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/invoices/${invoiceId}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: trimmed,
            observations: trimmedObs || null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Si vino fieldErrors del backend, mostralos en el campo correspondiente.
          if (data.fieldErrors?.reason) {
            setReasonError(data.fieldErrors.reason);
          }
          if (data.fieldErrors?.observations) {
            setObservationsError(data.fieldErrors.observations);
          }
          setSubmitError(data.error ?? "No se pudo anular la factura.");
          return;
        }

        // Éxito: cerrar modal + propagar via URL param para que el toast
        // surface el mensaje. router.refresh recarga el server component.
        setOpen(false);
        const url = new URL(window.location.href);
        url.searchParams.set("cancelled", "1");
        router.replace(url.pathname + url.search, { scroll: false });
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intenta de nuevo.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        disabled={disabled || isPending}
        className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 min-h-[48px]"
      >
        <XCircle size={16} className="mr-2" />
        Anular factura
      </Button>

      <ConfirmationModal
        open={open}
        onClose={() => {
          if (!isPending) {
            setOpen(false);
            reset();
          }
        }}
        onConfirm={isBlocked ? () => setOpen(false) : submit}
        loading={isPending}
        confirmDisabled={
          !isBlocked && isCancelConfirmDisabled({ hasCufe, dgiConfirmed })
        }
        title={isBlocked ? "No se puede anular" : "Anular factura"}
        confirmButtonText={
          isBlocked
            ? "Entendido"
            : isPending
              ? "Anulando…"
              : "Sí, anular y generar nota de crédito"
        }
        cancelButtonText={isBlocked ? "Cerrar" : "Cancelar"}
      >
        <div className="space-y-4">
          {/* MODO BLOQUEO: la factura tiene pagos aplicados */}
          {isBlocked ? (
            <>
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
              >
                <AlertTriangle
                  size={16}
                  className="mt-0.5 shrink-0 text-amber-600"
                />
                <div>
                  <p className="font-semibold">
                    Esta factura tiene B/. {amountPaid.toFixed(2)} en pagos
                    registrados.
                  </p>
                  <p className="mt-1">
                    Para anular esta factura, elimina primero los pagos uno
                    por uno desde la sección &quot;Pagos registrados&quot;.
                    Una vez que el saldo pagado vuelva a cero, vas a poder
                    anular la factura y se generará una nota de crédito
                    automáticamente.
                  </p>
                </div>
              </div>
              <div className="rounded-md border bg-gray-50 p-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Número</span>
                  <span className="font-mono font-semibold text-integra-navy">
                    {invoiceNumber}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Total facturado</span>
                  <span className="font-mono text-gray-900">
                    ${grandTotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="text-amber-700 font-semibold">
                    Total pagado
                  </span>
                  <span className="font-mono font-semibold text-amber-700">
                    ${amountPaid.toFixed(2)}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* DISCLAIMER DGI: solo para facturas con CUFE autorizado.
                  Anular en el CRM NO notifica a la DGI. */}
              {hasCufe && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  <AlertTriangle
                    size={16}
                    className="mt-0.5 shrink-0 text-amber-600"
                  />
                  <p>
                    Esta factura ya fue autorizada por la DGI. Anularla aquí
                    solo la marca como anulada en el CRM; no la anula ante la
                    DGI. Para anularla oficialmente, primero debes anularla en
                    el portal de eFactura PTY (admin.efacturapty.com). Ten en
                    cuenta que la DGI tiene una ventana de tiempo limitada para
                    anular desde la autorización.
                  </p>
                </div>
              )}

              {/* MODO ANULACIÓN: factura sin pagos */}
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-900"
              >
                <AlertTriangle
                  size={16}
                  className="mt-0.5 shrink-0 text-red-600"
                />
                <div>
                  <p>
                    <span className="font-semibold">
                      Esta acción es irreversible.
                    </span>{" "}
                    La factura quedará marcada como anulada y se generará una{" "}
                    <span className="font-semibold">nota de crédito</span>{" "}
                    automáticamente para reversar contablemente la operación.
                  </p>
                </div>
              </div>

              {/* Card con info de la factura */}
              <div className="rounded-md border bg-gray-50 p-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Número</span>
                  <span className="font-mono font-semibold text-integra-navy">
                    {invoiceNumber}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Tipo</span>
                  <span className="font-medium text-gray-900">
                    {INVOICE_KIND_LABEL[invoiceKind]}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="text-gray-500">Total</span>
                  <span className="font-mono font-semibold text-gray-900">
                    ${grandTotal.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Form: textarea con razón */}
              <div>
                <Label htmlFor="cancel_reason" className="text-sm">
                  Razón de anulación{" "}
                  <span className="text-red-600" aria-hidden="true">
                    *
                  </span>
                </Label>
                <textarea
                  id="cancel_reason"
                  ref={textareaRef}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    if (reasonError) setReasonError(null);
                  }}
                  disabled={isPending}
                  rows={3}
                  maxLength={REASON_MAX}
                  placeholder="Ej: Datos del receptor incorrectos, error en el monto…"
                  className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm bg-white focus:outline-none focus:border-integra-navy ${
                    reasonError
                      ? "border-red-300"
                      : "border-gray-300 hover:border-integra-navy"
                  }`}
                />
                <div className="mt-1 flex items-start justify-between gap-3">
                  <p
                    className={`text-xs ${
                      reasonError ? "text-red-600" : "text-gray-500"
                    }`}
                  >
                    {reasonError ??
                      "Esta razón se incluye en la nota de crédito y queda registrada permanentemente."}
                  </p>
                  <span
                    aria-live="polite"
                    className={`shrink-0 text-xs font-mono ${
                      trimmedLen === 0
                        ? "text-gray-400"
                        : meetsMinimum
                          ? "text-gray-500"
                          : "text-amber-600"
                    }`}
                  >
                    {trimmedLen}/{REASON_MAX}
                  </span>
                </div>
              </div>

              {/* Observaciones adicionales (Sprint QUOTES-POLISH D7) */}
              <div>
                <Label htmlFor="cancel_observations" className="text-sm">
                  Observaciones adicionales{" "}
                  <span className="text-gray-400 font-normal">(opcional)</span>
                </Label>
                <textarea
                  id="cancel_observations"
                  value={observations}
                  onChange={(e) => {
                    setObservations(e.target.value);
                    if (observationsError) setObservationsError(null);
                  }}
                  disabled={isPending}
                  rows={3}
                  maxLength={OBSERVATIONS_MAX + 20}
                  placeholder="Detalles adicionales que quieres que aparezcan en el PDF de la nota de crédito (opcional)."
                  className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm bg-white focus:outline-none focus:border-integra-navy ${
                    observationsError
                      ? "border-red-300"
                      : "border-gray-300 hover:border-integra-navy"
                  }`}
                />
                <div className="mt-1 flex items-start justify-between gap-3">
                  <p
                    className={`text-xs ${
                      observationsError ? "text-red-600" : "text-gray-500"
                    }`}
                  >
                    {observationsError ??
                      "Aparecen en el PDF de la nota de crédito junto al motivo."}
                  </p>
                  <span
                    aria-live="polite"
                    className={`shrink-0 text-xs font-mono ${
                      observations.trim().length > OBSERVATIONS_MAX
                        ? "text-red-600"
                        : "text-gray-400"
                    }`}
                  >
                    {observations.length.toLocaleString("es-PA")}/
                    {OBSERVATIONS_MAX.toLocaleString("es-PA")}
                  </span>
                </div>
              </div>

              {/* CHECKBOX DGI obligatorio: solo para facturas con CUFE.
                  Habilita el botón "confirmar" recién al marcarlo. */}
              {hasCufe && (
                <label
                  htmlFor="cancel_dgi_confirmed"
                  className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900 cursor-pointer"
                >
                  <input
                    id="cancel_dgi_confirmed"
                    type="checkbox"
                    checked={dgiConfirmed}
                    onChange={(e) => setDgiConfirmed(e.target.checked)}
                    disabled={isPending}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-integra-navy"
                  />
                  <span>
                    Confirmo que ya anulé esta factura en el portal de la DGI
                    (o que soy consciente de que debo hacerlo).
                  </span>
                </label>
              )}

              {/* Error del backend (solo si no es field-level) */}
              {submitError && (
                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              {isPending && (
                <p className="text-xs text-gray-500 inline-flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" />
                  Anulando y generando nota de crédito…
                </p>
              )}
            </>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}
