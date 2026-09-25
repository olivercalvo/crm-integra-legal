"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2, AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { Label } from "@/components/ui/label";
import { fmtImporte } from "@/lib/utils/importe";
import { formatDate } from "@/lib/utils/format-date";
import type { AsientoDeCobro } from "@/lib/finanzas/types/payment";
import {
  construirAsientoDeReversion,
  MOTIVO_MAX,
  MOTIVO_MIN,
} from "@/lib/finanzas/contabilidad/reversion";

interface Props {
  paymentId: string;
  /** ej. "B/. 300.00 del 13/05/2026" */
  paymentLabel: string;
  /** El asiento del cobro. Sin asiento no hay reversión: el botón no se ofrece. */
  asiento: AsientoDeCobro;
  invoiceNumber: string;
  disabled?: boolean;
  /**
   * `"cobro"` (default): recibo de caja → `/api/finanzas/payments/[id]/reverse`.
   * `"pago"`: pago a PROVEEDOR (Bloque 3) → `/api/finanzas/supplier-payments/[id]/reverse`.
   * `"gasto"`: GASTO DE TRÁMITE contabilizado (Bloque 4) → `/api/expenses/[id]/reverse`.
   * `"asiento"`: ASIENTO MANUAL (Bloque 7) → `/api/finanzas/asientos/[id]/reverse`.
   * `"nota_credito"`: NOTA DE CRÉDITO (Bloque 9C) → `/api/finanzas/credit-notes/[id]/reverse`.
   * Cambia la ruta y las palabras (cobro/factura ↔ pago/compra ↔ gasto/caso ↔
   * asiento/libro ↔ nota de crédito/factura). La vista previa es la MISMA
   * función para las cinco: `reversion-una-sola-implementacion` lo vigila
   * leyendo este archivo.
   */
  variante?: "cobro" | "pago" | "gasto" | "asiento" | "nota_credito";
  /**
   * Mínimo del motivo, si es mayor que `MOTIVO_MIN`. Lo usa la NC autorizada:
   * su motivo viaja a la DGI como `cancellationReason`, que exige 15.
   */
  motivoMinimo?: number;
  /** Texto de la matriz fiscal que explica qué va a pasar (NC). Se muestra tal cual. */
  aviso?: string;
}

const TEXTOS = {
  cobro: {
    endpoint: (id: string) => `/api/finanzas/payments/${id}/reverse`,
    cosa: "cobro",
    aplicadoA: "aplicado a",
    consecuencia: "el cobro queda anulado y la factura vuelve a mostrar el saldo pendiente",
    siOcurrio: "si el cobro sí ocurrió, hay que registrarlo de nuevo",
    titulo: "Reversar cobro",
    placeholder: "Ej: Cheque devuelto por el banco, cobro registrado a la factura equivocada…",
    error: "No se pudo reversar el cobro.",
    enCurso: "Posteando el espejo y liberando la factura…",
  },
  pago: {
    endpoint: (id: string) => `/api/finanzas/supplier-payments/${id}/reverse`,
    cosa: "pago",
    aplicadoA: "aplicado a",
    consecuencia: "el pago queda anulado y la compra vuelve a mostrar el saldo pendiente",
    siOcurrio: "si el pago sí ocurrió, hay que registrarlo de nuevo",
    titulo: "Reversar pago",
    placeholder: "Ej: Transferencia rechazada, pago registrado a la compra equivocada…",
    error: "No se pudo reversar el pago.",
    enCurso: "Posteando el espejo y devolviendo el saldo a la compra…",
  },
  gasto: {
    endpoint: (id: string) => `/api/expenses/${id}/reverse`,
    cosa: "gasto de trámite",
    aplicadoA: "del caso",
    consecuencia: "el gasto queda anulado y sale de la cuenta por pagar",
    siOcurrio: "si el gasto sí ocurrió, hay que registrarlo de nuevo desde el caso",
    titulo: "Reversar gasto de trámite",
    placeholder: "Ej: Gasto cargado al caso equivocado, monto mal tipeado…",
    error: "No se pudo reversar el gasto.",
    enCurso: "Posteando el espejo y anulando el gasto…",
  },
  asiento: {
    endpoint: (id: string) => `/api/finanzas/asientos/${id}/reverse`,
    cosa: "asiento",
    aplicadoA: "del libro",
    // Un asiento manual no tiene documento que actualizar: el efecto empieza y
    // termina en el libro, y decirlo así evita que alguien espere otra cosa.
    consecuencia: "el asiento queda reflejado por su espejo y el efecto neto sobre las cuentas vuelve a cero",
    siOcurrio: "si la operación sí ocurrió, hay que cargar el asiento corregido",
    titulo: "Reversar asiento",
    placeholder: "Ej: Cuenta equivocada, importe mal tipeado, asiento duplicado…",
    error: "No se pudo reversar el asiento.",
    enCurso: "Posteando el espejo en el libro…",
  },
  /**
   * Bloque 9C. La consecuencia que se nombra es la que la persona va a ir a
   * mirar: **la factura recupera su saldo**. El saldo no se escribe —lo
   * recalcula el trigger de la 051 cuando la NC queda anulada— pero eso es un
   * detalle de implementación y no lo que hay que decir en un modal.
   *
   * Si la NC está autorizada, la ruta la anula PRIMERO ante la DGI y después
   * reversa el libro (`reversarNotaDeCredito`, 25/09/2026). El detalle le pasa
   * a este diálogo el aviso de la matriz y el mínimo de 15 del motivo.
   */
  nota_credito: {
    endpoint: (id: string) => `/api/finanzas/credit-notes/${id}/reverse`,
    cosa: "nota de crédito",
    aplicadoA: "de la factura",
    consecuencia: "la nota de crédito queda anulada y la factura recupera su saldo",
    siOcurrio: "si había que acreditar, hay que emitir otra nota de crédito",
    titulo: "Reversar nota de crédito",
    placeholder: "Ej: Nota de crédito emitida a la factura equivocada, monto mal tipeado…",
    error: "No se pudo reversar la nota de crédito.",
    enCurso: "Posteando el espejo y devolviendo el saldo a la factura…",
  },
} as const;

/**
 * Botón "Reversar" + modal con motivo y VISTA PREVIA del asiento espejo.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 LA VISTA PREVIA SALE DE `construirAsientoDeReversion`, LA MISMA FUNCIÓN
 * QUE USA EL SERVIDOR. NO SE REIMPLEMENTA ACÁ.
 * ═════════════════════════════════════════════════════════════════════════════
 * Este componente no intercambia débito y crédito por su cuenta, no arma la
 * descripción, no decide la fecha: le pasa el asiento original y el motivo a
 * la función pura de `contabilidad/reversion.ts` y dibuja lo que devuelve. La
 * ruta `/api/finanzas/payments/[id]/reverse` le pasa lo mismo a la misma
 * función y postea el resultado. Lo que se ve es lo que se postea.
 *
 * Hay un test que lee este archivo y falla si deja de ser así
 * (`reversion-una-sola-implementacion.test.ts`).
 */
export function ReversePaymentDialog({
  paymentId,
  paymentLabel,
  asiento,
  invoiceNumber,
  disabled,
  variante = "cobro",
  motivoMinimo,
  aviso,
}: Props) {
  const t = TEXTOS[variante];
  const minimo = Math.max(MOTIVO_MIN, motivoMinimo ?? 0);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // "Hoy" con la misma fórmula del servidor (UTC, ISO). Se recalcula al abrir
  // el modal, no al renderizar la página: la pestaña puede llevar horas abierta.
  const [hoy, setHoy] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!open) return;
    setHoy(new Date().toISOString().slice(0, 10));
    const t = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // La vista previa. Con motivo vacío la función rechaza (motivo corto), así
  // que para DIBUJAR las líneas se le pasa un motivo de relleno: las líneas y
  // la fecha no dependen del motivo. Lo que se manda al servidor es el real.
  const preview = useMemo(
    () =>
      construirAsientoDeReversion(asiento, {
        hoy,
        motivo: "(vista previa)",
        source_id: paymentId,
      }),
    [asiento, hoy, paymentId]
  );

  const trimmedLen = reason.trim().length;
  const meetsMinimum = trimmedLen >= minimo;

  function reset() {
    setReason("");
    setReasonError(null);
    setSubmitError(null);
  }

  function submit() {
    setReasonError(null);
    setSubmitError(null);

    const trimmed = reason.trim();
    if (trimmed.length < minimo) {
      setReasonError(`El motivo debe tener al menos ${minimo} caracteres.`);
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(t.endpoint(paymentId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: trimmed }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.fieldErrors?.reason) setReasonError(data.fieldErrors.reason);
          setSubmitError(data.error ?? t.error);
          return;
        }
        setOpen(false);
        reset();
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intente de nuevo.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        disabled={disabled || isPending}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Reversar ${t.cosa} de ${paymentLabel}`}
        title={`Reversar este ${t.cosa} (asiento ${asiento.entry_number})`}
      >
        <Undo2 size={14} />
        Reversar
      </button>

      <ConfirmationModal
        open={open}
        onClose={() => {
          if (!isPending) {
            setOpen(false);
            reset();
          }
        }}
        onConfirm={submit}
        loading={isPending}
        confirmDisabled={!meetsMinimum || !preview.ok}
        title={t.titulo}
        confirmButtonText={isPending ? "Reversando…" : "Sí, reversar y postear el espejo"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-4">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p>
                Vas a reversar el {t.cosa} de{" "}
                <span className="font-semibold text-integra-navy">{paymentLabel}</span>{" "}
                {t.aplicadoA} <span className="font-mono font-semibold">{invoiceNumber}</span>.
              </p>
              <p>
                El asiento <span className="font-mono">{asiento.entry_number}</span> no se
                borra: se postea su <span className="font-semibold">espejo</span> con la
                fecha de hoy, {t.consecuencia}. Es irreversible: {t.siOcurrio}.
              </p>
            </div>
          </div>

          {aviso && (
            <p className="rounded-md border border-integra-navy/20 bg-integra-navy/[0.03] p-3 text-sm text-integra-navy">
              {aviso}
            </p>
          )}

          {/* Motivo */}
          <div>
            <Label htmlFor="reverse_reason" className="text-sm">
              Motivo de la reversión{" "}
              <span className="text-red-600" aria-hidden="true">
                *
              </span>
            </Label>
            <textarea
              id="reverse_reason"
              ref={textareaRef}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(null);
              }}
              disabled={isPending}
              rows={2}
              maxLength={MOTIVO_MAX}
              placeholder={t.placeholder}
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm bg-white focus:outline-none focus:border-integra-navy ${
                reasonError ? "border-red-300" : "border-gray-300 hover:border-integra-navy"
              }`}
            />
            <div className="mt-1 flex items-start justify-between gap-3">
              <p className={`text-xs ${reasonError ? "text-red-600" : "text-gray-500"}`}>
                {reasonError ??
                  (minimo > MOTIVO_MIN
                    ? `Mínimo ${minimo} caracteres: lo exige la DGI para anular un documento electrónico.`
                    : "Queda escrito en el asiento espejo y es obligatorio por ley (DE 34/1998, Art. 5.7).")}
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
                {trimmedLen}/{MOTIVO_MAX}
              </span>
            </div>
          </div>

          {/* Vista previa del espejo — calculada por la MISMA función del servidor */}
          <div className="rounded-md border bg-gray-50 p-3 text-sm">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Asiento que se va a postear
              </span>
              <span className="text-xs text-gray-500">
                Fecha: <span className="font-mono text-gray-700">{formatDate(hoy)}</span>
              </span>
            </div>
            {preview.ok ? (
              <>
                <p className="mb-2 text-xs text-gray-600">{preview.asiento.description}</p>
                <table className="w-full text-xs">
                  <thead className="text-left uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="pb-1 pr-2 font-semibold">Cuenta</th>
                      <th className="pb-1 pr-2 text-right font-semibold">Débito</th>
                      <th className="pb-1 text-right font-semibold">Crédito</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {preview.asiento.lines.map((l, i) => (
                      <tr key={`${l.account_code}-${i}`}>
                        <td className="py-1 pr-2 text-gray-800">
                          <span className="font-mono">{l.account_code}</span>
                          {asiento.lines[i]?.account_name && (
                            <span className="ml-1 text-gray-500">
                              {asiento.lines[i].account_name}
                            </span>
                          )}
                        </td>
                        <td className="py-1 pr-2 text-right font-mono">
                          {l.debit > 0 ? fmtImporte(l.debit) : ""}
                        </td>
                        <td className="py-1 text-right font-mono">
                          {l.credit > 0 ? fmtImporte(l.credit) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="text-xs text-red-700">{preview.mensaje}</p>
            )}
          </div>

          {submitError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {isPending && (
            <p className="inline-flex items-center gap-1 text-xs text-gray-500">
              <Loader2 size={12} className="animate-spin" />
              {t.enCurso}
            </p>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}
