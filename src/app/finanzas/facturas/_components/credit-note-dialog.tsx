"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileMinus, AlertCircle, AlertTriangle } from "lucide-react";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { Label } from "@/components/ui/label";
import { fmtImporte } from "@/lib/utils/importe";
import {
  NC_MOTIVO_MAX,
  NC_MOTIVO_MIN,
  errorDeCantidadAcreditable,
  totalDeLineaDeNc,
} from "@/lib/finanzas/validators/credit-note";

/** Una línea de la factura, con lo que todavía se puede acreditar. */
export interface LineaAcreditable {
  invoice_line_id: string;
  line_order: number;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  /** `quantity − ya acreditado por NC anteriores`. 0 = no se ofrece. */
  disponible: number;
}

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  balanceDue: number;
  lineas: LineaAcreditable[];
  /** D4: cuando el mes de la factura está cerrado, este botón reemplaza a "Anular". */
  mesCerrado: boolean;
  disabled?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * EMITIR UNA NOTA DE CRÉDITO por líneas de la factura con cantidad (Bloque 5).
 *
 * Es el camino cuando la factura no se puede anular (mes cerrado, D4) o cuando
 * la corrección es parcial (Josuarth: factura de mil, NC de doscientos). Se
 * marcan las líneas y la cantidad de cada una (máximo: lo facturado menos lo ya
 * acreditado); el precio y la tasa son los de la factura, no se editan. El
 * total se muestra en vivo con su ITBMS proporcional. `POST
 * /api/finanzas/credit-notes` valida de nuevo todo (D7: no más que
 * `balance_due`) y postea el asiento propio de la NC; al terminar se va al
 * detalle de la NC.
 *
 * 🔴 La NC nace como documento INTERNO, sin autorización de la DGI, y el
 * detalle y el PDF lo dicen. Se envía a la DGI desde el detalle de la NC.
 */
export function CreditNoteDialog({ invoiceId, invoiceNumber, balanceDue, lineas, mesCerrado, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const acreditables = lineas.filter((l) => l.disponible > 0.0001);

  const seleccion = useMemo(
    () =>
      acreditables
        .map((l) => ({ linea: l, qty: Number((cantidades[l.invoice_line_id] ?? "").replace(",", ".")) }))
        .filter((x) => isFinite(x.qty) && x.qty > 0),
    [acreditables, cantidades]
  );
  const total = useMemo(
    () => round2(seleccion.reduce((s, x) => s + totalDeLineaDeNc(x.qty, x.linea.unit_price, x.linea.tax_rate), 0)),
    [seleccion]
  );
  const excede = total > balanceDue + 0.005;

  // El tope por línea EN VIVO, con la misma función que el servidor: una
  // cantidad mayor a la disponible se marca en rojo y apaga el botón, en vez
  // de esperar al 400 del POST.
  const erroresEnVivo = useMemo(() => {
    const e: Record<string, string> = {};
    for (const l of acreditables) {
      const v = (cantidades[l.invoice_line_id] ?? "").trim();
      if (v === "") continue;
      const qty = Number(v.replace(",", "."));
      if (!isFinite(qty) || qty <= 0) {
        e[l.invoice_line_id] = "Escribe una cantidad mayor que cero.";
        continue;
      }
      const tope = errorDeCantidadAcreditable({
        descripcion: l.description,
        facturado: l.quantity,
        disponible: l.disponible,
        cantidad: qty,
      });
      if (tope) e[l.invoice_line_id] = tope;
    }
    return e;
  }, [acreditables, cantidades]);
  const hayErrorEnVivo = excede || Object.keys(erroresEnVivo).length > 0;

  function reset() {
    setReason("");
    setCantidades({});
    setFieldErrors({});
    setSubmitError(null);
  }

  function toggle(l: LineaAcreditable, marcada: boolean) {
    setCantidades((c) => ({ ...c, [l.invoice_line_id]: marcada ? String(l.disponible) : "" }));
  }

  function submit() {
    setSubmitError(null);
    const errores: Record<string, string> = {};
    const r = reason.trim();
    if (r.length < NC_MOTIVO_MIN || r.length > NC_MOTIVO_MAX) {
      errores.reason = `El motivo debe tener entre ${NC_MOTIVO_MIN} y ${NC_MOTIVO_MAX} caracteres.`;
    }
    if (seleccion.length === 0) errores.lineas = "Marque al menos una línea con su cantidad.";
    Object.assign(errores, erroresEnVivo);
    if (excede) {
      errores.lineas = `La nota de crédito (B/. ${fmtImporte(total)}) supera el saldo pendiente (B/. ${fmtImporte(balanceDue)}). Lo ya cobrado no se acredita: reverse el cobro primero, o acredite hasta el saldo.`;
    }
    setFieldErrors(errores);
    if (Object.keys(errores).length > 0) return;

    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/credit-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoice_id: invoiceId,
            reason: r,
            lineas: seleccion.map((x) => ({ invoice_line_id: x.linea.invoice_line_id, quantity: x.qty })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.fieldErrors) {
            // El servidor habla por índice (`lineas.N.quantity`); acá por línea.
            const porLinea: Record<string, string> = {};
            for (const [k, v] of Object.entries(data.fieldErrors as Record<string, string>)) {
              const m = /^lineas\.(\d+)\./.exec(k);
              const id = m ? seleccion[Number(m[1])]?.linea.invoice_line_id : undefined;
              porLinea[id ?? k] = v;
            }
            setFieldErrors(porLinea);
          }
          setSubmitError(data.error ?? "No se pudo emitir la nota de crédito.");
          return;
        }
        setOpen(false);
        reset();
        router.push(`/finanzas/notas-credito/${data.id}?emitida=1`);
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
        disabled={disabled || isPending || acreditables.length === 0}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-integra-navy/30 bg-white px-4 text-sm font-semibold text-integra-navy hover:bg-integra-navy hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        title={mesCerrado ? "El mes de esta factura está cerrado: no se anula, se emite una nota de crédito" : "Emitir una nota de crédito por líneas"}
      >
        <FileMinus size={16} />
        Nota de crédito
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
        confirmDisabled={hayErrorEnVivo}
        title={`Nota de crédito sobre ${invoiceNumber}`}
        confirmButtonText={isPending ? "Emitiendo…" : "Sí, emitir la nota de crédito"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-4">
          {mesCerrado && (
            <div role="alert" className="flex items-start gap-2 rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <p>
                El mes de esta factura está cerrado: no se anula, se emite una nota de crédito con la
                fecha de hoy. Para acreditarla completa, marque todas las líneas.
              </p>
            </div>
          )}
          <p className="text-sm text-gray-600">
            Marque las líneas que se acreditan y la cantidad. El precio y el impuesto son los de la
            factura. Saldo pendiente: <span className="font-mono font-semibold">B/. {fmtImporte(balanceDue)}</span>.
          </p>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2 font-semibold">Línea</th>
                  <th className="px-2 py-2 font-semibold text-right">Precio</th>
                  <th className="px-2 py-2 font-semibold text-right">Disponible</th>
                  <th className="px-2 py-2 font-semibold text-right">Cantidad</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {acreditables.map((l) => {
                  const v = cantidades[l.invoice_line_id] ?? "";
                  const marcada = v.trim() !== "";
                  const errorLinea = erroresEnVivo[l.invoice_line_id] ?? fieldErrors[l.invoice_line_id];
                  return (
                    <tr key={l.invoice_line_id} className={marcada ? "bg-integra-gold/5" : ""}>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={marcada}
                          onChange={(e) => toggle(l, e.target.checked)}
                          disabled={isPending}
                          aria-label={`Acreditar ${l.description}`}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="px-2 py-2 text-gray-900">
                        {l.description}
                        {l.tax_rate > 0 && <span className="ml-1 text-xs text-gray-500">· ITBMS {Math.round(l.tax_rate * 100)}%</span>}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">{fmtImporte(l.unit_price)}</td>
                      <td className="px-2 py-2 text-right font-mono text-gray-600">
                        {l.disponible}
                        {l.disponible < l.quantity && <span className="ml-1 text-xs text-gray-400">de {l.quantity}</span>}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={v}
                          onChange={(e) => setCantidades((c) => ({ ...c, [l.invoice_line_id]: e.target.value }))}
                          disabled={isPending || !marcada}
                          aria-label={`Cantidad a acreditar de ${l.description}`}
                          className={
                            "w-24 rounded-md border px-2 py-1 text-right font-mono text-sm min-h-[36px] " +
                            (errorLinea ? "border-red-300" : "border-gray-300")
                          }
                        />
                        {errorLinea && (
                          <p role="alert" className="mt-1 max-w-[16rem] text-left text-xs text-red-600">{errorLinea}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {fieldErrors.lineas && <p className="text-xs text-red-600">{fieldErrors.lineas}</p>}
          {excede && !fieldErrors.lineas && (
            <p role="alert" className="text-xs text-red-600">
              La nota de crédito (B/. {fmtImporte(total)}) supera el saldo pendiente (B/. {fmtImporte(balanceDue)}).
            </p>
          )}

          <div className={`flex items-center justify-between rounded-md border p-3 ${excede ? "border-red-200 bg-red-50" : "border-integra-gold/40 bg-gray-50"}`}>
            <span className="text-sm font-semibold text-integra-navy">Total de la nota de crédito</span>
            <span className={`font-mono text-lg font-bold ${excede ? "text-red-700" : "text-integra-navy"}`}>B/. {fmtImporte(total)}</span>
          </div>

          <div>
            <Label htmlFor="nc_reason" className="text-sm">
              Motivo <span className="text-red-600">*</span>
            </Label>
            <textarea
              id="nc_reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (fieldErrors.reason) setFieldErrors({ ...fieldErrors, reason: "" });
              }}
              disabled={isPending}
              rows={3}
              maxLength={NC_MOTIVO_MAX}
              placeholder="Ej: Descuento acordado con la clienta, servicio no prestado, error en el monto…"
              className={
                "mt-1 block w-full rounded-md border px-3 py-2 text-sm focus:border-integra-navy focus:outline-none " +
                (fieldErrors.reason ? "border-red-300" : "border-gray-300")
              }
            />
            <div className="mt-1 flex justify-between text-xs text-gray-500">
              <span>{fieldErrors.reason ? <span className="text-red-600">{fieldErrors.reason}</span> : "Queda en la nota de crédito y en su asiento."}</span>
              <span>
                {reason.length}/{NC_MOTIVO_MAX}
              </span>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            La nota de crédito lleva la fecha de hoy, se numera <span className="font-mono">NC-</span> y queda como
            documento interno: <span className="font-semibold">todavía no se envía a la DGI</span>.
          </p>

          {submitError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}
