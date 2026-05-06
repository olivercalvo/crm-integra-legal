"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientCombobox } from "@/components/finanzas/client-combobox";
import { CaseCombobox } from "@/components/finanzas/case-combobox";
import { InvoiceLineItems, makeEmptyLine } from "./invoice-line-items";
import { InvoiceTotalsCard } from "./invoice-totals-card";
import {
  validateCreateInvoice,
  type ValidationErrors,
} from "@/lib/finanzas/validators/invoice";
import {
  INVOICE_KIND_LABEL,
  type ClientOption,
  type CaseOption,
  type ServiceOption,
  type TaxCodeOption,
  type InvoiceKind,
  type InvoiceLineInput,
} from "@/lib/finanzas/types/invoice";

interface BaseProps {
  clients: ClientOption[];
  /** Todas los casos del tenant (filtramos por client_id en el form). */
  casesByClient: Record<string, CaseOption[]>;
  services: ServiceOption[];
  taxCodes: TaxCodeOption[];
}

interface CreateProps extends BaseProps {
  mode: "create";
  initial?: undefined;
}

interface EditProps extends BaseProps {
  mode: "edit";
  initial: {
    id: string;
    invoice_kind: InvoiceKind;
    client_id: string;
    case_id: string | null;
    issue_date: string;
    due_date: string;
    notes: string | null;
    lines: InvoiceLineInput[];
  };
}

type Props = CreateProps | EditProps;

const KINDS: InvoiceKind[] = ["HONORARIOS", "REEMBOLSO"];

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Form de factura — usado para crear (mode='create') y editar (mode='edit').
 * Validación manual con setState + setError. Cliente: matchesSearchQuery
 * vía ClientCombobox / CaseCombobox.
 */
export function InvoiceForm(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ---- State del header ---------------------------------------------------
  const [kind, setKind] = useState<InvoiceKind>(
    props.mode === "edit" ? props.initial.invoice_kind : "HONORARIOS"
  );
  const [clientId, setClientId] = useState<string | null>(
    props.mode === "edit" ? props.initial.client_id : null
  );
  const [caseId, setCaseId] = useState<string | null>(
    props.mode === "edit" ? props.initial.case_id : null
  );
  const [issueDate, setIssueDate] = useState<string>(
    props.mode === "edit" ? props.initial.issue_date : todayIso()
  );
  const [dueDate, setDueDate] = useState<string>(
    props.mode === "edit" ? props.initial.due_date : addDays(todayIso(), 30)
  );
  const [notes, setNotes] = useState<string>(
    props.mode === "edit" ? props.initial.notes ?? "" : ""
  );

  // ---- Líneas -------------------------------------------------------------
  const [lines, setLines] = useState<InvoiceLineInput[]>(() =>
    props.mode === "edit" ? props.initial.lines : [makeEmptyLine(props.taxCodes)]
  );

  // ---- Errors / submit state ----------------------------------------------
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ---- Pre-fill due_date al cambiar de cliente (D9 — usa
  //     default_payment_terms_days del cliente si existe; fallback 30) -----
  useEffect(() => {
    if (props.mode !== "create" || !clientId) return;
    const client = props.clients.find((c) => c.id === clientId);
    const days = client?.default_payment_terms_days ?? 30;
    setDueDate(addDays(issueDate, days));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, issueDate]);

  // Si cambia el cliente, limpiar el caso seleccionado (puede no aplicar).
  useEffect(() => {
    if (caseId && clientId) {
      const cases = props.casesByClient[clientId] ?? [];
      if (!cases.some((c) => c.id === caseId)) {
        setCaseId(null);
      }
    } else if (!clientId) {
      setCaseId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const availableCases = clientId ? props.casesByClient[clientId] ?? [] : [];

  // ---- Submit -------------------------------------------------------------
  async function handleSubmit() {
    setSubmitError(null);
    const payload = {
      invoice_kind: kind,
      client_id: clientId ?? "",
      case_id: caseId,
      issue_date: issueDate,
      due_date: dueDate,
      notes: notes.trim() || null,
      lines: lines.map((ln) => ({
        service_id: ln.service_id,
        description: ln.description.trim(),
        quantity: ln.quantity,
        unit_price: ln.unit_price,
        tax_code_id: ln.tax_code_id,
        tax_code: ln.tax_code,
        tax_rate: ln.tax_rate,
      })),
    };

    const validation = validateCreateInvoice(payload);
    if (!validation.ok) {
      setErrors(validation.errors);
      // Scrollear al primer error visible
      requestAnimationFrame(() => {
        document.querySelector("[data-error='true']")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
      return;
    }
    setErrors({});

    startTransition(async () => {
      try {
        const url =
          props.mode === "create"
            ? "/api/finanzas/invoices"
            : `/api/finanzas/invoices/${props.initial.id}`;
        const method = props.mode === "create" ? "POST" : "PATCH";
        const body =
          props.mode === "create"
            ? validation.data
            : {
                ...validation.data,
                // Mantener line.id en update para diff de líneas
                lines: lines.map((ln) => ({
                  id: ln.id,
                  service_id: ln.service_id,
                  description: ln.description.trim(),
                  quantity: ln.quantity,
                  unit_price: ln.unit_price,
                  tax_code_id: ln.tax_code_id,
                  tax_code: ln.tax_code,
                  tax_rate: ln.tax_rate,
                })),
              };

        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.fieldErrors) {
            setErrors(data.fieldErrors);
          }
          setSubmitError(data.error ?? "Error al guardar");
          return;
        }
        const id = data.id ?? (props.mode === "edit" ? props.initial.id : null);
        if (id) {
          // ?saved=1 dispara el InvoiceSuccessToast en el detalle. El valor
          // del param no se usa — solo su presencia.
          router.push(`/finanzas/facturas/${id}?saved=1`);
          router.refresh();
        }
      } catch (err) {
        console.error(err);
        setSubmitError("Error de red al guardar. Intentá de nuevo.");
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        {/* Cabecera */}
        <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-integra-navy">Datos de la factura</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Tipo */}
            <div data-error={!!errors.invoice_kind}>
              <Label className="mb-1 block">Tipo de factura *</Label>
              <div className="flex rounded-md border border-gray-300 bg-white overflow-hidden">
                {KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    disabled={isPending || (props.mode === "edit" && false)}
                    className={`flex-1 min-h-[44px] text-sm font-medium transition-colors ${
                      kind === k
                        ? "bg-integra-navy text-white"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {INVOICE_KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              {errors.invoice_kind && (
                <p className="mt-1 text-xs text-red-600">{errors.invoice_kind}</p>
              )}
            </div>

            {/* Moneda (read-only) */}
            <div>
              <Label className="mb-1 block">Moneda</Label>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 min-h-[44px] flex items-center text-sm text-gray-600">
                USD
              </div>
            </div>

            {/* Cliente */}
            <div className="sm:col-span-2" data-error={!!errors.client_id}>
              <Label className="mb-1 block">Cliente *</Label>
              <ClientCombobox
                clients={props.clients}
                value={clientId}
                onChange={(id) => setClientId(id)}
                error={errors.client_id}
                disabled={isPending}
              />
            </div>

            {/* Caso (opcional) — oculto si el cliente no tiene casos */}
            {clientId && availableCases.length > 0 && (
              <div className="sm:col-span-2" data-error={!!errors.case_id}>
                <Label className="mb-1 block">Caso (opcional)</Label>
                <CaseCombobox
                  cases={availableCases}
                  value={caseId}
                  onChange={(id) => setCaseId(id)}
                  error={errors.case_id}
                  disabled={isPending}
                />
              </div>
            )}

            {/* Fechas */}
            <div data-error={!!errors.issue_date}>
              <Label className="mb-1 block">Fecha de emisión *</Label>
              <Input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                disabled={isPending}
                className={errors.issue_date ? "border-red-300" : ""}
              />
              {errors.issue_date && (
                <p className="mt-1 text-xs text-red-600">{errors.issue_date}</p>
              )}
            </div>

            <div data-error={!!errors.due_date}>
              <Label className="mb-1 block">Vence el *</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={isPending}
                className={errors.due_date ? "border-red-300" : ""}
              />
              {errors.due_date && (
                <p className="mt-1 text-xs text-red-600">{errors.due_date}</p>
              )}
            </div>

            {/* Notas */}
            <div className="sm:col-span-2">
              <Label className="mb-1 block">Notas (opcional)</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isPending}
                rows={3}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
                placeholder="Texto que aparecerá al pie de la factura…"
              />
            </div>
          </div>
        </section>

        {/* Líneas */}
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <InvoiceLineItems
            lines={lines}
            services={props.services}
            taxCodes={props.taxCodes}
            invoiceKind={kind}
            errors={errors}
            onChange={setLines}
            disabled={isPending}
          />
        </section>

        {/* Submit error */}
        {submitError && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">No se pudo guardar la factura</p>
              <p className="mt-1">{submitError}</p>
            </div>
          </div>
        )}

        {/* Acciones */}
        <div className="flex flex-wrap items-center justify-end gap-3 sticky bottom-0 bg-gray-50 -mx-1 px-1 py-3 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isPending}
            className="min-h-[48px]"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            className="bg-integra-navy hover:bg-integra-navy/90 text-white min-h-[48px]"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Guardando…
              </>
            ) : (
              <>
                <Save size={16} className="mr-2" />
                {props.mode === "create" ? "Guardar borrador" : "Guardar cambios"}
              </>
            )}
          </Button>
        </div>
      </form>

      {/* Sidebar derecha: totales */}
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <InvoiceTotalsCard lines={lines} />
        <div className="rounded-lg border bg-white p-4 text-xs text-gray-500">
          <p className="font-semibold text-gray-700 mb-1">Sobre la numeración</p>
          <p>
            Las facturas se guardan inicialmente como{" "}
            <span className="font-mono">borrador</span>. El número definitivo
            (<span className="font-mono">FAC-HON-…</span> o{" "}
            <span className="font-mono">FAC-REI-…</span>) se asigna recién al
            emitir.
          </p>
        </div>
      </aside>
    </div>
  );
}
