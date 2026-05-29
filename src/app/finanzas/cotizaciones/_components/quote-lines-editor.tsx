"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { ServiceCombobox, SERVICE_CUSTOM } from "@/components/finanzas/service-combobox";
import { TaxCodeSelect } from "@/components/finanzas/tax-code-select";
import { QuoteKindIndicator } from "@/components/finanzas/cotizaciones/quote-kind-indicator";
import type {
  ServiceOption,
  TaxCodeOption,
} from "@/lib/finanzas/types/invoice";
import {
  QUOTE_LINE_KIND_LABEL,
  type QuoteLineKind,
} from "@/lib/finanzas/types/quote";

/**
 * Línea del editor de cotización tal como vive en el form. Incluye `_key`
 * temporal client-side (igual que InvoiceLineInput).
 */
export interface QuoteLineEditorInput {
  _key: string;
  /** ID real persistido (para edits). null en líneas nuevas. */
  id: string | null;
  invoice_kind: QuoteLineKind;
  service_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_code_id: string;
  tax_code: string;
  /** DECIMAL [0, 1] — 0.07 = 7%. */
  tax_rate: number;
}

interface Props {
  lines: QuoteLineEditorInput[];
  services: ServiceOption[];
  taxCodes: TaxCodeOption[];
  /** Mapa flat de errores: "lines.<idx>.<campo>" → mensaje. */
  errors: Record<string, string>;
  onChange: (lines: QuoteLineEditorInput[]) => void;
  disabled?: boolean;
}

let _keyCounter = 0;
function newKey(): string {
  _keyCounter += 1;
  return `qln-${Date.now().toString(36)}-${_keyCounter}`;
}

/** Línea vacía con defaults razonables. tax_code se completa al render. */
export function makeEmptyQuoteLine(
  taxCodes: TaxCodeOption[],
  kind: QuoteLineKind = "HON"
): QuoteLineEditorInput {
  const itbms7 = taxCodes.find((t) => t.code === "ITBMS_7") ?? taxCodes[0];
  return {
    _key: newKey(),
    id: null,
    invoice_kind: kind,
    service_id: null,
    description: "",
    quantity: 1,
    unit_price: 0,
    tax_code_id: itbms7?.id ?? "",
    tax_code: itbms7?.code ?? "",
    tax_rate: itbms7?.rate ?? 0,
  };
}

/** Mapea QuoteLineKind → InvoiceKind para filtrar el catálogo de servicios. */
function kindToInvoiceKind(kind: QuoteLineKind) {
  return kind === "HON" ? ("HONORARIOS" as const) : ("REEMBOLSO" as const);
}

const KINDS: QuoteLineKind[] = ["HON", "REI"];

/**
 * Editor de líneas de cotización (D2). Igual estructura que InvoiceLineItems
 * pero con una columna extra "Tipo" (dropdown HON/REI) por línea, y badge
 * visual del kind en el header de cada fila.
 *
 * Al cambiar el kind de una línea: si la línea tiene service_id seleccionado
 * y el servicio NO matchea el nuevo kind, limpiamos service_id (la
 * description manual se preserva).
 */
export function QuoteLinesEditor({
  lines,
  services,
  taxCodes,
  errors,
  onChange,
  disabled,
}: Props) {
  function patchLine(idx: number, patch: Partial<QuoteLineEditorInput>) {
    const next = [...lines];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function removeLine(idx: number) {
    onChange(lines.filter((_, i) => i !== idx));
  }

  function addLine() {
    // Hereda el kind de la última línea (mejor UX que volver siempre a HON).
    const lastKind = lines[lines.length - 1]?.invoice_kind ?? "HON";
    onChange([...lines, makeEmptyQuoteLine(taxCodes, lastKind)]);
  }

  function onKindChange(idx: number, kind: QuoteLineKind) {
    const ln = lines[idx];
    // Si tenía service_id y el servicio no matchea el nuevo kind, lo
    // limpiamos para evitar desalineación visual con el filtro del combobox.
    let serviceIdPatch: Partial<QuoteLineEditorInput> = {};
    if (ln.service_id) {
      const svc = services.find((s) => s.id === ln.service_id);
      const desiredType = kind === "HON" ? "honorarios" : "reembolso";
      if (svc && svc.service_type !== desiredType) {
        serviceIdPatch = { service_id: null };
      }
    }
    patchLine(idx, { invoice_kind: kind, ...serviceIdPatch });
  }

  function onServiceChange(
    idx: number,
    serviceId: string | null,
    service: ServiceOption | null
  ) {
    if (serviceId === SERVICE_CUSTOM) {
      patchLine(idx, { service_id: null });
      return;
    }
    if (!service) {
      patchLine(idx, { service_id: null });
      return;
    }
    const taxCode = taxCodes.find((t) => t.code === service.default_tax_code);
    patchLine(idx, {
      service_id: service.id,
      description: service.name,
      tax_code_id: taxCode?.id ?? lines[idx].tax_code_id,
      tax_code: taxCode?.code ?? lines[idx].tax_code,
      tax_rate: taxCode?.rate ?? lines[idx].tax_rate,
    });
  }

  function onTaxChange(idx: number, _taxCodeId: string, taxCode: TaxCodeOption | null) {
    if (!taxCode) return;
    patchLine(idx, {
      tax_code_id: taxCode.id,
      tax_code: taxCode.code,
      tax_rate: taxCode.rate,
    });
  }

  const generalLinesError = errors.lines;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-integra-navy">Líneas de la cotización</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addLine}
          disabled={disabled}
        >
          <Plus size={14} className="mr-1" />
          Agregar línea
        </Button>
      </div>

      {generalLinesError && lines.length === 0 && (
        <p className="text-sm text-red-600">{generalLinesError}</p>
      )}

      {lines.length === 0 ? (
        <div className="rounded-md border border-dashed bg-gray-50 p-6 text-center text-sm text-gray-500">
          Aún no hay líneas. Agrega la primera con el botón de arriba.
        </div>
      ) : (
        <div className="space-y-3">
          {lines.map((ln, idx) => {
            const isCustom = ln.service_id === null;
            const lineErrors = {
              invoice_kind: errors[`lines.${idx}.invoice_kind`],
              description: errors[`lines.${idx}.description`],
              quantity: errors[`lines.${idx}.quantity`],
              unit_price: errors[`lines.${idx}.unit_price`],
              tax_code_id: errors[`lines.${idx}.tax_code_id`],
              tax_code: errors[`lines.${idx}.tax_code`],
              tax_rate: errors[`lines.${idx}.tax_rate`],
            };
            const serviceValue = ln.service_id ?? (ln.description ? SERVICE_CUSTOM : null);

            const lineSubtotal = (Number(ln.quantity) || 0) * (Number(ln.unit_price) || 0);
            const lineTax = lineSubtotal * (Number(ln.tax_rate) || 0);
            const lineTotal = lineSubtotal + lineTax;

            return (
              <div
                key={ln._key}
                className="rounded-md border bg-white p-3 shadow-sm space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Línea {idx + 1}
                    </span>
                    <QuoteKindIndicator kind={ln.invoice_kind} compact />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLine(idx)}
                    disabled={disabled}
                    className="min-h-[40px] min-w-[40px] text-red-600 hover:bg-red-50 hover:text-red-700"
                    aria-label={`Eliminar línea ${idx + 1}`}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>

                {/* Tipo (HON/REI) — primer campo, define filtrado de catálogo */}
                <div data-error={!!lineErrors.invoice_kind}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Tipo
                  </label>
                  <div className="flex rounded-md border border-gray-300 bg-white overflow-hidden">
                    {KINDS.map((k, i) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => onKindChange(idx, k)}
                        disabled={disabled}
                        className={`flex-1 min-h-[40px] text-sm font-medium transition-colors ${
                          i > 0 ? "border-l" : ""
                        } ${
                          ln.invoice_kind === k
                            ? "bg-integra-navy text-white"
                            : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {k} · {QUOTE_LINE_KIND_LABEL[k]}
                      </button>
                    ))}
                  </div>
                  {lineErrors.invoice_kind && (
                    <p className="mt-1 text-xs text-red-600">{lineErrors.invoice_kind}</p>
                  )}
                </div>

                {/* Servicio + Descripción */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Servicio
                    </label>
                    <ServiceCombobox
                      services={services}
                      value={serviceValue}
                      filterKind={kindToInvoiceKind(ln.invoice_kind)}
                      onChange={(id, svc) => onServiceChange(idx, id, svc)}
                      disabled={disabled}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Descripción {!isCustom && <span className="text-gray-400">(de catálogo)</span>}
                    </label>
                    <Input
                      value={ln.description}
                      onChange={(e) => patchLine(idx, { description: e.target.value })}
                      placeholder="Descripción de la línea…"
                      disabled={disabled}
                      className={lineErrors.description ? "border-red-300" : ""}
                    />
                    {lineErrors.description && (
                      <p className="mt-1 text-xs text-red-600">{lineErrors.description}</p>
                    )}
                  </div>
                </div>

                {/* Cantidad / Precio / Impuesto / Total */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Cantidad
                    </label>
                    <NumberInput
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={ln.quantity}
                      onChange={(e) => patchLine(idx, { quantity: Number(e.target.value) })}
                      onFocus={(e) => e.target.select()}
                      disabled={disabled}
                      className={lineErrors.quantity ? "border-red-300" : ""}
                    />
                    {lineErrors.quantity && (
                      <p className="mt-1 text-xs text-red-600">{lineErrors.quantity}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Precio unit.
                    </label>
                    <div className="relative">
                      <span
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500"
                        aria-hidden="true"
                      >
                        $
                      </span>
                      <NumberInput
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={ln.unit_price}
                        onChange={(e) => patchLine(idx, { unit_price: Number(e.target.value) })}
                        onFocus={(e) => e.target.select()}
                        disabled={disabled}
                        className={`pl-7 ${lineErrors.unit_price ? "border-red-300" : ""}`}
                      />
                    </div>
                    {lineErrors.unit_price && (
                      <p className="mt-1 text-xs text-red-600">{lineErrors.unit_price}</p>
                    )}
                  </div>
                  <div className="col-span-2 lg:col-span-1">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Impuesto
                    </label>
                    <TaxCodeSelect
                      taxCodes={taxCodes}
                      value={ln.tax_code_id}
                      onChange={(id, tc) => onTaxChange(idx, id, tc)}
                      error={lineErrors.tax_code_id}
                      disabled={disabled}
                    />
                  </div>
                  <div className="col-span-2 lg:col-span-1">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Total línea
                    </label>
                    <div className="rounded-md bg-gray-50 px-3 py-2 min-h-[44px] flex items-center font-mono text-sm font-medium text-gray-900">
                      ${lineTotal.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
