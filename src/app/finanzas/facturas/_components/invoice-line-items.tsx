"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ServiceCombobox, SERVICE_CUSTOM } from "@/components/finanzas/service-combobox";
import { TaxCodeSelect } from "@/components/finanzas/tax-code-select";
import type {
  InvoiceLineInput,
  ServiceOption,
  TaxCodeOption,
  InvoiceKind,
} from "@/lib/finanzas/types/invoice";
import type { ValidationErrors } from "@/lib/finanzas/validators/invoice";

interface Props {
  lines: InvoiceLineInput[];
  services: ServiceOption[];
  taxCodes: TaxCodeOption[];
  invoiceKind: InvoiceKind;
  /** Mapa errors completo del form (incluye keys "lines.<idx>.<campo>"). */
  errors: ValidationErrors;
  onChange: (lines: InvoiceLineInput[]) => void;
  disabled?: boolean;
}

let _keyCounter = 0;
function newKey(): string {
  _keyCounter += 1;
  return `ln-${Date.now().toString(36)}-${_keyCounter}`;
}

/** Línea vacía con defaults razonables. tax_code se completa al render. */
export function makeEmptyLine(taxCodes: TaxCodeOption[]): InvoiceLineInput {
  // Default a ITBMS_7 si existe, fallback al primer tax_code.
  const itbms7 = taxCodes.find((t) => t.code === "ITBMS_7") ?? taxCodes[0];
  return {
    _key: newKey(),
    id: null,
    service_id: null,
    description: "",
    quantity: 1,
    unit_price: 0,
    tax_code_id: itbms7?.id ?? "",
    tax_code: itbms7?.code ?? "",
    tax_rate: itbms7?.rate ?? 0,
  };
}

/**
 * Editor de líneas dinámicas: add/remove + recálculo en tiempo real.
 * Cada línea es una "fila" responsive: en desktop horizontal, en mobile
 * se apila verticalmente con campos en grid 2 columnas.
 */
export function InvoiceLineItems({
  lines,
  services,
  taxCodes,
  invoiceKind,
  errors,
  onChange,
  disabled,
}: Props) {
  function patchLine(idx: number, patch: Partial<InvoiceLineInput>) {
    const next = [...lines];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function removeLine(idx: number) {
    onChange(lines.filter((_, i) => i !== idx));
  }

  function addLine() {
    onChange([...lines, makeEmptyLine(taxCodes)]);
  }

  function onServiceChange(idx: number, serviceId: string | null, service: ServiceOption | null) {
    if (serviceId === SERVICE_CUSTOM) {
      // Personalizado: limpiar service_id, mantener resto editable
      patchLine(idx, { service_id: null });
      return;
    }
    if (!service) {
      patchLine(idx, { service_id: null });
      return;
    }
    // Pre-rellenar description y tax_code default desde el servicio (D3)
    const taxCode = taxCodes.find((t) => t.code === service.default_tax_code);
    patchLine(idx, {
      service_id: service.id,
      description: service.name,
      tax_code_id: taxCode?.id ?? lines[idx].tax_code_id,
      tax_code: taxCode?.code ?? lines[idx].tax_code,
      tax_rate: taxCode?.rate ?? lines[idx].tax_rate,
    });
  }

  function onTaxChange(idx: number, taxCodeId: string, taxCode: TaxCodeOption | null) {
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
        <h2 className="text-base font-semibold text-integra-navy">Líneas de la factura</h2>
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
              service: errors[`lines.${idx}.service`],
              description: errors[`lines.${idx}.description`],
              quantity: errors[`lines.${idx}.quantity`],
              unit_price: errors[`lines.${idx}.unit_price`],
              tax_code_id: errors[`lines.${idx}.tax_code_id`],
            };
            // Para el ServiceCombobox: si la línea ya tiene service_id usamos ese,
            // si NO tiene service_id pero la línea se considera "personalizada"
            // (description editada manualmente) usamos SERVICE_CUSTOM. Solo
            // mostramos null cuando la línea está recién agregada y vacía.
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
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Línea {idx + 1}
                  </span>
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

                {/* Servicio + Descripción */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Servicio
                    </label>
                    <ServiceCombobox
                      services={services}
                      value={serviceValue}
                      filterKind={invoiceKind}
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

                {/* Cantidad / Precio / Impuesto */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Cantidad
                    </label>
                    <Input
                      type="number"
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
                      <Input
                        type="number"
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
