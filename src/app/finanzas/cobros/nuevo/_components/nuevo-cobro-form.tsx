"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, CircleDollarSign, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fmtImporte } from "@/lib/utils/importe";
import { formatDate } from "@/lib/utils/format-date";
import { INVOICE_KIND_LABEL, type InvoiceKind } from "@/lib/finanzas/types/invoice";
import type { InvoiceCobrable } from "@/lib/finanzas/types/payment";
import {
  PaymentFormFields,
  emptyPaymentFormValues,
  validatePaymentForm,
  toPaymentPayload,
  type PaymentFormValues,
  type PaymentFormErrors,
} from "@/components/finanzas/cobros/payment-form-fields";

interface Props {
  /** Todas las facturas cobrables del bufete, con su cliente. */
  cobrables: InvoiceCobrable[];
  bancos: { code: string; name: string }[];
  initialClientId: string;
  initialInvoiceId: string;
}

/**
 * Alta de un recibo de caja en dos pasos.
 *
 *   Paso 1 — ¿a quién y por qué factura? Cliente (solo los que tienen
 *            facturas con saldo) → factura (con su saldo a la vista).
 *   Paso 2 — los datos del cobro: `PaymentFormFields`, la MISMA
 *            implementación que el diálogo del detalle de la factura.
 *
 * El POST va a `/api/finanzas/invoices/{invoice_id}/payments`, la misma ruta
 * que el diálogo: una sola `createPayment`, un solo correlativo. Al terminar
 * redirige al listado con `?recibo=REC-000012` para el toast.
 */
export function NuevoCobroForm({ cobrables, bancos, initialClientId, initialInvoiceId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const inicial = cobrables.find((i) => i.id === initialInvoiceId) ?? null;
  const [clientId, setClientId] = useState(inicial?.client_id ?? initialClientId);
  const [invoiceId, setInvoiceId] = useState(inicial?.id ?? "");
  const [paso, setPaso] = useState<1 | 2>(inicial ? 2 : 1);
  const [pasoError, setPasoError] = useState<string | null>(null);

  const [values, setValues] = useState<PaymentFormValues>(emptyPaymentFormValues);
  const [fieldErrors, setFieldErrors] = useState<PaymentFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);

  // Clientes con algo que cobrar, ordenados por nombre, sin repetir.
  const clientes = useMemo(() => {
    const m = new Map<string, { id: string; name: string; client_number: string | null; n: number }>();
    for (const i of cobrables) {
      const c = m.get(i.client_id) ?? { id: i.client_id, name: i.client_name, client_number: i.client_number, n: 0 };
      c.n += 1;
      m.set(i.client_id, c);
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [cobrables]);

  const facturasDelCliente = useMemo(
    () => cobrables.filter((i) => i.client_id === clientId),
    [cobrables, clientId]
  );
  const factura = cobrables.find((i) => i.id === invoiceId) ?? null;

  function irAlPaso2() {
    if (!clientId) {
      setPasoError("Elija el cliente.");
      return;
    }
    if (!factura) {
      setPasoError("Elija la factura a la que se aplica el cobro.");
      return;
    }
    setPasoError(null);
    setPaso(2);
    setTimeout(() => amountInputRef.current?.focus(), 50);
  }

  function submit() {
    if (!factura) return;
    setSubmitError(null);
    const { ok, errors, amountNum } = validatePaymentForm(values, factura.balance_due);
    setFieldErrors(errors);
    if (!ok) return;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/invoices/${factura.id}/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPaymentPayload(values, amountNum)),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.fieldErrors) setFieldErrors(data.fieldErrors);
          setSubmitError(data.error ?? "No se pudo registrar el cobro.");
          return;
        }
        const recibo = typeof data.payment_number === "string" ? data.payment_number : "";
        router.push(`/finanzas/cobros${recibo ? `?recibo=${encodeURIComponent(recibo)}` : ""}`);
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intente de nuevo.");
      }
    });
  }

  const selectClass =
    "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-integra-navy min-h-[44px]";

  if (cobrables.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-gray-50/40 p-8 text-center text-sm text-gray-500">
        No hay facturas con saldo pendiente. Un cobro siempre se aplica a una factura emitida.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm max-w-2xl space-y-5">
      {/* Indicador de paso */}
      <ol className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider">
        <li className={paso === 1 ? "text-integra-navy" : "text-gray-400"}>1 · Cliente y factura</li>
        <li className="text-gray-300">—</li>
        <li className={paso === 2 ? "text-integra-navy" : "text-gray-400"}>2 · Datos del cobro</li>
      </ol>

      {paso === 1 ? (
        <div className="space-y-4">
          <div>
            <Label htmlFor="client_id" className="text-sm">
              Cliente{" "}
              <span className="text-red-600" aria-hidden="true">
                *
              </span>
            </Label>
            <select
              id="client_id"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setInvoiceId("");
                setPasoError(null);
              }}
              className={selectClass}
            >
              <option value="">Elija el cliente…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.client_number ? ` · ${c.client_number}` : ""} ({c.n} factura{c.n === 1 ? "" : "s"} con saldo)
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">Solo aparecen clientes con facturas pendientes de cobro.</p>
          </div>

          <div>
            <Label className="text-sm">
              Factura{" "}
              <span className="text-red-600" aria-hidden="true">
                *
              </span>
            </Label>
            {!clientId ? (
              <p className="mt-1 text-sm text-gray-400">Primero elija el cliente.</p>
            ) : (
              <div className="mt-1 space-y-2" role="radiogroup" aria-label="Factura">
                {facturasDelCliente.map((f) => {
                  const activa = f.id === invoiceId;
                  return (
                    <label
                      key={f.id}
                      className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 min-h-[48px] ${
                        activa ? "border-integra-navy bg-integra-navy/5" : "border-gray-200 hover:border-integra-navy/50"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="invoice_id"
                          value={f.id}
                          checked={activa}
                          onChange={() => {
                            setInvoiceId(f.id);
                            setPasoError(null);
                          }}
                          className="h-4 w-4 accent-integra-navy"
                        />
                        <span>
                          <span className="font-mono text-sm font-semibold text-integra-navy">{f.invoice_number}</span>
                          <span className="ml-2 text-xs text-gray-500">
                            {INVOICE_KIND_LABEL[f.invoice_kind as InvoiceKind] ?? f.invoice_kind} · {formatDate(f.issue_date)}
                            {f.due_date ? ` · vence ${formatDate(f.due_date)}` : ""}
                          </span>
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block font-mono text-sm font-semibold text-amber-700">
                          B/. {fmtImporte(f.balance_due)}
                        </span>
                        <span className="block text-xs text-gray-400">
                          de {fmtImporte(f.grand_total)}
                          {f.amount_paid > 0 ? ` · pagado ${fmtImporte(f.amount_paid)}` : ""}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {pasoError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{pasoError}</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={irAlPaso2}
              className="bg-integra-navy text-white hover:bg-integra-navy/90 min-h-[48px]"
            >
              Continuar
              <ArrowRight size={16} className="ml-2" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Resumen de lo elegido */}
          {factura && (
            <div className="rounded-md border bg-gray-50 p-3 text-sm space-y-1">
              <div className="flex justify-between gap-3">
                <span className="text-gray-600">{factura.client_name}</span>
                <span className="font-mono font-semibold text-integra-navy">{factura.invoice_number}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-600">Saldo pendiente</span>
                <span className="font-mono font-semibold text-amber-700">B/. {fmtImporte(factura.balance_due)}</span>
              </div>
            </div>
          )}

          <PaymentFormFields
            values={values}
            onChange={setValues}
            errors={fieldErrors}
            onClearError={(f) => setFieldErrors({ ...fieldErrors, [f]: "" })}
            balanceDue={factura?.balance_due ?? 0}
            bancos={bancos}
            disabled={isPending}
            amountInputRef={amountInputRef}
          />

          {submitError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPaso(1)}
              disabled={isPending}
              className="min-h-[48px]"
            >
              <ArrowLeft size={16} className="mr-2" />
              Cambiar factura
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={isPending}
              className="bg-integra-navy text-white hover:bg-integra-navy/90 min-h-[48px]"
            >
              {isPending ? (
                <Loader2 size={16} className="mr-2 animate-spin" />
              ) : (
                <CircleDollarSign size={16} className="mr-2" />
              )}
              {isPending ? "Registrando…" : "Registrar cobro"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
