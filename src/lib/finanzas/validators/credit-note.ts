/**
 * Validación de una NOTA DE CRÉDITO por líneas (Bloque 5, 22/09/2026).
 *
 * Dos capas, las dos acá y las dos PURAS (sin Supabase):
 *
 *   validateCreateCreditNoteInput → la forma del request: factura, motivo,
 *     líneas con `invoice_line_id` y `quantity > 0`. Lo que un `curl` puede
 *     mandar mal.
 *
 *   validarLineasDeNotaDeCredito → la regla contable, contra lo que la base
 *     dice de la factura:
 *       · cada línea acredita como máximo lo facturado MENOS lo ya acreditado
 *         por NC anteriores de esa misma línea (D7: cantidades acumuladas);
 *       · el total de la NC no supera `balance_due` de la factura. Lo cobrado
 *         no se acredita: "reverse el cobro primero" (D7). El caso de Josuarth
 *         de acreditar una factura ya cobrada (saldo acreedor) es pregunta
 *         abierta en task_plan.md, no código.
 *     Devuelve las líneas listas para insertar (precio, impuesto y descripción
 *     copiados de la factura: una NC no inventa precios ni tasas) y el total
 *     que va a tener, calculado igual que T8c lo va a recalcular.
 *
 * Por qué por líneas y no por monto libre: la factura es líneas con cantidad,
 * precio y tasa, y su asiento se arma POR LÍNEA (cuenta de ingreso de cada
 * servicio, o 130003 en los REIM-*, e ITBMS por tasa). Una NC por líneas da el
 * asiento exacto sin prorratear entre cuentas ni tasas.
 */

import type { ValidationErrors, ValidationResult } from "@/lib/finanzas/validators/payment";
import { validarDescripcionDeLinea } from "@/lib/finanzas/validators/controles-dgi";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NC_MOTIVO_MIN = 3;
export const NC_MOTIVO_MAX = 1000;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lo que vale una línea acreditada: `quantity × unit_price`, redondeado, más su
 * ITBMS redondeado. Es el mismo cálculo que T8c hace en la base sobre
 * `credit_note_lines`, y el diálogo lo usa para el total en vivo: una sola
 * implementación, para que la vista previa no mienta.
 */
export function totalDeLineaDeNc(quantity: number, unitPrice: number, taxRate: number): number {
  const subtotal = round2(quantity * unitPrice);
  const impuesto = round2(subtotal * taxRate);
  return round2(subtotal + impuesto);
}

// ---------------------------------------------------------------------------
// Capa 1: la forma
// ---------------------------------------------------------------------------

export interface CreateCreditNoteInput {
  invoice_id: string;
  reason: string;
  observations: string | null;
  lineas: { invoice_line_id: string; quantity: number }[];
}

export function validateCreateCreditNoteInput(raw: unknown): ValidationResult<CreateCreditNoteInput> {
  const errors: ValidationErrors = {};
  const r = (raw ?? {}) as Record<string, unknown>;

  const invoiceId = String(r.invoice_id ?? "").trim();
  if (!UUID_RE.test(invoiceId)) errors.invoice_id = "Factura inválida";

  const reason = String(r.reason ?? "").trim();
  if (reason.length < NC_MOTIVO_MIN || reason.length > NC_MOTIVO_MAX) {
    errors.reason = `El motivo debe tener entre ${NC_MOTIVO_MIN} y ${NC_MOTIVO_MAX} caracteres.`;
  }

  let observations: string | null = null;
  if (r.observations != null && String(r.observations).trim() !== "") {
    const o = String(r.observations).trim();
    if (o.length > 2000) errors.observations = "Observaciones muy largas (máximo 2000 caracteres)";
    else observations = o;
  }

  const lineasRaw = Array.isArray(r.lineas) ? (r.lineas as unknown[]) : null;
  const lineas: CreateCreditNoteInput["lineas"] = [];
  if (!lineasRaw || lineasRaw.length === 0) {
    errors.lineas = "Elija al menos una línea de la factura para acreditar.";
  } else {
    const vistas = new Set<string>();
    lineasRaw.forEach((l, i) => {
      const x = (l ?? {}) as Record<string, unknown>;
      const id = String(x.invoice_line_id ?? "").trim();
      const qty = Number(x.quantity);
      if (!UUID_RE.test(id)) errors[`lineas.${i}.invoice_line_id`] = "Línea inválida";
      else if (vistas.has(id)) errors[`lineas.${i}.invoice_line_id`] = "La misma línea aparece dos veces";
      vistas.add(id);
      if (!isFinite(qty) || qty <= 0) errors[`lineas.${i}.quantity`] = "La cantidad debe ser mayor que 0";
      lineas.push({ invoice_line_id: id, quantity: qty });
    });
  }

  if (Object.keys(errors).length > 0) return { ok: false, data: null, errors };
  return { ok: true, errors: null, data: { invoice_id: invoiceId, reason, observations, lineas } };
}

// ---------------------------------------------------------------------------
// Capa 2: la regla contable, contra la factura
// ---------------------------------------------------------------------------

/** Una línea de la factura tal como la base la tiene. */
export interface LineaFacturada {
  id: string;
  line_order: number;
  service_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_code: string;
  tax_rate: number;
  tax_code_id: string | null;
}

/** Una línea lista para `credit_note_lines` (sin tenant/credit_note_id/created_by). */
export interface LineaDeNcParaInsertar {
  invoice_line_id: string;
  line_order: number;
  service_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_code: string;
  tax_rate: number;
  tax_code_id: string | null;
  /** Lo que T8c va a calcular; acá para el tope de balance_due. */
  line_total: number;
}

export type ResultadoValidacionNc =
  | { ok: true; lineas: LineaDeNcParaInsertar[]; total: number }
  | { ok: false; status: 400 | 409; mensaje: string; fieldErrors?: ValidationErrors };

export function validarLineasDeNotaDeCredito(args: {
  factura: { invoice_number: string; status: string; balance_due: number };
  facturadas: LineaFacturada[];
  /** Cantidad ya acreditada por NC anteriores, por `invoice_line_id`. */
  acreditadoPorLinea: Map<string, number>;
  pedido: CreateCreditNoteInput["lineas"];
}): ResultadoValidacionNc {
  const { factura, facturadas, acreditadoPorLinea, pedido } = args;

  if (factura.status === "anulada") {
    return { ok: false, status: 409, mensaje: "La factura está anulada: ya tiene su nota de crédito total." };
  }
  if (factura.status === "borrador" || factura.status === "cancelada_pre_emision") {
    return { ok: false, status: 409, mensaje: "Una factura no emitida no se acredita: se edita o se elimina." };
  }

  const porId = new Map(facturadas.map((l) => [l.id, l]));
  const fieldErrors: ValidationErrors = {};
  const lineas: LineaDeNcParaInsertar[] = [];

  pedido.forEach((p, i) => {
    const f = porId.get(p.invoice_line_id);
    if (!f) {
      fieldErrors[`lineas.${i}.invoice_line_id`] = "Esa línea no es de esta factura";
      return;
    }
    const disponible = round2(f.quantity - (acreditadoPorLinea.get(f.id) ?? 0));
    const excedida = errorDeCantidadAcreditable({
      descripcion: f.description,
      facturado: f.quantity,
      disponible,
      cantidad: p.quantity,
    });
    if (excedida) {
      fieldErrors[`lineas.${i}.quantity`] = excedida;
      return;
    }
    // 🔴 LA DESCRIPCIÓN SE HEREDA, ASÍ QUE SE HEREDA EL PROBLEMA.
    //    Una NC copia la descripción de la línea de la factura: no se escribe
    //    acá. Pero las facturas anteriores al 23/09/2026 se guardaron sin el
    //    tope de 500, así que una de ellas puede arrastrar una descripción que
    //    la DGI rechaza con `10105` — y la NC la llevaría intacta al PAC.
    //    Verificarlo acá es lo único que corta esa herencia.
    const desc = validarDescripcionDeLinea(f.description);
    if (!desc.ok) {
      fieldErrors[`lineas.${i}.description`] =
        `La línea "${String(f.description).slice(0, 40)}…" de la factura no se puede acreditar ` +
        `tal como está: ${desc.mensaje} Corrija la descripción en la factura antes de emitir la nota de crédito.`;
      return;
    }

    lineas.push({
      invoice_line_id: f.id,
      line_order: f.line_order,
      service_id: f.service_id,
      description: f.description,
      quantity: p.quantity,
      unit_price: f.unit_price,
      tax_code: f.tax_code,
      tax_rate: f.tax_rate,
      tax_code_id: f.tax_code_id,
      line_total: totalDeLineaDeNc(p.quantity, f.unit_price, f.tax_rate),
    });
  });

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, status: 400, mensaje: "Revise las líneas de la nota de crédito", fieldErrors };
  }

  const total = round2(lineas.reduce((s, l) => s + l.line_total, 0));
  if (total <= 0) {
    return { ok: false, status: 400, mensaje: "La nota de crédito tiene que ser mayor que cero." };
  }
  if (total > factura.balance_due + 0.005) {
    return {
      ok: false,
      status: 409,
      mensaje:
        `La nota de crédito (B/. ${total.toFixed(2)}) supera el saldo pendiente de la factura ` +
        `${factura.invoice_number} (B/. ${factura.balance_due.toFixed(2)}). Lo ya cobrado no se acredita: ` +
        `reverse el cobro primero, o acredite hasta el saldo.`,
    };
  }

  return { ok: true, lineas, total };
}

/**
 * El tope de UNA línea: no se acredita más de lo facturado menos lo ya
 * acreditado por NC vigentes. `null` si la cantidad cabe.
 *
 * 🔒 Es la MISMA función que usa el diálogo para frenar en pantalla (desde el
 * 25/09/2026). Antes el diálogo calculaba el total con cualquier cantidad y el
 * botón seguía activo; el tope solo aparecía al registrar. Una sola función,
 * un solo texto: `credit-note-tope-en-pantalla.test.ts` falla si el diálogo
 * vuelve a comparar por su cuenta.
 */
export function errorDeCantidadAcreditable(x: {
  descripcion: string;
  facturado: number;
  disponible: number;
  cantidad: number;
}): string | null {
  if (x.cantidad <= x.disponible + 1e-9) return null;
  if (x.disponible <= 0) return `La línea "${x.descripcion}" ya está acreditada por completo.`;
  return (
    `La línea "${x.descripcion}" tiene ${x.disponible} disponible(s) para acreditar ` +
    `(facturado ${x.facturado}, ya acreditado ${round2(x.facturado - x.disponible)}).`
  );
}
