/**
 * Contrato de entrada del mapper eFactura (Fase 2).
 *
 * NO toca invoice-pdf-data.ts. Es un tipo standalone — el fetch real
 * (consulta Supabase con joins) queda para Fase 3, cuando integremos
 * el transport. Acá sólo describimos qué necesita el mapper.
 *
 * Los campos de monto NUMERIC viajan como `number` ya normalizado:
 * el mapper no se ocupa de coerciones de strings (es responsabilidad
 * del fetcher / capa de datos).
 */

import type {
  InvoiceKind,
  InvoiceStatus,
} from "@/lib/finanzas/types/invoice";

export interface EfacturaBundleClient {
  // Identidad
  name: string;
  client_number: string;
  client_status: "prospect" | "active" | "inactive";
  client_type: "persona_natural" | "persona_juridica" | null;

  // Identificación fiscal (clientes Sprint 2E.1 / pre-eFactura)
  tax_id: string | null;
  tax_id_type: "ruc" | "cedula" | "pasaporte" | "extranjero" | null;
  ruc: string | null;     // legacy — fallback de tax_id si está vacío

  // Contacto
  email: string | null;
  phone: string | null;
  address: string | null;

  // Fase 1A — campos del receptor según taxonomía PAC eFactura
  digito_verificador: string | null;
  tipo_receptor_fe: "01" | "02" | "03" | "04" | null;
  codigo_ubicacion: string | null;
  corregimiento: string | null;
  distrito: string | null;
  provincia: string | null;
  id_extranjero: string | null;
  pais_receptor: string | null;
}

export interface EfacturaBundleLine {
  line_order: number;                 // 0-indexed en BD; el mapper hace +1 para numeroSecuenciaItem
  description: string;
  quantity: number;
  unit_price: number;
  tax_code: string;                   // ej 'ITBMS_7' (informativo, no se envía al PAC)
  tax_rate: number;                   // decimal [0..1] — 0.07 = 7%
  subtotal: number;                   // qty * unit_price
  tax_amount: number;                 // qty * unit_price * tax_rate
  line_total: number;                 // qty * unit_price * (1 + tax_rate)
}

export interface EfacturaBundleInvoice {
  id: string;
  invoice_number: string;             // ej 'FAC-HON-000454' (interno CRM, NO es el correlativo PAC)
  invoice_kind: InvoiceKind;          // HONORARIOS | REEMBOLSO
  status: InvoiceStatus;
  issue_date: string;                 // YYYY-MM-DD
  due_date: string;                   // YYYY-MM-DD
  notes: string | null;
  subtotal_total: number;
  tax_total: number;
  grand_total: number;
}

export interface InvoiceEfacturaBundle {
  invoice: EfacturaBundleInvoice;
  client: EfacturaBundleClient;
  lines: EfacturaBundleLine[];
}
