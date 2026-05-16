/**
 * Plantilla PDF para notas de crédito (Sprint 2C, D7 + D8).
 *
 * Mirror del estilo de QuoteDocument.tsx (paleta navy/gold) pero con:
 *   - Header rojo de "ANULACIÓN" en lugar del badge de status azul.
 *   - Banner que cita la factura origen (FAC-XXX-NNNNNN del DD/MM/YYYY).
 *   - Razón de la anulación destacada arriba.
 *   - Totales en NEGATIVO (con paréntesis estilo contable).
 *
 * Server-only: usa @react-pdf/renderer (ESM). NO importar desde Client
 * Components.
 */

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CreditNoteDocumentLine {
  line_order: number;
  description: string;
  qty: number;
  unit_price: number;
  tax_code: string;
  tax_rate: number; // [0, 1] — 0.07 = 7%
  line_total: number;
}

export interface CreditNoteDocumentClient {
  name: string;
  client_number: string;
  ruc: string | null;
}

export interface CreditNoteDocumentInvoice {
  invoice_number: string;
  invoice_kind: "HONORARIOS" | "REEMBOLSO";
  issue_date: string;
}

export interface CreditNoteDocumentProps {
  credit_note_number: string;
  issue_date: string;
  reason: string;
  client: CreditNoteDocumentClient;
  invoice: CreditNoteDocumentInvoice;
  lines: CreditNoteDocumentLine[];
  subtotal_total: number;
  tax_total: number;
  grand_total: number;
  generated_at_label: string;
  generated_by_label: string;
}

// ---------------------------------------------------------------------------
// Constants (paleta + helpers)
// ---------------------------------------------------------------------------

const COLOR_NAVY = "#1B2A4A";
const COLOR_GOLD = "#C5A55A";
const COLOR_WHITE = "#FFFFFF";
const COLOR_RED_700 = "#B91C1C";
const COLOR_RED_50 = "#FEF2F2";
const COLOR_GRAY_500 = "#6B7280";
const COLOR_GRAY_400 = "#9CA3AF";
const COLOR_GRAY_300 = "#D1D5DB";
const COLOR_GRAY_200 = "#E5E7EB";
const COLOR_GRAY_50 = "#F9FAFB";

function formatNegativeUSD(n: number): string {
  // Estilo contable: paréntesis para negativos. Asume n >= 0 representando
  // un monto que debe verse como reversión.
  const v = Math.round(n * 100) / 100;
  if (v === 0) return "$0.00";
  return `($${v.toFixed(2)})`;
}

function formatDateEs(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 60,
    paddingHorizontal: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: COLOR_NAVY,
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: COLOR_GOLD,
    paddingBottom: 12,
    marginBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  brand: {
    flexDirection: "column",
  },
  brandPrimary: {
    fontFamily: "Helvetica-Bold",
    fontSize: 22,
    color: COLOR_NAVY,
    letterSpacing: 2,
  },
  brandSecondary: {
    fontSize: 9,
    color: COLOR_GOLD,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 4,
    marginTop: 2,
  },
  brandTagline: {
    fontSize: 8,
    color: COLOR_GRAY_500,
    marginTop: 4,
  },
  docHeader: {
    alignItems: "flex-end",
  },
  docHeaderTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    color: COLOR_RED_700,
    letterSpacing: 1,
  },
  docHeaderNumber: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: COLOR_GOLD,
    marginTop: 2,
  },
  docHeaderBadge: {
    marginTop: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    backgroundColor: COLOR_RED_700,
    borderRadius: 3,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: COLOR_WHITE,
    letterSpacing: 1,
  },
  // Banner factura origen + razón
  cancellationBox: {
    borderLeftWidth: 3,
    borderLeftColor: COLOR_RED_700,
    backgroundColor: COLOR_RED_50,
    padding: 10,
    marginBottom: 14,
  },
  cancellationLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: COLOR_RED_700,
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  cancellationText: {
    fontSize: 9,
    color: COLOR_NAVY,
    lineHeight: 1.4,
  },
  cancellationReasonLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: COLOR_RED_700,
    letterSpacing: 1.2,
    marginTop: 6,
    marginBottom: 3,
  },
  // Two-col info
  infoRow: {
    flexDirection: "row",
    marginBottom: 14,
    gap: 18,
  },
  infoCol: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLOR_GRAY_200,
    borderRadius: 4,
    padding: 10,
  },
  infoColHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: COLOR_GOLD,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  infoLine: {
    flexDirection: "row",
    marginBottom: 2,
  },
  infoLineLabel: {
    width: 70,
    color: COLOR_GRAY_500,
    fontSize: 8,
  },
  infoLineValue: {
    flex: 1,
    color: COLOR_NAVY,
    fontSize: 9,
  },
  infoLineValueBold: {
    fontFamily: "Helvetica-Bold",
  },
  // Líneas
  table: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLOR_GRAY_200,
    borderRadius: 3,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: COLOR_NAVY,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  tableHeaderCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: COLOR_WHITE,
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR_GRAY_200,
  },
  tableRowAlt: {
    backgroundColor: COLOR_GRAY_50,
  },
  tableCell: {
    fontSize: 8,
    color: COLOR_NAVY,
  },
  colNum: { width: "5%" },
  colDesc: { width: "55%", paddingRight: 4 },
  colQty: { width: "8%", textAlign: "right" as const },
  colPrice: { width: "12%", textAlign: "right" as const },
  colTax: { width: "10%", textAlign: "right" as const },
  colTotal: { width: "10%", textAlign: "right" as const },
  totalsWrap: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 18,
  },
  totalsCard: {
    width: "45%",
    borderWidth: 1,
    borderColor: COLOR_RED_700,
    borderRadius: 4,
    padding: 10,
    backgroundColor: COLOR_RED_50,
  },
  totalsLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
    fontSize: 9,
  },
  totalsLabel: {
    color: COLOR_GRAY_500,
  },
  totalsValue: {
    color: COLOR_RED_700,
    fontFamily: "Helvetica-Bold",
  },
  totalsGrandLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: COLOR_RED_700,
  },
  totalsGrandLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: COLOR_NAVY,
  },
  totalsGrandValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: COLOR_RED_700,
  },
  legalBox: {
    marginTop: 6,
    padding: 8,
    backgroundColor: COLOR_GRAY_50,
    borderWidth: 0.5,
    borderColor: COLOR_GRAY_200,
    borderRadius: 3,
  },
  legalText: {
    fontSize: 8,
    color: COLOR_GRAY_500,
    lineHeight: 1.4,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: COLOR_GRAY_300,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 7,
    color: COLOR_GRAY_400,
  },
});

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function InfoLine({
  label,
  value,
  bold,
}: {
  label: string;
  value: string | null | undefined;
  bold?: boolean;
}) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLineLabel}>{label}</Text>
      <Text
        style={[
          styles.infoLineValue,
          ...(bold ? [styles.infoLineValueBold] : []),
        ]}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CreditNoteDocument(props: CreditNoteDocumentProps) {
  const {
    credit_note_number,
    issue_date,
    reason,
    client,
    invoice,
    lines,
    subtotal_total,
    tax_total,
    grand_total,
    generated_at_label,
    generated_by_label,
  } = props;

  const invoiceKindLabel =
    invoice.invoice_kind === "HONORARIOS" ? "Honorarios" : "Reembolso";

  return (
    <Document
      title={`Nota de crédito ${credit_note_number}`}
      author="Integra Legal"
      subject={`Nota de crédito ${credit_note_number} (anula ${invoice.invoice_number})`}
      creator="CRM Integra Legal"
      producer="CRM Integra Legal"
    >
      <Page size="LETTER" style={styles.page}>
        {/* ===== Header ===== */}
        <View style={styles.header} fixed>
          <View style={styles.brand}>
            <Text style={styles.brandPrimary}>INTEGRA</Text>
            <Text style={styles.brandSecondary}>LEGAL · PANAMÁ</Text>
            <Text style={styles.brandTagline}>Servicios legales corporativos</Text>
          </View>
          <View style={styles.docHeader}>
            <Text style={styles.docHeaderTitle}>NOTA DE CRÉDITO</Text>
            <Text style={styles.docHeaderNumber}>{credit_note_number}</Text>
            <Text style={styles.docHeaderBadge}>ANULACIÓN</Text>
          </View>
        </View>

        {/* ===== Banner factura origen + razón ===== */}
        <View style={styles.cancellationBox}>
          <Text style={styles.cancellationLabel}>FACTURA ANULADA</Text>
          <Text style={styles.cancellationText}>
            Esta nota de crédito anula la factura{" "}
            <Text style={{ fontFamily: "Helvetica-Bold" }}>
              {invoice.invoice_number}
            </Text>{" "}
            ({invoiceKindLabel}) emitida el {formatDateEs(invoice.issue_date)}.
          </Text>
          <Text style={styles.cancellationReasonLabel}>
            RAZÓN DE LA ANULACIÓN
          </Text>
          <Text style={styles.cancellationText}>{reason}</Text>
        </View>

        {/* ===== Info cliente + NC ===== */}
        <View style={styles.infoRow}>
          <View style={styles.infoCol}>
            <Text style={styles.infoColHeading}>CLIENTE</Text>
            <InfoLine label="Nombre" value={client.name} bold />
            <InfoLine label="N°" value={client.client_number} />
            {client.ruc && <InfoLine label="RUC" value={client.ruc} />}
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoColHeading}>DATOS DEL DOCUMENTO</Text>
            <InfoLine label="Emisión NC" value={formatDateEs(issue_date)} bold />
            <InfoLine
              label="Factura ref."
              value={invoice.invoice_number}
              bold
            />
            <InfoLine label="Moneda" value="USD" />
          </View>
        </View>

        {/* ===== Tabla de líneas ===== */}
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.tableHeaderCell, styles.colNum]}>#</Text>
            <Text style={[styles.tableHeaderCell, styles.colDesc]}>
              DESCRIPCIÓN
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colQty]}>CANT.</Text>
            <Text style={[styles.tableHeaderCell, styles.colPrice]}>PRECIO</Text>
            <Text style={[styles.tableHeaderCell, styles.colTax]}>IMP.</Text>
            <Text style={[styles.tableHeaderCell, styles.colTotal]}>
              TOTAL
            </Text>
          </View>
          {lines.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={[styles.tableCell, { width: "100%" }]}>
                Sin líneas registradas.
              </Text>
            </View>
          ) : (
            lines.map((ln, idx) => (
              <View
                key={`${ln.line_order}-${idx}`}
                style={[
                  styles.tableRow,
                  ...(idx % 2 === 1 ? [styles.tableRowAlt] : []),
                ]}
                wrap={false}
              >
                <Text style={[styles.tableCell, styles.colNum]}>
                  {ln.line_order + 1}
                </Text>
                <Text style={[styles.tableCell, styles.colDesc]}>
                  {ln.description}
                </Text>
                <Text style={[styles.tableCell, styles.colQty]}>
                  {ln.qty.toFixed(2)}
                </Text>
                <Text style={[styles.tableCell, styles.colPrice]}>
                  ${ln.unit_price.toFixed(2)}
                </Text>
                <Text style={[styles.tableCell, styles.colTax]}>
                  {ln.tax_code} ({(ln.tax_rate * 100).toFixed(0)}%)
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.colTotal,
                    {
                      fontFamily: "Helvetica-Bold",
                      color: COLOR_RED_700,
                    },
                  ]}
                >
                  {formatNegativeUSD(ln.line_total)}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* ===== Totales (en negativo, paréntesis contable) ===== */}
        <View style={styles.totalsWrap}>
          <View style={styles.totalsCard}>
            <View style={styles.totalsLine}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>
                {formatNegativeUSD(subtotal_total)}
              </Text>
            </View>
            <View style={styles.totalsLine}>
              <Text style={styles.totalsLabel}>Impuestos (ITBMS)</Text>
              <Text style={styles.totalsValue}>
                {formatNegativeUSD(tax_total)}
              </Text>
            </View>
            <View style={styles.totalsGrandLine}>
              <Text style={styles.totalsGrandLabel}>TOTAL</Text>
              <Text style={styles.totalsGrandValue}>
                {formatNegativeUSD(grand_total)}
              </Text>
            </View>
          </View>
        </View>

        {/* ===== Nota legal ===== */}
        <View style={styles.legalBox}>
          <Text style={styles.legalText}>
            Esta nota de crédito documenta la anulación contable de la factura
            referenciada. El monto reversado se aplica al período fiscal en
            curso. Conserva este documento junto con la factura original como
            soporte de la operación.
          </Text>
        </View>

        {/* ===== Footer ===== */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Integra Legal · Panamá · Nota de crédito generada el{" "}
            {generated_at_label}
            {generated_by_label ? ` por ${generated_by_label}` : ""}
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Página ${pageNumber} de ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
