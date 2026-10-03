/**
 * Validación de una NOTA DE CRÉDITO por líneas (Bloque 5, 22/09/2026; módulo
 * propio desde E8, 01/10/2026).
 *
 * 🔴 E8: la factura es OPCIONAL y las líneas son EDITABLES (cantidad, precio,
 *    descripción, gravada o exenta). Con factura, sus líneas son el valor
 *    INICIAL; sin factura, la NC es saldo a favor del cliente. La NC de venta
 *    sin factura está apagada detrás de `PERMITIR_NC_VENTA_SIN_FACTURA` hasta
 *    que Josuarth conteste P-4a (no se puede mandar a la DGI sin documento
 *    referenciado, y entonces no resta ITBMS).
 *
 * Dos capas, las dos acá y las dos PURAS (sin Supabase):
 *
 *   validateCreateCreditNoteInput → la forma del request: factura (opcional),
 *     motivo, líneas con `quantity > 0`. Lo que un `curl` puede mandar mal.
 *
 *   validarLineasDeNotaDeCredito → la regla contable, contra lo que la base
 *     dice de la factura:
 *       · una línea de la factura acredita como máximo lo facturado MENOS lo ya
 *         acreditado por NC anteriores de esa misma línea (D7: cantidades
 *         acumuladas);
 *       · el total de la NC no supera `balance_due` de la factura. Lo cobrado
 *         no se acredita: "reverse el cobro primero" (D7).
 *     Devuelve las líneas listas para insertar y el total que va a tener,
 *     calculado igual que T8c lo va a recalcular. Una línea de la factura trae
 *     su precio, tasa y descripción como valor inicial; el precio puede bajar
 *     pero no subir sobre el de la factura (P-4b, valor por defecto) y la tasa
 *     sale SIEMPRE del catálogo, nunca del body.
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
 * `credit_note_lines`, y la pantalla lo usa para el total en vivo: una sola
 * implementación, para que la vista previa no mienta.
 */
export function totalDeLineaDeNc(quantity: number, unitPrice: number, taxRate: number): number {
  const subtotal = round2(quantity * unitPrice);
  const impuesto = round2(subtotal * taxRate);
  return round2(subtotal + impuesto);
}

// ---------------------------------------------------------------------------
// La NC de venta SIN factura (P-4a)
// ---------------------------------------------------------------------------

/**
 * 🟢 UNA SOLA CONSTANTE, ENCENDIDA (Josuarth, reunión del 02/10/2026, P-4a):
 * la NC de venta sin factura SÍ se permite, como DOCUMENTO INTERNO. Queda como
 * saldo a favor del cliente y se aplica desde su detalle.
 *
 * Lo que NO cambia: no se manda a la DGI (`emit-credit-note-to-efactura.ts`
 * corta con 409 antes del correlativo) y, como no está autorizada, no resta
 * ITBMS (`vat-calculo.ts`). Ese envío (¿tipo 06?) se activa después del
 * inventario de facturación electrónica, no con esta constante.
 */
export const PERMITIR_NC_VENTA_SIN_FACTURA = true;

export const MENSAJE_NC_VENTA_SIN_FACTURA =
  "Por ahora la nota de crédito de venta necesita una factura: sin factura no se puede enviar a la DGI. Elige la factura que corrige.";

// ---------------------------------------------------------------------------
// Capa 1: la forma
// ---------------------------------------------------------------------------

/**
 * Una línea pedida. Con `invoice_line_id`, todo lo demás es opcional y cae en
 * lo de la factura. Sin ella (línea nueva), servicio, descripción, precio e
 * impuesto son obligatorios.
 */
export interface LineaPedidaNc {
  invoice_line_id: string | null;
  quantity: number;
  service_id?: string | null;
  description?: string;
  unit_price?: number;
  tax_code_id?: string | null;
}

export interface CreateCreditNoteInput {
  /** La factura que corrige. `null` = sin factura (saldo a favor; ver P-4a). */
  invoice_id: string | null;
  /** El cliente. Con factura se toma el de la factura; sin factura, obligatorio. */
  client_id?: string | null;
  reason: string;
  observations: string | null;
  lineas: LineaPedidaNc[];
  /**
   * Fecha de REGISTRO (contable) de la NC. La elige el contador (revisión del
   * 28/09 y reunión del 30/09); sin ella, hoy en Panamá. La valida el servidor
   * contra la base (período abierto): acá solo se transporta.
   */
  fecha_registro?: string | null;
}

export function validateCreateCreditNoteInput(raw: unknown): ValidationResult<CreateCreditNoteInput> {
  const errors: ValidationErrors = {};
  const r = (raw ?? {}) as Record<string, unknown>;

  const invoiceRaw = String(r.invoice_id ?? "").trim();
  const invoiceId = invoiceRaw === "" ? null : invoiceRaw;
  if (invoiceId !== null && !UUID_RE.test(invoiceId)) errors.invoice_id = "Factura inválida";

  const clientRaw = String(r.client_id ?? "").trim();
  const clientId = clientRaw === "" ? null : clientRaw;
  if (clientId !== null && !UUID_RE.test(clientId)) errors.client_id = "Cliente inválido";
  if (invoiceId === null) {
    if (!PERMITIR_NC_VENTA_SIN_FACTURA) errors.invoice_id = MENSAJE_NC_VENTA_SIN_FACTURA;
    else if (clientId === null) errors.client_id = "Elige el cliente de la nota de crédito.";
  }

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
  const lineas: LineaPedidaNc[] = [];
  if (!lineasRaw || lineasRaw.length === 0) {
    errors.lineas = "Agrega al menos una línea a la nota de crédito.";
  } else {
    const vistas = new Set<string>();
    lineasRaw.forEach((l, i) => {
      const x = (l ?? {}) as Record<string, unknown>;
      const idRaw = String(x.invoice_line_id ?? "").trim();
      const id = idRaw === "" ? null : idRaw;
      const qty = Number(x.quantity);
      if (id !== null) {
        if (!UUID_RE.test(id)) errors[`lineas.${i}.invoice_line_id`] = "Línea inválida";
        else if (vistas.has(id)) errors[`lineas.${i}.invoice_line_id`] = "La misma línea aparece dos veces";
        vistas.add(id);
      }
      if (!isFinite(qty) || qty <= 0) errors[`lineas.${i}.quantity`] = "La cantidad debe ser mayor que 0";

      const linea: LineaPedidaNc = { invoice_line_id: id, quantity: qty };
      if (x.service_id !== undefined) {
        const sid = x.service_id === null ? "" : String(x.service_id).trim();
        if (sid !== "" && !UUID_RE.test(sid)) errors[`lineas.${i}.service`] = "Servicio inválido";
        linea.service_id = sid === "" ? null : sid;
      }
      if (x.description !== undefined && x.description !== null) linea.description = String(x.description);
      if (x.unit_price !== undefined && x.unit_price !== null && String(x.unit_price) !== "") {
        const precio = Number(x.unit_price);
        if (!isFinite(precio) || precio <= 0) errors[`lineas.${i}.unit_price`] = "El precio debe ser mayor que 0";
        linea.unit_price = precio;
      }
      if (x.tax_code_id !== undefined) {
        const tid = x.tax_code_id === null ? "" : String(x.tax_code_id).trim();
        if (tid !== "" && !UUID_RE.test(tid)) errors[`lineas.${i}.tax_code_id`] = "Impuesto inválido";
        linea.tax_code_id = tid === "" ? null : tid;
      }
      if (id === null) {
        if (!linea.service_id) errors[`lineas.${i}.service`] = "Elige el servicio: de él sale la cuenta de ingreso.";
        if (!linea.description || linea.description.trim() === "") errors[`lineas.${i}.description`] = "Escribe la descripción.";
        if (linea.unit_price === undefined) errors[`lineas.${i}.unit_price`] = "Escribe el precio.";
        if (!linea.tax_code_id) errors[`lineas.${i}.tax_code_id`] = "Elige si la línea es gravada o exenta.";
      }
      lineas.push(linea);
    });
  }

  if (Object.keys(errors).length > 0) return { ok: false, data: null, errors };
  const fechaRegistro = typeof r.fecha_registro === "string" && r.fecha_registro.trim() !== ""
    ? r.fecha_registro.trim()
    : null;

  return {
    ok: true,
    errors: null,
    data: { invoice_id: invoiceId, client_id: clientId, reason, observations, lineas, fecha_registro: fechaRegistro },
  };
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

/** Una tasa del catálogo (`tax_codes`): de acá sale la tasa, nunca del body. */
export interface TasaDelCatalogo {
  code: string;
  rate: number;
  active: boolean;
}

/** Una línea lista para `credit_note_lines` (sin tenant/credit_note_id/created_by). */
export interface LineaDeNcParaInsertar {
  invoice_line_id: string | null;
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
  /** `null` = NC sin factura: sin tope y sin líneas de factura. */
  factura: { invoice_number: string; status: string; balance_due: number } | null;
  facturadas: LineaFacturada[];
  /** Cantidad ya acreditada por NC anteriores, por `invoice_line_id`. */
  acreditadoPorLinea: Map<string, number>;
  pedido: LineaPedidaNc[];
  /** El catálogo de tasas, por id. Hace falta si una línea cambia o trae su impuesto. */
  tasas?: Map<string, TasaDelCatalogo>;
}): ResultadoValidacionNc {
  const { factura, facturadas, acreditadoPorLinea, pedido } = args;
  const tasas = args.tasas ?? new Map<string, TasaDelCatalogo>();

  if (factura) {
    if (factura.status === "anulada") {
      return { ok: false, status: 409, mensaje: "La factura está anulada: ya tiene su nota de crédito total." };
    }
    if (factura.status === "borrador" || factura.status === "cancelada_pre_emision") {
      return { ok: false, status: 409, mensaje: "Una factura no emitida no se acredita: se edita o se elimina." };
    }
  }

  const porId = new Map(facturadas.map((l) => [l.id, l]));
  const fieldErrors: ValidationErrors = {};
  const lineas: LineaDeNcParaInsertar[] = [];

  pedido.forEach((p, i) => {
    const f = p.invoice_line_id ? porId.get(p.invoice_line_id) : undefined;
    if (p.invoice_line_id && (!f || !factura)) {
      fieldErrors[`lineas.${i}.invoice_line_id`] = "Esa línea no es de esta factura";
      return;
    }

    // ---- La cantidad: de una línea de la factura, no más de lo que queda ----
    if (f) {
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
    }

    // ---- El precio: el de la factura como tope (P-4b, valor por defecto) ----
    const precio = p.unit_price ?? f?.unit_price ?? 0;
    if (!(precio > 0)) {
      fieldErrors[`lineas.${i}.unit_price`] = "El precio debe ser mayor que 0";
      return;
    }
    if (f && precio > f.unit_price + 0.005) {
      fieldErrors[`lineas.${i}.unit_price`] =
        `El precio no puede ser mayor que el de la factura (B/. ${f.unit_price.toFixed(2)}).`;
      return;
    }

    // ---- El impuesto: del catálogo, nunca del body ----
    const taxId = p.tax_code_id !== undefined ? p.tax_code_id : f?.tax_code_id ?? null;
    let taxCode = f?.tax_code ?? "";
    let taxRate = f?.tax_rate ?? 0;
    if (!f || taxId !== f.tax_code_id) {
      const t = taxId ? tasas.get(taxId) : undefined;
      if (!t || !t.active) {
        fieldErrors[`lineas.${i}.tax_code_id`] = "Elige un impuesto activo del catálogo.";
        return;
      }
      taxCode = t.code;
      taxRate = t.rate;
    }

    // 🔴 LA DESCRIPCIÓN VA A LA DGI. Las facturas anteriores al 23/09/2026 se
    //    guardaron sin el tope de 500, y una NC que hereda la descripción
    //    heredaría el rechazo `10105`. Por eso se valida la que queda, sea la
    //    heredada o la editada.
    const descripcion = (p.description ?? f?.description ?? "").trim();
    const desc = validarDescripcionDeLinea(descripcion);
    if (!desc.ok) {
      fieldErrors[`lineas.${i}.description`] =
        f && p.description === undefined
          ? `La línea "${String(f.description).slice(0, 40)}…" de la factura no se puede acreditar ` +
            `tal como está: ${desc.mensaje} Corrige la descripción antes de emitir la nota de crédito.`
          : desc.mensaje;
      return;
    }

    const servicio = p.service_id !== undefined ? p.service_id : f?.service_id ?? null;
    if (!servicio) {
      fieldErrors[`lineas.${i}.service`] = "Elige el servicio: de él sale la cuenta de ingreso.";
      return;
    }

    lineas.push({
      invoice_line_id: f?.id ?? null,
      line_order: i + 1,
      service_id: servicio,
      description: descripcion,
      quantity: p.quantity,
      unit_price: precio,
      tax_code: taxCode,
      tax_rate: taxRate,
      tax_code_id: taxId,
      line_total: totalDeLineaDeNc(p.quantity, precio, taxRate),
    });
  });

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, status: 400, mensaje: "Revisa las líneas de la nota de crédito", fieldErrors };
  }

  const total = round2(lineas.reduce((s, l) => s + l.line_total, 0));
  if (total <= 0) {
    return { ok: false, status: 400, mensaje: "La nota de crédito tiene que ser mayor que cero." };
  }
  if (factura && total > factura.balance_due + 0.005) {
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
 * 🔒 Es la MISMA función que usa la pantalla para frenar en vivo (desde el
 * 25/09/2026). Antes el diálogo calculaba el total con cualquier cantidad y el
 * botón seguía activo; el tope solo aparecía al registrar. Una sola función,
 * un solo texto: `credit-note-tope-en-pantalla.test.ts` falla si la pantalla
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
