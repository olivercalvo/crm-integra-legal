/**
 * Plantilla PDF del VAT Summary (Sprint 2F Parte 3b).
 *
 * - Server-only: usa @react-pdf/renderer. NO importar desde Client Components.
 * - Paleta Integra Panamá: navy #1B2A4A, gold #C5A55A, blanco.
 * - Font Helvetica embebida por defecto, sin red.
 * - Layout A4 vertical. Las páginas se rompen automáticamente si las tablas
 *   de detalle se extienden.
 */

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type {
  VatSummaryResult,
} from "@/lib/finanzas/reports/vat-summary";

// ---------------------------------------------------------------------------
// Constants (paleta + helpers)
// ---------------------------------------------------------------------------

const COLOR_NAVY = "#1B2A4A";
const COLOR_GOLD = "#C5A55A";
const COLOR_WHITE = "#FFFFFF";
const COLOR_GRAY_500 = "#6B7280";
const COLOR_GRAY_400 = "#9CA3AF";
const COLOR_GRAY_200 = "#E5E7EB";
const COLOR_GRAY_100 = "#F3F4F6";
const COLOR_GRAY_50 = "#F9FAFB";
const COLOR_RED_700 = "#B91C1C";
const COLOR_RED_50 = "#FEF2F2";
const COLOR_NAVY_5 = "#F3F4F8"; // navy at 5% alpha aproximado

function fmtMoney(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

function fmtDateEs(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function fmtDateTimeEs(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getUTCDate() - 0).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours() - 5 < 0 ? d.getUTCHours() - 5 + 24 : d.getUTCHours() - 5).padStart(2, "0"); // Panama UTC-5
  const mn = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mn}`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  page: {
    backgroundColor: COLOR_WHITE,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#111827",
    paddingTop: 30,
    paddingBottom: 40,
    paddingHorizontal: 30,
  },

  // Header navy/gold bar
  header: {
    backgroundColor: COLOR_NAVY,
    color: COLOR_WHITE,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 0,
  },
  headerBrand: { flexDirection: "column" },
  brandTitle: { fontSize: 14, fontFamily: "Helvetica-Bold", color: COLOR_WHITE, letterSpacing: 1 },
  brandSubtitle: { fontSize: 8, color: COLOR_GOLD, marginTop: 2, letterSpacing: 1 },
  headerRight: { flexDirection: "column", alignItems: "flex-end" },
  headerLabel: { fontSize: 8, color: COLOR_GRAY_400 },
  headerValue: { fontSize: 11, color: COLOR_WHITE, fontFamily: "Helvetica-Bold", marginTop: 2 },

  // Gold band debajo del header
  goldBand: {
    backgroundColor: COLOR_GOLD,
    height: 3,
    marginBottom: 18,
  },

  // Title sección
  title: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: COLOR_NAVY,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 9,
    color: COLOR_GRAY_500,
    marginBottom: 14,
  },

  // Section header
  sectionHeader: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: COLOR_NAVY,
    marginTop: 16,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_GOLD,
  },

  // Tabla principal de 10 líneas
  mainTable: {
    borderWidth: 1,
    borderColor: COLOR_GRAY_200,
    borderRadius: 3,
    marginBottom: 12,
  },
  mainTableHeaderRow: {
    flexDirection: "row",
    backgroundColor: COLOR_GRAY_50,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_GRAY_200,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  mainTableHeaderCell: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: COLOR_GRAY_500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  mainTableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_GRAY_100,
  },
  mainTableRowTotal: {
    backgroundColor: COLOR_NAVY_5,
  },
  mainTableCellNum: { width: 24, fontSize: 8, color: COLOR_GRAY_400, textAlign: "center" },
  mainTableCellLabel: { flex: 1, fontSize: 9, color: "#111827" },
  mainTableCellLabelTotal: { flex: 1, fontSize: 10, color: COLOR_NAVY, fontFamily: "Helvetica-Bold" },
  mainTableCellHint: { fontSize: 7, color: COLOR_GRAY_400, marginTop: 1 },
  mainTableCellValue: {
    width: 100,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    textAlign: "right",
  },
  mainTableCellValueTotal: {
    width: 100,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: COLOR_NAVY,
    textAlign: "right",
  },
  valueNegative: { color: COLOR_RED_700 },

  // Tablas de detalle
  detailTable: {
    borderWidth: 1,
    borderColor: COLOR_GRAY_200,
    borderRadius: 2,
    marginBottom: 10,
  },
  detailRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLOR_GRAY_100,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  detailRowHead: {
    backgroundColor: COLOR_GRAY_50,
    paddingVertical: 5,
  },
  detailRowAdjustment: {
    backgroundColor: COLOR_RED_50,
  },
  detailCell: { fontSize: 7.5, color: "#111827" },
  detailCellHead: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: COLOR_GRAY_500,
    textTransform: "uppercase",
  },
  detailCellMono: { fontSize: 7, fontFamily: "Courier", color: "#111827" },
  detailCellNeg: { color: COLOR_RED_700 },

  // Footer
  footer: {
    position: "absolute",
    bottom: 18,
    left: 30,
    right: 30,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLOR_GRAY_200,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 7, color: COLOR_GRAY_400 },

  // Empty state
  emptyState: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    textAlign: "center",
    fontSize: 8,
    color: COLOR_GRAY_500,
    backgroundColor: COLOR_GRAY_50,
    borderRadius: 2,
    marginBottom: 10,
  },
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface VatSummaryDocumentProps {
  result: VatSummaryResult;
}

export function VatSummaryDocument({ result }: VatSummaryDocumentProps) {
  const { period, lines, detail, generated_at } = result;
  const hasInvoices = detail.invoices.length > 0;
  const hasExpenses = detail.business_expenses.length > 0;
  const hasPayments = detail.tax_payments.length > 0;

  return (
    <Document
      title={`VAT Summary ${period.month}`}
      author="Integra Legal Panamá"
    >
      <Page size="A4" style={s.page}>
        {/* Banda navy con branding */}
        <View style={s.header} fixed>
          <View style={s.headerBrand}>
            <Text style={s.brandTitle}>INTEGRA · LEGAL · PANAMÁ</Text>
            <Text style={s.brandSubtitle}>VAT SUMMARY (ITBMS)</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.headerLabel}>Período</Text>
            <Text style={s.headerValue}>{period.label}</Text>
          </View>
        </View>
        <View style={s.goldBand} />

        {/* Title */}
        <Text style={s.title}>Resumen mensual de ITBMS</Text>
        <Text style={s.subtitle}>
          Devengado por fecha de emisión · {fmtDateEs(period.from)} al {fmtDateEs(period.to)}
        </Text>

        {/* Tabla principal: 10 líneas */}
        <View style={s.mainTable}>
          <View style={s.mainTableHeaderRow}>
            <Text style={[s.mainTableHeaderCell, { width: 24, textAlign: "center" }]}>#</Text>
            <Text style={[s.mainTableHeaderCell, { flex: 1 }]}>Concepto</Text>
            <Text style={[s.mainTableHeaderCell, { width: 100, textAlign: "right" }]}>Monto (B/.)</Text>
          </View>
          {lines.map((line) => {
            const isTotal = !!line.is_total;
            const isNegative = line.value < 0;
            return (
              <View
                key={line.number}
                style={[s.mainTableRow, isTotal ? s.mainTableRowTotal : {}]}
                wrap={false}
              >
                <Text style={s.mainTableCellNum}>{line.number}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={isTotal ? s.mainTableCellLabelTotal : s.mainTableCellLabel}>
                    {line.label}
                  </Text>
                  {line.hint && (
                    <Text style={s.mainTableCellHint}>{line.hint}</Text>
                  )}
                </View>
                <Text
                  style={[
                    isTotal ? s.mainTableCellValueTotal : s.mainTableCellValue,
                    isNegative ? s.valueNegative : {},
                  ]}
                >
                  {fmtMoney(line.value)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Detalle facturas */}
        <Text style={s.sectionHeader}>Detalle de facturas</Text>
        {hasInvoices ? (
          <View style={s.detailTable}>
            <View style={[s.detailRow, s.detailRowHead]} fixed>
              <Text style={[s.detailCellHead, { width: 50 }]}>Fecha</Text>
              <Text style={[s.detailCellHead, { width: 70 }]}>Número</Text>
              <Text style={[s.detailCellHead, { flex: 1 }]}>Cliente</Text>
              <Text style={[s.detailCellHead, { width: 60 }]}>Estado</Text>
              <Text style={[s.detailCellHead, { width: 60, textAlign: "right" }]}>Subtotal</Text>
              <Text style={[s.detailCellHead, { width: 50, textAlign: "right" }]}>ITBMS</Text>
              <Text style={[s.detailCellHead, { width: 60, textAlign: "right" }]}>Total</Text>
            </View>
            {detail.invoices.map((inv, idx) => (
              <View
                key={`${inv.id}-${inv.is_cancellation_adjustment ? "neg" : "pos"}-${idx}`}
                style={[s.detailRow, inv.is_cancellation_adjustment ? s.detailRowAdjustment : {}]}
                wrap={false}
              >
                <Text style={[s.detailCell, { width: 50 }]}>
                  {fmtDateEs(inv.is_cancellation_adjustment
                    ? (inv.cancelled_at ?? inv.issue_date)
                    : inv.issue_date)}
                </Text>
                <Text style={[s.detailCellMono, { width: 70 }]}>
                  {inv.invoice_number}
                  {inv.is_cancellation_adjustment ? " ⊖" : ""}
                </Text>
                <Text style={[s.detailCell, { flex: 1 }]}>
                  {inv.client_name ?? "—"}
                </Text>
                <Text style={[s.detailCell, { width: 60, color: COLOR_GRAY_500 }]}>
                  {inv.status}
                </Text>
                <Text
                  style={[
                    s.detailCell,
                    { width: 60, textAlign: "right", fontFamily: "Courier" },
                    inv.subtotal_total < 0 ? s.detailCellNeg : {},
                  ]}
                >
                  {fmtMoney(inv.subtotal_total)}
                </Text>
                <Text
                  style={[
                    s.detailCell,
                    { width: 50, textAlign: "right", fontFamily: "Courier" },
                    inv.tax_total < 0 ? s.detailCellNeg : {},
                  ]}
                >
                  {fmtMoney(inv.tax_total)}
                </Text>
                <Text
                  style={[
                    s.detailCell,
                    { width: 60, textAlign: "right", fontFamily: "Courier", fontWeight: 700 },
                    inv.grand_total < 0 ? s.detailCellNeg : {},
                  ]}
                >
                  {fmtMoney(inv.grand_total)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={s.emptyState}>Sin facturas en el período.</Text>
        )}

        {/* Detalle gastos */}
        <Text style={s.sectionHeader}>Detalle de gastos del bufete</Text>
        {hasExpenses ? (
          <View style={s.detailTable}>
            <View style={[s.detailRow, s.detailRowHead]} fixed>
              <Text style={[s.detailCellHead, { width: 50 }]}>Fecha</Text>
              <Text style={[s.detailCellHead, { width: 80 }]}>Proveedor</Text>
              <Text style={[s.detailCellHead, { flex: 1 }]}>Descripción</Text>
              <Text style={[s.detailCellHead, { width: 70 }]}>Cuenta</Text>
              <Text style={[s.detailCellHead, { width: 50, textAlign: "right" }]}>Subtotal</Text>
              <Text style={[s.detailCellHead, { width: 40, textAlign: "right" }]}>ITBMS</Text>
              <Text style={[s.detailCellHead, { width: 50, textAlign: "right" }]}>Total</Text>
            </View>
            {detail.business_expenses.map((ex) => (
              <View key={ex.id} style={s.detailRow} wrap={false}>
                <Text style={[s.detailCell, { width: 50 }]}>{fmtDateEs(ex.expense_date)}</Text>
                <Text style={[s.detailCell, { width: 80 }]}>{ex.supplier_name ?? "—"}</Text>
                <Text style={[s.detailCell, { flex: 1 }]}>{ex.description}</Text>
                <Text style={[s.detailCellMono, { width: 70 }]}>
                  {ex.account_code ?? "—"}
                </Text>
                <Text style={[s.detailCell, { width: 50, textAlign: "right", fontFamily: "Courier" }]}>
                  {fmtMoney(ex.subtotal)}
                </Text>
                <Text style={[s.detailCell, { width: 40, textAlign: "right", fontFamily: "Courier" }]}>
                  {ex.tax_amount > 0 ? fmtMoney(ex.tax_amount) : "—"}
                </Text>
                <Text style={[s.detailCell, { width: 50, textAlign: "right", fontFamily: "Courier", fontWeight: 700 }]}>
                  {fmtMoney(ex.total)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={s.emptyState}>Sin gastos del bufete en el período.</Text>
        )}

        {/* Detalle pagos al DGI */}
        <Text style={s.sectionHeader}>Pagos a DGI del período</Text>
        {hasPayments ? (
          <View style={s.detailTable}>
            <View style={[s.detailRow, s.detailRowHead]} fixed>
              <Text style={[s.detailCellHead, { width: 60 }]}>Fecha pago</Text>
              <Text style={[s.detailCellHead, { width: 110 }]}>Período cubierto</Text>
              <Text style={[s.detailCellHead, { flex: 1 }]}>Referencia</Text>
              <Text style={[s.detailCellHead, { width: 70, textAlign: "right" }]}>Monto</Text>
            </View>
            {detail.tax_payments.map((p) => (
              <View key={p.id} style={s.detailRow} wrap={false}>
                <Text style={[s.detailCell, { width: 60 }]}>{fmtDateEs(p.payment_date)}</Text>
                <Text style={[s.detailCell, { width: 110, color: COLOR_GRAY_500 }]}>
                  {fmtDateEs(p.period_covered_from)} → {fmtDateEs(p.period_covered_to)}
                </Text>
                <Text style={[s.detailCellMono, { flex: 1, color: COLOR_GRAY_500 }]}>
                  {p.reference_number ?? "—"}
                </Text>
                <Text style={[s.detailCell, { width: 70, textAlign: "right", fontFamily: "Courier", fontWeight: 700 }]}>
                  {fmtMoney(p.amount)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={s.emptyState}>Sin pagos a DGI en el período.</Text>
        )}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Generado el {fmtDateTimeEs(generated_at)} (hora Panamá)
          </Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
