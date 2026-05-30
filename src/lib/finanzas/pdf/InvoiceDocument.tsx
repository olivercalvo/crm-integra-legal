/**
 * Plantilla PDF para facturas (Sprint 2F).
 *
 * Mirror del estilo de QuoteDocument.tsx (paleta navy/gold) adaptado al
 * dominio de facturas:
 *   - Header dice "FACTURA" + el invoice_number (o "BORRADOR" si todavía
 *     no se emitió y el invoice_number es slug interno DRAFT-XXX).
 *   - El subtipo (HONORARIOS / REEMBOLSO) aparece como sub-etiqueta
 *     debajo del número.
 *   - El estado se renderiza como label de texto claro (sin watermark
 *     diagonal) usando un mapping legible.
 *   - Tabla de líneas: una sola variante (todas las líneas son del mismo
 *     kind, a diferencia de cotizaciones que mezclan HON/REI).
 *   - Sección DGI opcional al pie cuando los campos están cargados.
 *   - Sección "Información de anulación" cuando status='anulada'.
 *   - Footer: nota "Documento interno. La factura fiscal oficial se emite
 *     en eFactura."
 *
 * Server-only: usa @react-pdf/renderer (ESM). NO importar desde Client
 * Components.
 */

import React from "react";
import path from "node:path";
import fs from "node:fs";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

const LOGO_PNG_BUFFER: Buffer = fs.readFileSync(
  path.join(process.cwd(), "public", "integra-logo.png")
);
const LOGO_SRC = { data: LOGO_PNG_BUFFER, format: "png" as const };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InvoiceDocumentLine {
  line_order: number;
  description: string;
  qty: number;
  unit_price: number;
  tax_code: string;
  tax_rate: number;     // [0, 1] — 0.07 = 7%
  line_total: number;
}

export interface InvoiceDocumentClient {
  name: string;
  client_number: string;
  tax_id: string | null;
  tax_id_type: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface InvoiceDocumentCase {
  code: string;
  description: string | null;
}

export interface InvoiceDocumentDgi {
  numero_documento: string | null;
  cufe: string | null;
  fecha_autorizacion: string | null;   // YYYY-MM-DD o ISO
  cafe_url: string | null;
}

export interface InvoiceDocumentCancellation {
  reason: string | null;
  cancelled_at: string | null;          // ISO
}

export interface InvoiceDocumentProps {
  invoice_number: string;
  /** Display number — en borrador puede ser distinto del invoice_number interno. */
  display_number: string;
  invoice_kind: "HONORARIOS" | "REEMBOLSO";
  kind_label: string;                   // "Honorarios" | "Reembolso"
  status: string;
  /** Etiqueta legible mostrada como badge en el header (mapeado a tuteo neutro). */
  status_label: string;
  issue_date: string;       // YYYY-MM-DD
  due_date: string;         // YYYY-MM-DD
  client: InvoiceDocumentClient;
  case: InvoiceDocumentCase | null;
  lines: InvoiceDocumentLine[];
  subtotal: number;
  tax_total: number;
  grand_total: number;
  notes: string | null;
  dgi: InvoiceDocumentDgi;
  cancellation: InvoiceDocumentCancellation;
  generated_at_label: string;
  generated_by_label: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLOR_NAVY = "#1B2A4A";
const COLOR_GOLD = "#C5A55A";
const COLOR_WHITE = "#FFFFFF";
const COLOR_GRAY_500 = "#6B7280";
const COLOR_GRAY_400 = "#9CA3AF";
const COLOR_GRAY_300 = "#D1D5DB";
const COLOR_GRAY_200 = "#E5E7EB";
const COLOR_GRAY_50 = "#F9FAFB";
const COLOR_RED_700 = "#B91C1C";
const COLOR_RED_50 = "#FEF2F2";
const COLOR_AMBER_700 = "#B45309";
const COLOR_AMBER_50 = "#FFFBEB";

function formatUSD(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

function formatDateEs(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatDateTimeEs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
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
    paddingTop: 28,
    paddingBottom: 40,
    paddingHorizontal: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: COLOR_NAVY,
  },
  // ---- Header ----
  header: {
    borderBottomWidth: 2,
    borderBottomColor: COLOR_GOLD,
    paddingBottom: 10,
    marginBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  brand: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  brandLogo: {
    width: 130,
    height: 57,
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
  docHeaderKind: {
    fontFamily: "Helvetica",
    fontSize: 8,
    color: COLOR_GRAY_500,
    marginTop: 2,
    letterSpacing: 0.5,
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
  statusBadgeDanger: {
    borderColor: COLOR_RED_700,
    color: COLOR_RED_700,
    backgroundColor: COLOR_RED_50,
  },
  statusBadgeWarning: {
    borderColor: COLOR_AMBER_700,
    color: COLOR_AMBER_700,
    backgroundColor: COLOR_AMBER_50,
  },
  // ---- Two-col info ----
  infoRow: {
    flexDirection: "row",
    marginBottom: 10,
    gap: 14,
  },
  infoCol: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLOR_GRAY_200,
    borderRadius: 4,
    padding: 8,
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
  colNum: { width: "5%" },
  colDesc: { width: "50%", paddingRight: 4 },
  colQty: { width: "8%", textAlign: "right" as const },
  colPrice: { width: "12%", textAlign: "right" as const },
  colTax: { width: "12%", textAlign: "right" as const },
  colTotal: { width: "13%", textAlign: "right" as const },
  // ---- Totals ----
  totalsWrap: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 12,
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
  // ---- Notes / DGI / Cancellation ----
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
  dgiBox: {
    borderWidth: 0.5,
    borderColor: COLOR_GOLD,
    borderRadius: 3,
    padding: 8,
    backgroundColor: COLOR_WHITE,
    marginBottom: 14,
  },
  cancellationBox: {
    borderWidth: 1,
    borderColor: COLOR_RED_700,
    borderRadius: 3,
    padding: 8,
    backgroundColor: COLOR_RED_50,
    marginBottom: 14,
  },
  cancellationText: {
    fontSize: 8.5,
    color: COLOR_NAVY,
    lineHeight: 1.4,
  },
  // ---- Footer ----
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: COLOR_GRAY_300,
    paddingTop: 5,
    flexDirection: "column",
  },
  footerNote: {
    fontSize: 7,
    color: COLOR_AMBER_700,
    fontFamily: "Helvetica-Oblique",
    marginBottom: 2,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 6.5,
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

function statusBadgeStyle(status: string) {
  if (status === "anulada" || status === "cancelada_pre_emision") {
    return styles.statusBadgeDanger;
  }
  if (status === "borrador") {
    return styles.statusBadgeWarning;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function InvoiceDocument(props: InvoiceDocumentProps) {
  const {
    invoice_number,
    display_number,
    kind_label,
    status,
    status_label,
    issue_date,
    due_date,
    client,
    case: kase,
    lines,
    subtotal,
    tax_total,
    grand_total,
    notes,
    dgi,
    cancellation,
    generated_at_label,
    generated_by_label,
  } = props;

  const extraBadgeStyle = statusBadgeStyle(status);

  const hasDgi =
    !!dgi.numero_documento ||
    !!dgi.cufe ||
    !!dgi.fecha_autorizacion ||
    !!dgi.cafe_url;

  const isCancelled = status === "anulada";

  return (
    <Document
      title={`Factura ${display_number}`}
      author="Integra Legal"
      subject={`Factura ${display_number}`}
      creator="CRM Integra Legal"
      producer="CRM Integra Legal"
    >
      <Page size="LETTER" style={styles.page}>
        {/* ===== Header ===== */}
        <View style={styles.header} fixed>
          <View style={styles.brand}>
            <Image src={LOGO_SRC} style={styles.brandLogo} />
          </View>
          <View style={styles.docHeader}>
            <Text style={styles.docHeaderTitle}>FACTURA</Text>
            <Text style={styles.docHeaderNumber}>{display_number}</Text>
            <Text style={styles.docHeaderKind}>{kind_label.toUpperCase()}</Text>
            <Text
              style={[
                styles.statusBadge,
                ...(extraBadgeStyle ? [extraBadgeStyle] : []),
              ]}
            >
              {status_label.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* ===== Info cliente + factura ===== */}
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
            <InfoLine label="N° interno" value={invoice_number} />
            <InfoLine label="Tipo" value={kind_label} bold />
            <InfoLine label="Emisión" value={formatDateEs(issue_date)} bold />
            <InfoLine label="Vence" value={formatDateEs(due_date)} bold />
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
                  {ln.line_order + 1}
                </Text>
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
            <View style={styles.totalsLine}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{formatUSD(subtotal)}</Text>
            </View>
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

        {/* ===== Notas (cliente-visible) ===== */}
        {notes && notes.trim().length > 0 && (
          <View wrap={false}>
            <Text style={styles.sectionHeading}>NOTAS</Text>
            <View style={styles.notesBox}>
              <Text style={styles.notesText}>{notes}</Text>
            </View>
          </View>
        )}

        {/* ===== Datos DGI (eFactura) — si están cargados ===== */}
        {hasDgi && (
          <View wrap={false}>
            <Text style={styles.sectionHeading}>REGISTRO EN EFACTURA (DGI)</Text>
            <View style={styles.dgiBox}>
              {dgi.numero_documento && (
                <InfoLine label="N° DGI" value={dgi.numero_documento} bold />
              )}
              {dgi.cufe && <InfoLine label="CUFE" value={dgi.cufe} />}
              {dgi.fecha_autorizacion && (
                <InfoLine
                  label="Autorizada"
                  value={formatDateEs(dgi.fecha_autorizacion)}
                />
              )}
              {dgi.cafe_url && <InfoLine label="CAFE" value={dgi.cafe_url} />}
            </View>
          </View>
        )}

        {/* ===== Información de anulación (sólo en anuladas) ===== */}
        {isCancelled && (
          <View wrap={false}>
            <Text style={styles.sectionHeading}>INFORMACIÓN DE ANULACIÓN</Text>
            <View style={styles.cancellationBox}>
              <Text style={styles.cancellationText}>
                Esta factura fue anulada. Esta acción es irreversible.
              </Text>
              {cancellation.reason && (
                <View style={{ marginTop: 6 }}>
                  <Text style={[styles.infoLineLabel, { width: "auto" }]}>
                    Razón:
                  </Text>
                  <Text style={styles.cancellationText}>
                    {cancellation.reason}
                  </Text>
                </View>
              )}
              {cancellation.cancelled_at && (
                <View style={{ marginTop: 6 }}>
                  <Text style={[styles.infoLineLabel, { width: "auto" }]}>
                    Fecha de anulación:
                  </Text>
                  <Text style={styles.cancellationText}>
                    {formatDateTimeEs(cancellation.cancelled_at)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ===== Footer (todas las páginas) ===== */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerNote}>
            Documento interno. La factura fiscal oficial se emite en eFactura.
          </Text>
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>
              Integra Legal · Panamá · Generado el {generated_at_label}
              {generated_by_label ? ` por ${generated_by_label}` : ""}
            </Text>
            <Text
              style={styles.footerText}
              render={({ pageNumber, totalPages }) =>
                `Página ${pageNumber} de ${totalPages}`
              }
            />
          </View>
        </View>
      </Page>
    </Document>
  );
}
