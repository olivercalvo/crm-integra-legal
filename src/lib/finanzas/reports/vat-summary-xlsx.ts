/**
 * Generación del Excel del VAT Summary con SheetJS (xlsx).
 *
 * Estructura del workbook:
 *   - Hoja "Resumen": header con el período + 10 líneas canónicas.
 *   - Hoja "Facturas": detalle de facturas del mes (incluye ajustes negativos
 *     por anulación con signo).
 *   - Hoja "Gastos": detalle de business_expenses del mes.
 *   - Hoja "Pagos DGI": detalle de tax_payments del mes.
 *
 * Si una sección no tiene datos, su hoja se omite (workbook más limpio).
 */

import * as XLSX from "xlsx";
import type { VatSummaryResult } from "@/lib/finanzas/reports/vat-summary";

/** Genera el workbook completo y devuelve el Buffer listo para responder. */
export function generateVatSummaryXlsxBuffer(result: VatSummaryResult): Buffer {
  const wb = XLSX.utils.book_new();

  // ── Hoja 1: Resumen ────────────────────────────────────────────────────
  const summaryRows: (string | number)[][] = [
    ["VAT SUMMARY (ITBMS)"],
    ["Integra Legal Panamá"],
    [],
    ["Período", result.period.label],
    ["Desde", result.period.from],
    ["Hasta", result.period.to],
    ["Generado", result.generated_at],
    ["Criterio", "Devengado por fecha de emisión"],
    [],
    ["#", "Concepto", "Monto (B/.)"],
  ];

  for (const line of result.lines) {
    summaryRows.push([line.number, line.label, Number(line.value.toFixed(2))]);
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  // Columnas con anchos razonables
  wsSummary["!cols"] = [
    { wch: 4 },   // #
    { wch: 55 },  // Concepto
    { wch: 18 },  // Monto
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Resumen");

  // ── Hoja 2: Facturas (si hay) ──────────────────────────────────────────
  if (result.detail.invoices.length > 0) {
    const header = [
      "Fecha", "Número", "Tipo", "Cliente", "N° cliente",
      "Estado", "Es ajuste anulación", "Subtotal", "ITBMS", "Total",
    ];
    const rows: (string | number | boolean)[][] = [header];
    for (const inv of result.detail.invoices) {
      rows.push([
        inv.is_cancellation_adjustment
          ? (inv.cancelled_at ?? inv.issue_date).slice(0, 10)
          : inv.issue_date,
        inv.invoice_number,
        inv.invoice_kind,
        inv.client_name ?? "",
        inv.client_number ?? "",
        inv.status,
        inv.is_cancellation_adjustment,
        Number(inv.subtotal_total.toFixed(2)),
        Number(inv.tax_total.toFixed(2)),
        Number(inv.grand_total.toFixed(2)),
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 11 }, { wch: 18 }, { wch: 10 }, { wch: 30 }, { wch: 14 },
      { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Facturas");
  }

  // ── Hoja 3: Gastos del bufete (si hay) ────────────────────────────────
  if (result.detail.business_expenses.length > 0) {
    const header = [
      "Fecha", "Proveedor", "Descripción", "Cuenta (código)", "Cuenta (nombre)",
      "Subtotal", "Tasa ITBMS", "ITBMS", "Total", "Estado",
    ];
    const rows: (string | number)[][] = [header];
    for (const ex of result.detail.business_expenses) {
      rows.push([
        ex.expense_date,
        ex.supplier_name ?? "",
        ex.description,
        ex.account_code ?? "",
        ex.account_name ?? "",
        Number(ex.subtotal.toFixed(2)),
        Number(ex.tax_rate.toFixed(4)),
        Number(ex.tax_amount.toFixed(2)),
        Number(ex.total.toFixed(2)),
        ex.status,
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 11 }, { wch: 22 }, { wch: 40 }, { wch: 10 }, { wch: 28 },
      { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Gastos");
  }

  // ── Hoja 4: Pagos a DGI (si hay) ──────────────────────────────────────
  if (result.detail.tax_payments.length > 0) {
    const header = [
      "Fecha pago", "Período desde", "Período hasta", "Referencia",
      "Monto", "Notas",
    ];
    const rows: (string | number)[][] = [header];
    for (const p of result.detail.tax_payments) {
      rows.push([
        p.payment_date,
        p.period_covered_from,
        p.period_covered_to,
        p.reference_number ?? "",
        Number(p.amount.toFixed(2)),
        p.notes ?? "",
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 14 }, { wch: 30 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Pagos DGI");
  }

  // ── Buffer ─────────────────────────────────────────────────────────────
  // bookType:'xlsx' + type:'buffer' → Node Buffer directo, no base64 ni stream.
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
  return buffer;
}
