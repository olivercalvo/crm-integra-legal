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
import { INVOICE_KIND_LABEL } from "@/lib/finanzas/types/invoice";

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
    errors.lines = "Agregue al menos una línea a la factura";
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

// ---------------------------------------------------------------------------
// CONSISTENCIA invoice_kind ↔ service_type (17/09/2026)
// ---------------------------------------------------------------------------

/**
 * `service_type` de `services_catalog`, tal como lo necesita esta comparación.
 * No es el `ServiceOption` completo del catálogo: solo lo que hace falta para
 * decidir si el servicio combina con el tipo de factura, para que el mismo
 * objeto se pueda construir tanto desde `ServiceOption[]` en el cliente como
 * desde el SELECT server-side (`resolverServiciosPorId`, en `queries/catalogs.ts`).
 */
export interface ServicioParaConsistenciaDeKind {
  code: string;
  name: string;
  service_type: string;
}

/** El `service_type` que le corresponde a cada `invoice_kind`. */
const SERVICE_TYPE_ESPERADO: Record<InvoiceKind, string> = {
  HONORARIOS: "honorarios",
  REEMBOLSO: "reembolso",
};

/**
 * Josuarth Torres, por correo el 17/09/2026: *"Las facturas de reembolso solo
 * deben ser usadas para la facturación de lo que realmente representa un
 * reembolso de gasto y es exenta del impuesto."* En producción aparecieron
 * tres facturas FAC-REI-* con líneas HON-COR adentro — julio y agosto de 2026.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR DÓNDE ENTRÓ, Y POR QUÉ ESTO SE VALIDA ACÁ Y NO SOLO EN EL PICKER
 * ═════════════════════════════════════════════════════════════════════════════
 * El desplegable de servicio (`ServiceCombobox`, `filterKind`) YA filtra: si la
 * factura es HONORARIOS solo ofrece `service_type='honorarios'`, y viceversa.
 * Eso resuelve una línea NUEVA. No resuelve la línea que YA estaba elegida
 * cuando alguien cambia el "Tipo de documento" del encabezado después: el
 * `<select>` de `invoice-form.tsx` no tiene ningún efecto que reaccione a ese
 * cambio, así que la línea vieja queda huérfana y nadie lo nota hasta que el
 * documento ya se emitió. Ese es el hueco por el que entraron las tres.
 *
 * Cotizaciones YA resolvió el mismo problema, un nivel más abajo: en
 * `quote-lines-editor.tsx`, `onKindChange()` limpia el `service_id` de una
 * línea cuando su servicio deja de combinar con el kind (por-línea, ahí). Acá
 * es la misma idea pero contra el encabezado (una decisión, N líneas).
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * BLOQUEO DURO, EN LOS DOS SENTIDOS
 * ═════════════════════════════════════════════════════════════════════════════
 * Josuarth pidió "una alerta". Se decidió bloqueo duro (Oliver, 17/09/2026):
 * una advertencia que se puede ignorar es el mismo mecanismo por el que ya
 * pasó tres veces. La consecuencia es fiscal (la serie REI se declara exenta
 * ante la DGI), no cosmética. Y el caso espejo —honorarios con una línea
 * REIM-* adentro— se bloquea con la misma regla, sin costo aparte: es
 * exactamente lo que el filtro del combobox ya intenta para líneas nuevas.
 *
 * ⚠️ Una línea "Personalizada" (`service_id: null`) no tiene `service_type`:
 * queda FUERA de este control a propósito, igual que hoy queda fuera del
 * filtro del combobox. No hay cómo clasificar texto libre.
 *
 * Función PURA: no toca la base. El caller arma `serviciosPorId` — en el
 * cliente, desde el array `services` que ya tiene en memoria; en el servidor,
 * con `resolverServiciosPorId()` contra `services_catalog`, filtrado por
 * tenant. Así la MISMA regla corre en los dos lados sin duplicar lógica de
 * negocio — lo único que cada lado repite es armar el Map.
 */
export function validarConsistenciaDeKind(
  lineas: readonly Pick<InvoiceLineInput, "service_id">[],
  serviciosPorId: ReadonlyMap<string, ServicioParaConsistenciaDeKind>,
  invoiceKind: InvoiceKind
): ValidationErrors {
  const errors: ValidationErrors = {};
  const esperado = SERVICE_TYPE_ESPERADO[invoiceKind];
  const kindLabel = INVOICE_KIND_LABEL[invoiceKind];

  lineas.forEach((ln, i) => {
    if (!ln.service_id) return; // Personalizada: sin service_type, no se juzga.
    const svc = serviciosPorId.get(ln.service_id);
    if (!svc || svc.service_type === esperado) return;

    const otroKind: InvoiceKind = invoiceKind === "HONORARIOS" ? "REEMBOLSO" : "HONORARIOS";
    errors[`lines.${i}.service`] =
      `Este servicio es de ${INVOICE_KIND_LABEL[otroKind]}; una factura de ${kindLabel} no puede llevarlo.`;
  });

  return errors;
}

/**
 * El motivo único para el banner de arriba del formulario (SOP-027: un solo
 * motivo, el próximo paso, con el elemento concreto nombrado). Nombra la
 * PRIMERA línea con problema — no la lista completa — porque corregirla es lo
 * que hay que hacer antes de mirar cualquier otra cosa.
 */
export function motivoDeInconsistenciaDeKind(
  lineas: readonly Pick<InvoiceLineInput, "description" | "service_id">[],
  serviciosPorId: ReadonlyMap<string, ServicioParaConsistenciaDeKind>,
  invoiceKind: InvoiceKind
): string | null {
  const esperado = SERVICE_TYPE_ESPERADO[invoiceKind];
  const kindLabel = INVOICE_KIND_LABEL[invoiceKind];
  const otroKind: InvoiceKind = invoiceKind === "HONORARIOS" ? "REEMBOLSO" : "HONORARIOS";

  for (let i = 0; i < lineas.length; i++) {
    const ln = lineas[i];
    if (!ln.service_id) continue;
    const svc = serviciosPorId.get(ln.service_id);
    if (!svc || svc.service_type === esperado) continue;

    return (
      `No se puede guardar: la línea ${i + 1} (${svc.code} · ${svc.name}) es un servicio de ` +
      `${INVOICE_KIND_LABEL[otroKind]}, y esta factura es de ${kindLabel} — una factura de ` +
      `${kindLabel.toLowerCase()} solo puede llevar líneas de ${kindLabel.toLowerCase()}. ` +
      `Cambie el servicio de esa línea, o cambie el Tipo de documento a ${INVOICE_KIND_LABEL[otroKind]}.`
    );
  }
  return null;
}

