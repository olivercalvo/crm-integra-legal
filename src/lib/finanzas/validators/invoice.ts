/**
 * Validadores manuales para facturas — sin Zod, sin react-hook-form.
 *
 * Patrón: cada validador devuelve `{ ok: true, data } | { ok: false, errors }`.
 * `errors` es un mapa flat campo → mensaje en español, listo para mostrar
 * inline en el form. Las líneas reportan errores con prefijo `lines.<idx>.<campo>`.
 *
 * Consistente con cómo /legal hace validación inline en case-form.tsx
 * (useState + setError(string|null)) — acá lo elevamos a un helper
 * reutilizable porque las facturas tienen líneas dinámicas.
 */

import type {
  CreateInvoiceInput,
  UpdateInvoiceInput,
  InvoiceLineInput,
  InvoiceKind,
} from "@/lib/finanzas/types/invoice";

export type ValidationErrors = Record<string, string>;

export type ValidationResult<T> =
  | { ok: true; data: T; errors: null }
  | { ok: false; data: null; errors: ValidationErrors };

const VALID_KINDS: InvoiceKind[] = ["HONORARIOS", "REEMBOLSO"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida una línea individual. Devuelve un mapa de errores con keys planos
 * (sin prefijo `lines.<idx>` — ese lo agrega el caller).
 */
function validateLine(line: Partial<InvoiceLineInput>): ValidationErrors {
  const e: ValidationErrors = {};

  if (!line.description || !String(line.description).trim()) {
    e.description = "Descripción requerida";
  }

  const qty = Number(line.quantity);
  if (!isFinite(qty) || qty <= 0) {
    e.quantity = "Cantidad debe ser mayor a 0";
  }

  const price = Number(line.unit_price);
  if (!isFinite(price) || price < 0) {
    e.unit_price = "Precio no puede ser negativo";
  }

  if (!line.tax_code_id || !UUID_RE.test(String(line.tax_code_id))) {
    e.tax_code_id = "Impuesto requerido";
  }

  if (!line.tax_code || !String(line.tax_code).trim()) {
    e.tax_code = "Código de impuesto requerido";
  }

  const rate = Number(line.tax_rate);
  if (!isFinite(rate) || rate < 0 || rate > 1) {
    e.tax_rate = "Tasa fuera de rango";
  }

  return e;
}

/** Valida un payload de creación. */
export function validateCreateInvoice(
  raw: Partial<CreateInvoiceInput>
): ValidationResult<CreateInvoiceInput> {
  const errors: ValidationErrors = {};

  if (!raw.client_id || !UUID_RE.test(String(raw.client_id))) {
    errors.client_id = "Cliente requerido";
  }

  if (!raw.invoice_kind || !VALID_KINDS.includes(raw.invoice_kind as InvoiceKind)) {
    errors.invoice_kind = "Tipo de factura requerido";
  }

  if (!raw.issue_date || !DATE_RE.test(String(raw.issue_date))) {
    errors.issue_date = "Fecha de emisión inválida";
  }

  if (!raw.due_date || !DATE_RE.test(String(raw.due_date))) {
    errors.due_date = "Fecha de vencimiento inválida";
  }

  if (raw.issue_date && raw.due_date && raw.due_date < raw.issue_date) {
    errors.due_date = "Vencimiento no puede ser anterior a la emisión";
  }

  if (raw.case_id && !UUID_RE.test(String(raw.case_id))) {
    errors.case_id = "Caso inválido";
  }

  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  if (lines.length === 0) {
    errors.lines = "Agregá al menos una línea a la factura";
  } else {
    lines.forEach((ln, idx) => {
      const lineErrors = validateLine(ln);
      for (const [k, v] of Object.entries(lineErrors)) {
        errors[`lines.${idx}.${k}`] = v;
      }
    });
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  return {
    ok: true,
    errors: null,
    data: {
      invoice_kind: raw.invoice_kind as InvoiceKind,
      client_id: raw.client_id as string,
      case_id: raw.case_id ?? null,
      issue_date: raw.issue_date as string,
      due_date: raw.due_date as string,
      notes: raw.notes ?? null,
      lines: lines.map((ln) => ({
        service_id: ln.service_id ?? null,
        description: String(ln.description).trim(),
        quantity: Number(ln.quantity),
        unit_price: Number(ln.unit_price),
        tax_code_id: String(ln.tax_code_id),
        tax_code: String(ln.tax_code),
        tax_rate: Number(ln.tax_rate),
      })),
    },
  };
}

/** Valida un payload de actualización. Igual a create pero conserva line.id. */
export function validateUpdateInvoice(
  raw: Partial<UpdateInvoiceInput>
): ValidationResult<UpdateInvoiceInput> {
  // Reuso validateCreateInvoice y luego mergeo line.id si existía.
  const base = validateCreateInvoice(raw as Partial<CreateInvoiceInput>);
  if (!base.ok) return base as ValidationResult<UpdateInvoiceInput>;

  const lines = Array.isArray(raw.lines) ? raw.lines : [];

  return {
    ok: true,
    errors: null,
    data: {
      ...base.data,
      lines: base.data.lines.map((ln, idx) => ({
        _key: lines[idx]?._key ?? String(idx),
        id: lines[idx]?.id ?? null,
        ...ln,
      })),
    },
  };
}

/**
 * Para validación step-by-step en el form (mostrar errores en tiempo real
 * sin disparar el submit). Devuelve solo el mapa de errores.
 */
export function validateLineForUI(line: Partial<InvoiceLineInput>): ValidationErrors {
  return validateLine(line);
}

// ---------- Helpers de cálculo client-side --------------------------------

/**
 * Recalcula los totales en cliente para feedback inmediato (D5). El server
 * los recalcula via trigger T8b al guardar (truth) — esto es solo display.
 */
export function calcTotalsClient(lines: Pick<InvoiceLineInput, "quantity" | "unit_price" | "tax_rate">[]) {
  let subtotal = 0;
  let taxTotal = 0;
  for (const ln of lines) {
    const q = Number(ln.quantity) || 0;
    const p = Number(ln.unit_price) || 0;
    const r = Number(ln.tax_rate) || 0;
    const lineSub = q * p;
    subtotal += lineSub;
    taxTotal += lineSub * r;
  }
  // Round a 2 decimales como hace NUMERIC(12,2).
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    subtotal: round2(subtotal),
    taxTotal: round2(taxTotal),
    grandTotal: round2(subtotal + taxTotal),
  };
}
