/**
 * Validadores manuales para payments — sin Zod, sin react-hook-form.
 *
 * Mismo patrón que validators/business-expense.ts y validators/invoice.ts:
 * cada validador devuelve `{ ok: true, data } | { ok: false, errors }` con
 * `errors` como mapa flat campo → mensaje en español.
 *
 * NOTA sobre el cap del monto (D9): este validador NO conoce balance_due —
 * es responsabilidad del helper server-side createPayment hacer el lookup
 * de la factura y rechazar si amount > balance_due. Acá solo validamos
 * formato y rangos básicos.
 */

import type {
  CreatePaymentInput,
  PaymentApplicationInput,
  PaymentMethod,
} from "@/lib/finanzas/types/payment";
import { PAYMENT_METHODS } from "@/lib/finanzas/types/payment";

export type ValidationErrors = Record<string, string>;

export type ValidationResult<T> =
  | { ok: true; data: T; errors: null }
  | { ok: false; data: null; errors: ValidationErrors };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Un recibo con más facturas que esto es un error de carga, no un caso real. */
export const MAX_APPLICATIONS = 50;

function fmt(n: number): string {
  return `B/. ${round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Las aplicaciones: una o varias facturas, sin repetir, cada monto > 0.
 * Devuelve la lista limpia (montos redondeados) o los errores.
 */
function validateApplications(
  raw: unknown,
  errors: ValidationErrors
): PaymentApplicationInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.applications = "Elija al menos una factura a la que aplicar el cobro.";
    return [];
  }
  if (raw.length > MAX_APPLICATIONS) {
    errors.applications = `Un recibo no puede aplicarse a más de ${MAX_APPLICATIONS} facturas.`;
    return [];
  }
  const vistas = new Set<string>();
  const limpias: PaymentApplicationInput[] = [];
  (raw as Partial<PaymentApplicationInput>[]).forEach((a, i) => {
    const invoiceId = String(a?.invoice_id ?? "").trim();
    if (!invoiceId || !UUID_RE.test(invoiceId)) {
      errors.applications = `Factura inválida en la línea ${i + 1}.`;
      return;
    }
    if (vistas.has(invoiceId)) {
      errors.applications = "Una factura no puede aparecer dos veces en el mismo recibo.";
      return;
    }
    vistas.add(invoiceId);
    const amount = Number(a?.amount);
    if (!isFinite(amount) || amount <= 0) {
      // El CHECK de payment_applications prohíbe montos en cero: una fila
      // en 0 no se manda, se saca.
      errors.applications = `El monto aplicado a la factura de la línea ${i + 1} debe ser mayor a 0.`;
      return;
    }
    limpias.push({ invoice_id: invoiceId, amount: round2(amount) });
  });
  return limpias;
}

export function validateCreatePayment(
  raw: Partial<CreatePaymentInput> | null | undefined
): ValidationResult<CreatePaymentInput> {
  const errors: ValidationErrors = {};

  // applications: una o varias facturas
  const applications = validateApplications(raw?.applications, errors);

  // payment_date
  const paymentDate = String(raw?.payment_date ?? "").trim();
  if (!paymentDate || !DATE_RE.test(paymentDate)) {
    errors.payment_date = "Fecha del pago inválida (esperado YYYY-MM-DD)";
  }

  // amount > 0, y == la suma de lo aplicado. El excedente se RECHAZA (no hay
  // dónde ponerlo hasta que el bufete defina anticipos) y el faltante también
  // (un recibo que no coincide con la transferencia rompe la conciliación).
  // El mensaje dice los dos montos y la salida (SOP-027).
  const amount = Number(raw?.amount);
  if (!isFinite(amount) || amount <= 0) {
    errors.amount = "El monto debe ser mayor a 0";
  } else if (amount > 9_999_999.99) {
    errors.amount = "Monto fuera de rango";
  } else if (!errors.applications && applications.length > 0) {
    const aplicado = round2(applications.reduce((acc, a) => acc + a.amount, 0));
    const diferencia = round2(amount - aplicado);
    if (Math.abs(diferencia) > 0.005) {
      errors.amount =
        diferencia > 0
          ? `La transferencia es de ${fmt(amount)} y las facturas seleccionadas suman ${fmt(aplicado)}. ` +
            `Un recibo tiene que coincidir con la transferencia para que el banco concilie. ` +
            `Seleccione otra factura pendiente del mismo cliente por el resto (${fmt(diferencia)}) o ajuste el monto.`
          : `El monto del recibo es ${fmt(amount)} pero lo aplicado a las facturas suma ${fmt(aplicado)}: ` +
            `sobran ${fmt(-diferencia)} aplicados. Baje lo aplicado o suba el monto del recibo.`;
    }
  }

  // method (whitelist)
  const method = String(raw?.method ?? "") as PaymentMethod;
  if (!PAYMENT_METHODS.includes(method)) {
    errors.method = "Método de pago inválido";
  }

  // reference (opcional, longitud)
  let reference: string | null = null;
  if (raw?.reference != null && String(raw.reference).trim() !== "") {
    const r = String(raw.reference).trim();
    if (r.length > 200) {
      errors.reference = "Referencia muy larga (máximo 200 caracteres)";
    } else {
      reference = r;
    }
  }

  // 🔴 payment_account_code — OBLIGATORIO. El banco lo elige quien registra,
  //    sin default (Rose, 25/08). La existencia de la cuenta en el plan la
  //    verifica el servidor con un lookup; acá solo presencia y formato.
  let paymentAccountCode: string | null = null;
  const rawCta = raw?.payment_account_code;
  if (rawCta == null || String(rawCta).trim() === "") {
    errors.payment_account_code =
      "Elija la cuenta bancaria donde entró el cobro.";
  } else {
    const code = String(rawCta).trim();
    if (code.length > 20) {
      errors.payment_account_code = "Código de cuenta muy largo";
    } else {
      paymentAccountCode = code;
    }
  }

  // notes (opcional, longitud)
  let notes: string | null = null;
  if (raw?.notes != null && String(raw.notes).trim() !== "") {
    const n = String(raw.notes).trim();
    if (n.length > 1000) {
      errors.notes = "Nota muy larga (máximo 1000 caracteres)";
    } else {
      notes = n;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  return {
    ok: true,
    errors: null,
    data: {
      applications,
      payment_date: paymentDate,
      amount: round2(amount),
      method,
      payment_account_code: paymentAccountCode,
      reference,
      notes,
    },
  };
}
