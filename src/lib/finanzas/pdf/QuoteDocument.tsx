/**
 * Plantilla PDF para cotizaciones (Sprint 2E.3, D1 + D6).
 *
 * - Server-only: usa @react-pdf/renderer (ESM). NO importar desde Client
 *   Components.
 * - Paleta Integra Panamá: navy #1B2A4A, gold #C5A55A, blanco #FFFFFF.
 * - Font Helvetica (incluido por defecto en react-pdf, sin red).
 * - El componente recibe `QuoteDocumentProps` con todos los datos ya
 *   normalizados (montos como Number, no strings). La normalización vive
 *   en el caller (endpoint /pdf).
 * - El layout tolera líneas largas y T&C largas: páginas se rompen
 *   automáticamente por defecto.
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

export interface QuoteDocumentLine {
  line_order: number;
  description: string;
  invoice_kind: "HON" | "REI";
  qty: number;
  unit_price: number;
  tax_code: string;
  tax_rate: number;     // [0, 1] — 0.07 = 7%
  line_total: number;
}

export interface QuoteDocumentClient {
  name: string;
  client_number: string;
  tax_id: string | null;
  tax_id_type: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface QuoteDocumentCase {
  code: string;
  description: string | null;
}

export interface QuoteDocumentProps {
  quote_number: string;
  status: string;
  status_label: string;
  issue_date: string;       // YYYY-MM-DD
  valid_until: string;      // YYYY-MM-DD
  client: QuoteDocumentClient;
  case: QuoteDocumentCase | null;
  lines: QuoteDocumentLine[];
  subtotal_hon: number;
  subtotal_rei: number;
  tax_total: number;
  grand_total: number;
  notes: string | null;
  terms_and_conditions: string | null;
  generated_at_label: string;
  generated_by_label: string;
}

// ---------------------------------------------------------------------------
// Constants (paleta + helpers)
// ---------------------------------------------------------------------------

const COLOR_NAVY = "#1B2A4A";
const COLOR_GOLD = "#C5A55A";
const COLOR_WHITE = "#FFFFFF";
const COLOR_GRAY_500 = "#6B7280";
const COLOR_GRAY_400 = "#9CA3AF";
const COLOR_GRAY_300 = "#D1D5DB";
const COLOR_GRAY_200 = "#E5E7EB";
const COLOR_GRAY_50 = "#F9FAFB";
const COLOR_BLUE_50 = "#EFF6FF";
const COLOR_BLUE_700 = "#1D4ED8";
const COLOR_ORANGE_50 = "#FFF7ED";
const COLOR_ORANGE_700 = "#C2410C";

function formatUSD(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

function formatDateEs(iso: string): string {
  // Acepta 'YYYY-MM-DD' o ISO completo. Devuelve 'DD/MM/YYYY' (formato PA).
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function taxIdTypeLabel(t: string | null): string {
  switch (t) {
    case "ruc":
      return "RUC";
    case "cedula":
      return "Cédula";
    case "pasaporte":
      return "Pasaporte";
    case "extranjero":
      return "ID fiscal";
    default:
      return "ID";
  }
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
  // ---- Header ----
  header: {
    borderBottomWidth: 2,
    borderBottomColor: COLOR_GOLD,
    paddingBottom: 12,
    marginBottom: 18,
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
    color: COLOR_NAVY,
    letterSpacing: 1,
  },
  docHeaderNumber: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: COLOR_GOLD,
    marginTop: 2,
  },
  statusBadge: {
    marginTop: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: COLOR_NAVY,
    borderRadius: 3,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: COLOR_NAVY,
    letterSpacing: 1,
  },
  // ---- Two-col info ----
  infoRow: {
    flexDirection: "row",
    marginBottom: 16,
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
    width: 65,
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
  // ---- Lines table ----
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
  // Column widths (sum = 100%):
  colNum: { width: "5%" },
  colKind: { width: "8%" },
  colDesc: { width: "42%", paddingRight: 4 },
  colQty: { width: "8%", textAlign: "right" as const },
  colPrice: { width: "12%", textAlign: "right" as const },
  colTax: { width: "12%", textAlign: "right" as const },
  colTotal: { width: "13%", textAlign: "right" as const },
  kindBadge: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    paddingVertical: 1.5,
    paddingHorizontal: 4,
    borderRadius: 2,
    textAlign: "center" as const,
    letterSpacing: 0.5,
  },
  kindBadgeHon: {
    backgroundColor: COLOR_BLUE_50,
    color: COLOR_BLUE_700,
  },
  kindBadgeRei: {
    backgroundColor: COLOR_ORANGE_50,
    color: COLOR_ORANGE_700,
  },
  // ---- Totals ----
  totalsWrap: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 18,
  },
  totalsCard: {
    width: "45%",
    borderWidth: 1,
    borderColor: COLOR_GOLD,
    borderRadius: 4,
    padding: 10,
    backgroundColor: COLOR_GRAY_50,
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
    color: COLOR_NAVY,
    fontFamily: "Helvetica-Bold",
  },
  totalsGrandLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: COLOR_GOLD,
  },
  totalsGrandLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: COLOR_NAVY,
  },
  totalsGrandValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: COLOR_NAVY,
  },
  // ---- Notes / T&C ----
  sectionHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: COLOR_GOLD,
    letterSpacing: 1.5,
    marginBottom: 6,
    marginTop: 4,
  },
  notesBox: {
    borderWidth: 0.5,
    borderColor: COLOR_GRAY_200,
    borderRadius: 3,
    padding: 8,
    backgroundColor: COLOR_GRAY_50,
    marginBottom: 14,
  },
  notesText: {
    fontSize: 8.5,
    color: COLOR_NAVY,
    lineHeight: 1.4,
  },
  termsBox: {
    fontSize: 8,
    color: COLOR_NAVY,
    lineHeight: 1.5,
  },
  // ---- Footer ----
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

function KindBadge({ kind }: { kind: "HON" | "REI" }) {
  const palette =
    kind === "HON" ? styles.kindBadgeHon : styles.kindBadgeRei;
  return <Text style={[styles.kindBadge, palette]}>{kind}</Text>;
}

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

export function QuoteDocument(props: QuoteDocumentProps) {
  const {
    quote_number,
    status_label,
    issue_date,
    valid_until,
    client,
    case: kase,
    lines,
    subtotal_hon,
    subtotal_rei,
    tax_total,
    grand_total,
    notes,
    terms_and_conditions,
    generated_at_label,
    generated_by_label,
  } = props;

  const hasHon = subtotal_hon > 0 || lines.some((l) => l.invoice_kind === "HON");
  const hasRei = subtotal_rei > 0 || lines.some((l) => l.invoice_kind === "REI");

  return (
    <Document
      title={`Cotización ${quote_number}`}
      author="Integra Legal"
      subject={`Cotización ${quote_number}`}
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
            <Text style={styles.docHeaderTitle}>COTIZACIÓN</Text>
            <Text style={styles.docHeaderNumber}>{quote_number}</Text>
            <Text style={styles.statusBadge}>{status_label.toUpperCase()}</Text>
          </View>
        </View>

        {/* ===== Info cliente + cotización ===== */}
        <View style={styles.infoRow}>
          <View style={styles.infoCol}>
            <Text style={styles.infoColHeading}>CLIENTE</Text>
            <InfoLine label="Nombre" value={client.name} bold />
            <InfoLine label="N°" value={client.client_number} />
            {client.tax_id && (
              <InfoLine
                label={taxIdTypeLabel(client.tax_id_type)}
                value={client.tax_id}
              />
            )}
            {client.email && <InfoLine label="Email" value={client.email} />}
            {client.phone && <InfoLine label="Teléfono" value={client.phone} />}
            {client.address && (
              <InfoLine label="Dirección" value={client.address} />
            )}
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoColHeading}>DATOS DEL DOCUMENTO</Text>
            <InfoLine label="Emisión" value={formatDateEs(issue_date)} bold />
            <InfoLine label="Vence" value={formatDateEs(valid_until)} bold />
            <InfoLine label="Moneda" value="USD" />
            {kase && (
              <>
                <InfoLine label="Caso" value={kase.code} />
                {kase.description && (
                  <InfoLine label="" value={kase.description} />
                )}
              </>
            )}
          </View>
        </View>

        {/* ===== Tabla de líneas ===== */}
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.tableHeaderCell, styles.colNum]}>#</Text>
            <Text style={[styles.tableHeaderCell, styles.colKind]}>TIPO</Text>
            <Text style={[styles.tableHeaderCell, styles.colDesc]}>
              DESCRIPCIÓN
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colQty]}>CANT.</Text>
            <Text style={[styles.tableHeaderCell, styles.colPrice]}>PRECIO</Text>
            <Text style={[styles.tableHeaderCell, styles.colTax]}>IMP.</Text>
            <Text style={[styles.tableHeaderCell, styles.colTotal]}>TOTAL</Text>
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
                  {ln.line_order}
                </Text>
                <View style={styles.colKind}>
                  <KindBadge kind={ln.invoice_kind} />
                </View>
                <Text style={[styles.tableCell, styles.colDesc]}>
                  {ln.description}
                </Text>
                <Text style={[styles.tableCell, styles.colQty]}>
                  {ln.qty.toFixed(2)}
                </Text>
                <Text style={[styles.tableCell, styles.colPrice]}>
                  {formatUSD(ln.unit_price)}
                </Text>
                <Text style={[styles.tableCell, styles.colTax]}>
                  {ln.tax_code} ({(ln.tax_rate * 100).toFixed(0)}%)
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.colTotal,
                    { fontFamily: "Helvetica-Bold" },
                  ]}
                >
                  {formatUSD(ln.line_total)}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* ===== Totales ===== */}
        <View style={styles.totalsWrap}>
          <View style={styles.totalsCard}>
            {hasHon && (
              <View style={styles.totalsLine}>
                <Text style={[styles.totalsLabel, { color: COLOR_BLUE_700 }]}>
                  Subtotal honorarios
                </Text>
                <Text style={styles.totalsValue}>{formatUSD(subtotal_hon)}</Text>
              </View>
            )}
            {hasRei && (
              <View style={styles.totalsLine}>
                <Text style={[styles.totalsLabel, { color: COLOR_ORANGE_700 }]}>
                  Subtotal reembolso
                </Text>
                <Text style={styles.totalsValue}>{formatUSD(subtotal_rei)}</Text>
              </View>
            )}
            <View style={styles.totalsLine}>
              <Text style={styles.totalsLabel}>Impuestos (ITBMS)</Text>
              <Text style={styles.totalsValue}>{formatUSD(tax_total)}</Text>
            </View>
            <View style={styles.totalsGrandLine}>
              <Text style={styles.totalsGrandLabel}>TOTAL</Text>
              <Text style={styles.totalsGrandValue}>
                {formatUSD(grand_total)}
              </Text>
            </View>
          </View>
        </View>

        {/* ===== Notas internas (opcional) ===== */}
        {notes && notes.trim().length > 0 && (
          <View wrap={false}>
            <Text style={styles.sectionHeading}>NOTAS</Text>
            <View style={styles.notesBox}>
              <Text style={styles.notesText}>{notes}</Text>
            </View>
          </View>
        )}

        {/* ===== Términos y Condiciones ===== */}
        {terms_and_conditions && terms_and_conditions.trim().length > 0 && (
          <View>
            <Text style={styles.sectionHeading}>TÉRMINOS Y CONDICIONES</Text>
            <View style={styles.termsBox}>
              <Text>{terms_and_conditions}</Text>
            </View>
          </View>
        )}

        {/* ===== Footer (todas las páginas) ===== */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Integra Legal · Panamá · Cotización generada el{" "}
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
