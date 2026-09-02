/**
 * Tipos del módulo de Proveedores.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RUC Y DV VIVEN SEPARADOS, SIEMPRE
 * ─────────────────────────────────────────────────────────────────────────────
 * Es el requisito literal de Josuarth (25/08/2026): los anexos de la declaración
 * de renta van "con el RUC en una columna y el DV en otra columna porque así
 * está en el formulario de la DGI".
 *
 * Por eso NO existe en este archivo —ni en ningún otro— una función que
 * devuelva "RUC-DV" en un solo string. Si alguna vez hace falta mostrarlos
 * juntos, se muestran en dos elementos, no en uno concatenado. Un helper de
 * concatenación es exactamente el atajo que después termina guardado en la base.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS TÉRMINOS DE PAGO NO SON LOS TRAMOS DE LA ANTIGÜEDAD
 * ─────────────────────────────────────────────────────────────────────────────
 * `payment_terms_days` es el PLAZO del proveedor: contado, 30, 60, 90 días. De
 * ese plazo sale la fecha de vencimiento del gasto, y de la fecha de vencimiento
 * salen los tramos del reporte. Son tres cosas encadenadas, no la misma.
 */

/** Fila de `suppliers` tal como viene del SELECT. */
export interface SupplierRow {
  id: string;
  tenant_id: string;
  /** PRV-001. La secuencia que pidió Josuarth. */
  supplier_number: string;
  /** Razón social: la que figura en el RUC. */
  legal_name: string;
  /** Razón comercial: con la que se la conoce. */
  trade_name: string | null;
  /** RUC SIN el dígito verificador. */
  ruc: string | null;
  /** Dígito verificador, en su propia columna. */
  dv: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** Plazo en días. 0 = contado. */
  payment_terms_days: number;
  active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Item del listado, con el resumen de sus gastos. */
export interface SupplierListItem extends SupplierRow {
  /** Cuántos gastos tiene registrados. */
  expense_count: number;
  /** Cuánto se le debe hoy (gastos pendientes de pago). */
  pending_total: number;
}

/** Payload de creación. */
export interface CreateSupplierInput {
  legal_name: string;
  trade_name: string | null;
  ruc: string | null;
  dv: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  payment_terms_days: number;
  active: boolean;
  notes: string | null;
}

/** Payload de actualización. Mismos campos. */
export type UpdateSupplierInput = CreateSupplierInput;

// ---------------------------------------------------------------------------
// TÉRMINOS DE PAGO
// ---------------------------------------------------------------------------

/**
 * Los plazos habituales, para ofrecerlos como atajo en el formulario.
 *
 * Es una lista de SUGERENCIAS, no una whitelist: el campo acepta cualquier
 * número de 0 a 365. Josuarth nombró "contado, 30, 60, 90"; que un proveedor
 * trabaje a 45 no puede ser motivo para no poder cargarlo.
 */
export const PAYMENT_TERMS_SUGERIDOS = [0, 15, 30, 45, 60, 90] as const;

export const PAYMENT_TERMS_MIN = 0;
export const PAYMENT_TERMS_MAX = 365;

/** "Contado" · "30 días". */
export function paymentTermsLabel(dias: number): string {
  if (dias <= 0) return "Contado";
  return `${dias} día${dias === 1 ? "" : "s"}`;
}

/**
 * La fecha de vencimiento que le corresponde a un gasto según el plazo del
 * proveedor. Es un DEFAULT, no una imposición: el formulario lo propone y la
 * persona puede cambiarlo, porque manda lo que diga el comprobante.
 *
 * Trabaja en texto YYYY-MM-DD y en UTC para no depender del huso de quien
 * ejecuta: sumar días a una fecha no es una operación con hora.
 */
export function vencimientoPorPlazo(fechaGasto: string, plazoDias: number): string {
  const base = new Date(`${fechaGasto}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return fechaGasto;
  base.setUTCDate(base.getUTCDate() + Math.max(0, Math.trunc(plazoDias)));
  return base.toISOString().slice(0, 10);
}

/** El nombre con el que se muestra un proveedor: la comercial si la tiene. */
export function nombreDeProveedor(s: Pick<SupplierRow, "legal_name" | "trade_name">): string {
  const comercial = s.trade_name?.trim();
  return comercial && comercial.length > 0 ? comercial : s.legal_name;
}
