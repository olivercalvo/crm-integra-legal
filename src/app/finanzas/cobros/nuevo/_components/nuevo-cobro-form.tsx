"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, CircleDollarSign, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { fmtImporte } from "@/lib/utils/importe";
import { formatDate } from "@/lib/utils/format-date";
import { INVOICE_KIND_LABEL, type InvoiceKind } from "@/lib/finanzas/types/invoice";
import type { InvoiceCobrable } from "@/lib/finanzas/types/payment";
import {
  repartirPorAntiguedad,
  validarReparto,
  aplicacionesParaEnviar,
  ordenarPorAntiguedad,
  type Reparto,
} from "@/lib/finanzas/cobros/repartir-por-antiguedad";
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
 *   Paso 1 — ¿a quién y por qué factura(s)? Cliente (solo los que tienen
 *            facturas con saldo) → casillas por factura, con su saldo. Si el
 *            cliente tiene UNA sola, queda marcada sola.
 *   Paso 2 — los datos del cobro: `PaymentFormFields`, la MISMA
 *            implementación que el diálogo del detalle de la factura.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EL CASO DE UNA FACTURA ES EL 90% Y NO PUEDE QUEDAR PEOR (Oliver, 21/09/2026)
 * ═════════════════════════════════════════════════════════════════════════════
 * Con UNA casilla marcada, el paso 2 es exactamente el de antes: monto con su
 * "máximo permitido", método, banco, referencia, notas. Ni tabla de reparto ni
 * renglón de diferencia: el monto va entero a esa factura. La tabla aparece
 * solo con dos o más facturas marcadas (Parte B, Josuarth: "sí hace falta
 * poder pagar varias facturas con una sola transferencia").
 *
 * Con VARIAS: se teclea el total de la transferencia y el sistema lo reparte
 * de la más vieja a la más nueva (`repartirPorAntiguedad`); cada fila queda
 * editable y el renglón "Aplicado / Diferencia" responde. Cambiar el total
 * vuelve a repartir (se avisa). El excedente se rechaza con el mensaje
 * acordado; `validarReparto` es la misma regla que el servidor.
 *
 * El POST va a `/api/finanzas/payments` con `applications[]` — la misma
 * `createPayment` que el diálogo. Al terminar redirige al listado con
 * `?recibo=REC-000012` para el toast.
 */
export function NuevoCobroForm({ cobrables, bancos, initialClientId, initialInvoiceId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const inicial = cobrables.find((i) => i.id === initialInvoiceId) ?? null;
  const [clientId, setClientId] = useState(inicial?.client_id ?? initialClientId);
  const [invoiceIds, setInvoiceIds] = useState<string[]>(inicial ? [inicial.id] : []);
  const [paso, setPaso] = useState<1 | 2>(inicial ? 2 : 1);
  const [pasoError, setPasoError] = useState<string | null>(null);

  const [values, setValues] = useState<PaymentFormValues>(emptyPaymentFormValues);
  const [fieldErrors, setFieldErrors] = useState<PaymentFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);

  // El reparto entre facturas (solo con varias). Texto por fila, como el
  // MoneyInput del monto, para que se pueda teclear "1500" sobre un "0.00".
  const [reparto, setReparto] = useState<Record<string, string>>({});
  const [repartoManual, setRepartoManual] = useState(false);

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
    () => ordenarPorAntiguedad(cobrables.filter((i) => i.client_id === clientId)),
    [cobrables, clientId]
  );
  const seleccionadas = useMemo(
    () => facturasDelCliente.filter((f) => invoiceIds.includes(f.id)),
    [facturasDelCliente, invoiceIds]
  );
  const varias = seleccionadas.length > 1;
  const saldoTotal = seleccionadas.reduce((acc, f) => acc + f.balance_due, 0);
  const unica = seleccionadas.length === 1 ? seleccionadas[0] : null;

  function elegirCliente(id: string) {
    setClientId(id);
    // Con una sola factura cobrable, marcada sola: cero clics de más.
    const suyas = cobrables.filter((i) => i.client_id === id);
    setInvoiceIds(suyas.length === 1 ? [suyas[0].id] : []);
    setPasoError(null);
  }

  function toggleFactura(id: string) {
    setInvoiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPasoError(null);
  }

  function irAlPaso2() {
    if (!clientId) {
      setPasoError("Elija el cliente.");
      return;
    }
    if (seleccionadas.length === 0) {
      setPasoError("Marque la factura (o las facturas) a las que se aplica el cobro.");
      return;
    }
    setPasoError(null);
    setReparto({});
    setRepartoManual(false);
    setPaso(2);
    setTimeout(() => amountInputRef.current?.focus(), 50);
  }

  // ---- El reparto (solo con varias) ---------------------------------------
  const repartoActual: Reparto[] = seleccionadas.map((f) => ({
    invoice_id: f.id,
    amount: Number(reparto[f.id] ?? "0") || 0,
  }));
  const amountNum = Number(values.amount) || 0;
  const estadoReparto = varias ? validarReparto(amountNum, repartoActual, seleccionadas) : null;

  function cambiarValores(next: PaymentFormValues) {
    if (varias && next.amount !== values.amount) {
      // Cambió el total: se vuelve a repartir por antigüedad. Lo corregido a
      // mano se pierde, y se avisa (`repartoManual` vuelve a false).
      const total = Number(next.amount) || 0;
      const r = repartirPorAntiguedad(total, seleccionadas);
      setReparto(Object.fromEntries(r.map((x) => [x.invoice_id, x.amount ? String(x.amount) : ""])));
      setRepartoManual(false);
    }
    setValues(next);
  }

  function cambiarFila(invoiceId: string, texto: string) {
    setReparto((prev) => ({ ...prev, [invoiceId]: texto }));
    setRepartoManual(true);
  }

  function volverARepartir() {
    const r = repartirPorAntiguedad(amountNum, seleccionadas);
    setReparto(Object.fromEntries(r.map((x) => [x.invoice_id, x.amount ? String(x.amount) : ""])));
    setRepartoManual(false);
  }

  function submit() {
    if (seleccionadas.length === 0) return;
    setSubmitError(null);

    // Con una factura, el cap es su saldo (igual que el diálogo). Con varias,
    // el cap del total es la suma de los saldos; lo fino lo dice el reparto.
    const { ok, errors, amountNum: total } = validatePaymentForm(values, saldoTotal);
    const errs: PaymentFormErrors = { ...errors };
    let applications: Reparto[];
    if (varias) {
      const v = validarReparto(total, repartoActual, seleccionadas);
      if (!v.ok && !errs.amount) errs.amount = v.mensaje ?? "Revise el reparto.";
      applications = aplicacionesParaEnviar(repartoActual);
    } else {
      applications = [{ invoice_id: seleccionadas[0].id, amount: total }];
    }
    setFieldErrors(errs);
    if (!ok || Object.keys(errs).length > 0) return;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...toPaymentPayload(values, total), applications }),
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

  // ---- La tabla de reparto, solo con varias --------------------------------
  const tablaReparto = varias ? (
    <div className="rounded-md border bg-gray-50/60 p-3 space-y-2" data-testid="reparto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-integra-navy">Cómo se reparte entre las facturas</p>
        <button
          type="button"
          onClick={volverARepartir}
          disabled={isPending || amountNum <= 0}
          className="inline-flex items-center gap-1 text-xs text-integra-navy hover:underline disabled:text-gray-400 disabled:no-underline"
          title="Repartir de la más vieja a la más nueva"
        >
          <RotateCcw size={12} />
          Repartir por antigüedad
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Se reparte de la más vieja a la más nueva. Corrija cualquier monto a mano; cambiar el total vuelve a
        repartir.
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-gray-500">
          <tr>
            <th className="pb-1 pr-2 font-semibold">Factura</th>
            <th className="pb-1 pr-2 font-semibold text-right">Saldo</th>
            <th className="pb-1 font-semibold text-right w-40">Aplicar</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {seleccionadas.map((f) => {
            const err = estadoReparto?.porFactura[f.id];
            return (
              <tr key={f.id}>
                <td className="py-1.5 pr-2">
                  <span className="font-mono text-xs font-semibold text-integra-navy">{f.invoice_number}</span>
                  <span className="ml-2 text-xs text-gray-500">{formatDate(f.issue_date)}</span>
                </td>
                <td className="py-1.5 pr-2 text-right font-mono text-amber-700 whitespace-nowrap">
                  {fmtImporte(f.balance_due)}
                </td>
                <td className="py-1.5 text-right">
                  <MoneyInput
                    id={`aplicar-${f.id}`}
                    aria-label={`Aplicar a ${f.invoice_number}`}
                    placeholder="0.00"
                    value={reparto[f.id] ?? ""}
                    onChange={(e) => cambiarFila(f.id, e.target.value)}
                    disabled={isPending}
                    className={`font-mono text-right h-9 ${err ? "border-red-400" : ""}`}
                  />
                  {err && <p className="mt-0.5 text-xs text-red-600 text-right">{err}</p>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {estadoReparto && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
            estadoReparto.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
          data-testid="reparto-diferencia"
        >
          <span>
            Aplicado <span className="font-mono font-semibold">B/. {fmtImporte(estadoReparto.aplicado)}</span> de{" "}
            <span className="font-mono font-semibold">B/. {fmtImporte(amountNum)}</span>
          </span>
          <span className="font-mono font-semibold">
            Diferencia B/. {fmtImporte(estadoReparto.diferencia)}
          </span>
        </div>
      )}
      {repartoManual && (
        <p className="text-xs text-gray-500">Reparto corregido a mano.</p>
      )}
    </div>
  ) : null;

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
              onChange={(e) => elegirCliente(e.target.value)}
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
              Factura{facturasDelCliente.length > 1 ? "s" : ""}{" "}
              <span className="text-red-600" aria-hidden="true">
                *
              </span>
            </Label>
            {!clientId ? (
              <p className="mt-1 text-sm text-gray-400">Primero elija el cliente.</p>
            ) : (
              <>
                {facturasDelCliente.length > 1 && (
                  <p className="mt-1 text-xs text-gray-500">
                    Marque una o varias: una transferencia puede pagar varias facturas.
                  </p>
                )}
                <div className="mt-1 space-y-2" role="group" aria-label="Facturas">
                  {facturasDelCliente.map((f) => {
                    const activa = invoiceIds.includes(f.id);
                    return (
                      <label
                        key={f.id}
                        className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 min-h-[48px] ${
                          activa ? "border-integra-navy bg-integra-navy/5" : "border-gray-200 hover:border-integra-navy/50"
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            name="invoice_ids"
                            value={f.id}
                            checked={activa}
                            onChange={() => toggleFactura(f.id)}
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
                {seleccionadas.length > 1 && (
                  <p className="mt-2 text-xs text-gray-600">
                    {seleccionadas.length} facturas · saldo total{" "}
                    <span className="font-mono font-semibold">B/. {fmtImporte(saldoTotal)}</span>
                  </p>
                )}
              </>
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
          <div className="rounded-md border bg-gray-50 p-3 text-sm space-y-1">
            <div className="flex justify-between gap-3">
              <span className="text-gray-600">{seleccionadas[0]?.client_name}</span>
              <span className="font-mono font-semibold text-integra-navy">
                {unica ? unica.invoice_number : `${seleccionadas.length} facturas`}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-600">{unica ? "Saldo pendiente" : "Saldo pendiente total"}</span>
              <span className="font-mono font-semibold text-amber-700">B/. {fmtImporte(saldoTotal)}</span>
            </div>
          </div>

          <PaymentFormFields
            values={values}
            onChange={cambiarValores}
            errors={fieldErrors}
            onClearError={(f) => setFieldErrors({ ...fieldErrors, [f]: "" })}
            balanceDue={saldoTotal}
            bancos={bancos}
            disabled={isPending}
            amountInputRef={amountInputRef}
            amountHint={
              varias ? (
                <p className="mt-1 text-xs text-gray-500">
                  Total de la transferencia. Máximo: B/. {fmtImporte(saldoTotal)} (la suma de los saldos).
                </p>
              ) : undefined
            }
            afterAmount={tablaReparto}
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
              {varias ? "Cambiar facturas" : "Cambiar factura"}
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
