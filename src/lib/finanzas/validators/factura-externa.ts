/**
 * «Registrar factura emitida fuera» (`092`): el pedido, validado.
 *
 * Una factura que la DGI ya autorizó desde otro punto (QuickBooks 050, portal
 * 100) entra al CRM con su CUFE, su asiento y su número `FAC-EXT-`. Lo que se
 * valida acá, además de lo de cualquier factura (`validateCreateInvoice`):
 *
 *   1. El CUFE se lee (`leerCufe`) y su tipo, fecha, punto y número se comparan
 *      con lo cargado. Si no coinciden, no se guarda: es casi seguro el CUFE de
 *      otra factura.
 *   2. La base y el ITBMS del documento autorizado se cargan aparte (el CUFE no
 *      trae montos) y las líneas tienen que dar exactamente eso.
 *   3. Cada línea con un servicio del catálogo: es lo que dice a qué cuenta de
 *      ingreso va, y una factura de afuera no tiene otra forma de decirlo.
 *
 * 🔒 Pantalla y servidor usan esta MISMA función. La base vuelve a exigir todo
 *    en el RPC `register_external_invoice`.
 *
 * Módulo PURO.
 */

import { validateCreateInvoice, type ValidationErrors } from "@/lib/finanzas/validators/invoice";
import {
  compararCufeConFactura,
  leerCufe,
  normalizarPunto,
  type CufeLeido,
} from "@/lib/finanzas/efactura/cufe/leer-cufe";
import type { CreateInvoiceInput, InvoiceLineInput } from "@/lib/finanzas/types/invoice";

export interface FacturaExternaInput {
  invoice_kind: "HONORARIOS" | "REEMBOLSO";
  client_id: string;
  case_id: string | null;
  issue_date: string;
  accounting_date: string;
  due_date: string;
  notes: string | null;
  cufe: string;
  punto: string;
  numero_documento: number;
  base_autorizada: number;
  itbms_autorizado: number;
  lines: Array<Omit<InvoiceLineInput, "_key" | "id">>;
}

export type ResultadoFacturaExterna =
  | { ok: true; data: FacturaExternaInput; leido: CufeLeido; errors: null }
  | { ok: false; data: null; leido: CufeLeido | null; errors: ValidationErrors };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Base e ITBMS de las líneas, como los calcula la base: suma sin redondear
 * por línea y redondeo a dos decimales al final (las columnas generadas de
 * `invoice_lines` y `numeric(12,2)` en `invoices`).
 */
export function totalesDeLineas(
  lines: readonly Pick<InvoiceLineInput, "quantity" | "unit_price" | "tax_rate">[]
): { base: number; itbms: number; total: number } {
  let base = 0;
  let itbms = 0;
  for (const l of lines) {
    const sub = Number(l.quantity) * Number(l.unit_price);
    base += sub;
    itbms += sub * Number(l.tax_rate);
  }
  return { base: round2(base), itbms: round2(itbms), total: round2(base + itbms) };
}

/** Un monto escrito por una persona: número, no negativo, hasta dos decimales. */
function monto(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

export function validarPedidoDeFacturaExterna(raw: unknown): ResultadoFacturaExterna {
  const r = (raw ?? {}) as Record<string, unknown>;
  const errors: ValidationErrors = {};

  const kind = r.invoice_kind;
  if (kind !== "HONORARIOS" && kind !== "REEMBOLSO") {
    errors.invoice_kind = "Elige honorarios (tipo 01) o reembolso (tipo 09).";
  }

  const comun = validateCreateInvoice({
    invoice_kind: (kind as CreateInvoiceInput["invoice_kind"]) ?? undefined,
    client_id: r.client_id as string,
    case_id: (r.case_id as string | null) ?? null,
    issue_date: r.issue_date as string,
    accounting_date: (r.accounting_date as string) || undefined,
    due_date: r.due_date as string,
    notes: (r.notes as string | null) ?? null,
    lines: (Array.isArray(r.lines) ? r.lines : []) as CreateInvoiceInput["lines"],
  });
  if (!comun.ok) Object.assign(errors, comun.errors);

  // Cada línea con servicio: la cuenta de ingreso sale de ahí (asiento-factura.ts).
  const lines = Array.isArray(r.lines) ? (r.lines as Array<Record<string, unknown>>) : [];
  lines.forEach((l, i) => {
    if (!l.service_id && !errors[`lines.${i}.service`]) {
      errors[`lines.${i}.service`] = "Elige el servicio del catálogo: dice a qué cuenta de ingreso va.";
    }
  });

  const punto = normalizarPunto(r.punto as string);
  if (!/^\d{3}$/.test(punto)) {
    errors.punto = "El punto de facturación son tres dígitos (por ejemplo 100 o 050).";
  }
  const numeroTxt = String(r.numero_documento ?? "").trim();
  const numero = /^\d{1,10}$/.test(numeroTxt) && Number(numeroTxt) > 0 ? Number(numeroTxt) : null;
  if (numero === null) {
    errors.numero_documento = "El número del documento es un número entero, sin letras.";
  }

  const base = monto(r.base_autorizada);
  if (base === null) errors.base_autorizada = "Escribe la base (sin ITBMS) del documento autorizado, con hasta dos decimales.";
  const itbms = monto(r.itbms_autorizado);
  if (itbms === null) errors.itbms_autorizado = "Escribe el ITBMS del documento autorizado (0 si no lleva).";

  // El CUFE: forma y lo que dice adentro.
  const lectura = leerCufe(r.cufe as string);
  let leido: CufeLeido | null = null;
  if (!lectura.ok) {
    errors.cufe = lectura.mensaje;
  } else {
    leido = lectura.leido;
    const desacuerdos = compararCufeConFactura(leido, {
      invoice_kind: String(kind ?? ""),
      issue_date: String(r.issue_date ?? ""),
      punto,
      numero_documento: numero,
    });
    for (const [campo, mensaje] of Object.entries(desacuerdos)) {
      if (!errors[campo]) errors[campo] = mensaje;
    }
  }

  // Los montos: las líneas tienen que dar EXACTAMENTE lo del documento.
  if (comun.ok && base !== null && itbms !== null) {
    const t = totalesDeLineas(comun.data.lines);
    if (t.base !== round2(base)) {
      errors.base_autorizada = `Las líneas dan una base de B/. ${t.base.toFixed(2)} y el documento dice B/. ${round2(base).toFixed(2)}.`;
    }
    if (t.itbms !== round2(itbms)) {
      errors.itbms_autorizado = `Las líneas dan un ITBMS de B/. ${t.itbms.toFixed(2)} y el documento dice B/. ${round2(itbms).toFixed(2)}.`;
    }
  }

  if (Object.keys(errors).length > 0 || !comun.ok || !leido || numero === null || base === null || itbms === null) {
    return { ok: false, data: null, leido, errors };
  }

  return {
    ok: true,
    leido,
    errors: null,
    data: {
      invoice_kind: kind as FacturaExternaInput["invoice_kind"],
      client_id: comun.data.client_id,
      case_id: comun.data.case_id,
      issue_date: comun.data.issue_date,
      accounting_date: comun.data.accounting_date ?? comun.data.issue_date,
      due_date: comun.data.due_date,
      notes: comun.data.notes,
      cufe: leido.cufe,
      punto,
      numero_documento: numero,
      base_autorizada: round2(base),
      itbms_autorizado: round2(itbms),
      lines: comun.data.lines,
    },
  };
}
