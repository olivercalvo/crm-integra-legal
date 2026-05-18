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

/**
 * Logo PNG cargado a Buffer al cargar el módulo. @react-pdf/renderer 4.x
 * acepta objetos `{ data, format }` para imágenes locales; pasar un path
 * absoluto no funciona en Node (intenta fetch HTTP y falla silenciosamente).
 *
 * El archivo vive en public/integra-logo.png. Resolvemos contra cwd para
 * que funcione tanto en dev (Next.js root) como en build (Vercel cwd).
 */
const LOGO_PNG_BUFFER: Buffer = fs.readFileSync(
  path.join(process.cwd(), "public", "integra-logo.png")
);

const LOGO_SRC = { data: LOGO_PNG_BUFFER, format: "png" as const };

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
  /** Título descriptivo de la cotización (Sprint 2E.3.2). Se muestra debajo de COT-NNNNNN en el header del PDF. */
  title: string;
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
  /**
   * Notas internas. NO se renderizan en el PDF desde Sprint QUOTES-POLISH
   * (eran "internas" en UI pero llegaban al cliente — bug corregido).
   * Mantenemos el campo en props por compatibilidad con callers existentes;
   * se ignora silenciosamente al renderizar.
   */
  notes: string | null;
  /** Observaciones cliente-visible (Sprint QUOTES-POLISH). Sección condicional debajo de totales. */
  observations: string | null;
  terms_and_conditions: string | null;
  generated_at_label: string;
  generated_by_label: string;
  /**
   * Página final "EVIDENCIA DE ACEPTACIÓN ELECTRÓNICA" — solo se renderiza
   * cuando la cotización fue aceptada vía portal (Sprint 2E.4). Si es null,
   * el PDF es el normal sin la página de evidencia.
   */
  acceptance_evidence?: QuoteAcceptanceEvidence | null;
}

/** Datos del audit log FES que se imprimen en la página de evidencia. */
export interface QuoteAcceptanceEvidence {
  full_name: string;
  position: string;
  id_document: string | null;
  accepted_at_iso: string;       // ISO UTC
  accepted_at_panama: string;    // "DD/MM/YYYY HH:mm:ss · UTC-5"
  ip_address: string | null;
  user_agent: string | null;
  origin_url: string | null;
  consent_text_version: string;
  signature_text: string;
  /** SHA-256 hex (64 chars) sobre el payload firmado, para verificación posterior. */
  evidence_hash: string;
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
    // Sprint QUOTES-POLISH: compactaciones para target "1 página en ≤7 líneas".
    paddingTop: 28,         // antes 36
    paddingBottom: 40,      // antes 60
    paddingHorizontal: 36,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: COLOR_NAVY,
  },
  // ---- Header ----
  header: {
    borderBottomWidth: 2,
    borderBottomColor: COLOR_GOLD,
    paddingBottom: 10,      // antes 12
    marginBottom: 14,       // antes 18
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
    height: 57,             // 130 * (259/592) ≈ 56.85 → 57 preserva ratio del PNG (592×259).
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
  // ---- Subtítulo título cotización (Sprint 2E.3.2) ----
  titleBar: {
    marginBottom: 14,
    marginTop: -4,
  },
  titleText: {
    fontFamily: "Helvetica-Oblique",
    fontSize: 11,
    color: COLOR_NAVY,
    lineHeight: 1.3,
  },
  // ---- Two-col info ----
  infoRow: {
    flexDirection: "row",
    marginBottom: 10,       // antes 16
    gap: 14,                // antes 18
  },
  infoCol: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLOR_GRAY_200,
    borderRadius: 4,
    padding: 8,             // antes 10
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
    marginBottom: 12,       // antes 18
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
    bottom: 20,             // antes 24
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: COLOR_GRAY_300,
    paddingTop: 5,          // antes 6
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 6.5,          // antes 7
    color: COLOR_GRAY_400,
  },
  // ---- Página de Evidencia FES (Sprint 2E.4) ----
  evidenceTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: COLOR_NAVY,
    letterSpacing: 1.5,
    marginTop: 4,
    marginBottom: 6,
    textAlign: "center",
  },
  evidenceSubtitle: {
    fontSize: 8.5,
    color: COLOR_GRAY_500,
    lineHeight: 1.5,
    marginBottom: 14,
    textAlign: "center",
  },
  evidenceSection: {
    borderWidth: 1,
    borderColor: COLOR_GRAY_200,
    borderRadius: 4,
    padding: 10,
    marginBottom: 10,
  },
  evidenceSectionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: COLOR_GOLD,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  evidenceRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  evidenceLabel: {
    width: 85,
    fontSize: 9,
    color: COLOR_GRAY_500,
  },
  evidenceValue: {
    flex: 1,
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: COLOR_NAVY,
  },
  evidenceValueMono: {
    flex: 1,
    fontSize: 8.5,
    fontFamily: "Helvetica",
    color: COLOR_NAVY,
  },
  evidenceValueMonoSmall: {
    flex: 1,
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: COLOR_NAVY,
    lineHeight: 1.3,
  },
  evidenceConsentBox: {
    backgroundColor: COLOR_GRAY_50,
    borderWidth: 0.5,
    borderColor: COLOR_GRAY_300,
    borderRadius: 3,
    padding: 8,
    marginBottom: 4,
  },
  evidenceConsentText: {
    fontSize: 9,
    color: COLOR_NAVY,
    lineHeight: 1.5,
    fontFamily: "Helvetica-Oblique",
  },
  evidenceConsentVersion: {
    fontSize: 7,
    color: COLOR_GRAY_400,
    fontFamily: "Helvetica",
    marginTop: 2,
  },
  evidenceLegalBox: {
    marginTop: 6,
    padding: 8,
    backgroundColor: COLOR_BLUE_50,
    borderLeftWidth: 3,
    borderLeftColor: COLOR_BLUE_700,
  },
  evidenceLegalText: {
    fontSize: 8,
    color: COLOR_NAVY,
    lineHeight: 1.5,
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
    title,
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
    // Sprint QUOTES-POLISH: `notes` ya NO se renderiza en el PDF (eran
    // "internas" en UI pero llegaban al cliente). El campo sigue en props
    // para compatibilidad con callers, pero lo ignoramos.
    observations,
    terms_and_conditions,
    generated_at_label,
    generated_by_label,
    acceptance_evidence,
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
            {/* Logo Chapman & Batista Asociados — PNG en public/, ratio 592:259. */}
            <Image src={LOGO_SRC} style={styles.brandLogo} />
          </View>
          <View style={styles.docHeader}>
            <Text style={styles.docHeaderTitle}>COTIZACIÓN</Text>
            <Text style={styles.docHeaderNumber}>{quote_number}</Text>
            <Text style={styles.statusBadge}>{status_label.toUpperCase()}</Text>
          </View>
        </View>

        {/* ===== Título descriptivo (Sprint 2E.3.2) ===== */}
        {title && title.trim().length > 0 && (
          <View style={styles.titleBar}>
            <Text style={styles.titleText}>{title}</Text>
          </View>
        )}

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

        {/* ===== Observaciones (cliente-visible, Sprint QUOTES-POLISH) ===== */}
        {observations && observations.trim().length > 0 && (
          <View wrap={false}>
            <Text style={styles.sectionHeading}>OBSERVACIONES</Text>
            <View style={styles.notesBox}>
              <Text style={styles.notesText}>{observations}</Text>
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

      {/* ===== Página final de evidencia FES (Sprint 2E.4) ===== */}
      {acceptance_evidence && (
        <Page size="LETTER" style={styles.page}>
          {/* Header reducido */}
          <View style={styles.header}>
            <View style={styles.brand}>
              <Image src={LOGO_SRC} style={styles.brandLogo} />
            </View>
            <View style={styles.docHeader}>
              <Text style={styles.docHeaderTitle}>EVIDENCIA FES</Text>
              <Text style={styles.docHeaderNumber}>{quote_number}</Text>
            </View>
          </View>

          <Text style={styles.evidenceTitle}>
            EVIDENCIA DE ACEPTACIÓN ELECTRÓNICA
          </Text>
          <Text style={styles.evidenceSubtitle}>
            Documento generado automáticamente al recibir la aceptación del
            cliente a través del portal web de Integra Legal. Esta página
            sirve como evidencia legal según la Ley 51 de 2008 de la
            República de Panamá (Documentos Electrónicos y Firmas
            Electrónicas).
          </Text>

          <View style={styles.evidenceSection}>
            <Text style={styles.evidenceSectionTitle}>DATOS DEL FIRMANTE</Text>
            <View style={styles.evidenceRow}>
              <Text style={styles.evidenceLabel}>Nombre completo</Text>
              <Text style={styles.evidenceValue}>
                {acceptance_evidence.full_name}
              </Text>
            </View>
            <View style={styles.evidenceRow}>
              <Text style={styles.evidenceLabel}>Cargo</Text>
              <Text style={styles.evidenceValue}>
                {acceptance_evidence.position}
              </Text>
            </View>
            {acceptance_evidence.id_document && (
              <View style={styles.evidenceRow}>
                <Text style={styles.evidenceLabel}>Documento</Text>
                <Text style={styles.evidenceValue}>
                  {acceptance_evidence.id_document}
                </Text>
              </View>
            )}
            <View style={styles.evidenceRow}>
              <Text style={styles.evidenceLabel}>En nombre de</Text>
              <Text style={styles.evidenceValue}>{client.name}</Text>
            </View>
          </View>

          <View style={styles.evidenceSection}>
            <Text style={styles.evidenceSectionTitle}>FECHA Y HORA</Text>
            <View style={styles.evidenceRow}>
              <Text style={styles.evidenceLabel}>Hora Panamá</Text>
              <Text style={styles.evidenceValue}>
                {acceptance_evidence.accepted_at_panama}
              </Text>
            </View>
            <View style={styles.evidenceRow}>
              <Text style={styles.evidenceLabel}>UTC</Text>
              <Text style={styles.evidenceValueMono}>
                {acceptance_evidence.accepted_at_iso}
              </Text>
            </View>
          </View>

          <View style={styles.evidenceSection}>
            <Text style={styles.evidenceSectionTitle}>
              TEXTO ACEPTADO (CONSENT FES)
            </Text>
            <View style={styles.evidenceConsentBox}>
              <Text style={styles.evidenceConsentText}>
                {acceptance_evidence.signature_text}
              </Text>
            </View>
            <Text style={styles.evidenceConsentVersion}>
              Versión del consent: {acceptance_evidence.consent_text_version}
            </Text>
          </View>

          <View style={styles.evidenceSection}>
            <Text style={styles.evidenceSectionTitle}>METADATOS TÉCNICOS</Text>
            <View style={styles.evidenceRow}>
              <Text style={styles.evidenceLabel}>Dirección IP</Text>
              <Text style={styles.evidenceValueMono}>
                {acceptance_evidence.ip_address ?? "—"}
              </Text>
            </View>
            <View style={styles.evidenceRow}>
              <Text style={styles.evidenceLabel}>User-Agent</Text>
              <Text style={styles.evidenceValueMonoSmall}>
                {acceptance_evidence.user_agent ?? "—"}
              </Text>
            </View>
            {acceptance_evidence.origin_url && (
              <View style={styles.evidenceRow}>
                <Text style={styles.evidenceLabel}>URL de origen</Text>
                <Text style={styles.evidenceValueMonoSmall}>
                  {acceptance_evidence.origin_url}
                </Text>
              </View>
            )}
            <View style={styles.evidenceRow}>
              <Text style={styles.evidenceLabel}>Hash SHA-256</Text>
              <Text style={styles.evidenceValueMonoSmall}>
                {acceptance_evidence.evidence_hash}
              </Text>
            </View>
          </View>

          <View style={styles.evidenceLegalBox}>
            <Text style={styles.evidenceLegalText}>
              Esta evidencia electrónica forma parte integral de la
              cotización {quote_number}. La aceptación registrada arriba
              constituye un acuerdo vinculante entre {client.name} e Integra
              Legal según los términos y condiciones de las páginas
              anteriores. El hash SHA-256 permite verificar a futuro que
              esta evidencia no ha sido alterada.
            </Text>
          </View>

          <View style={styles.footer} fixed>
            <Text style={styles.footerText}>
              Integra Legal · Panamá · Evidencia FES generada el{" "}
              {generated_at_label}
            </Text>
            <Text
              style={styles.footerText}
              render={({ pageNumber, totalPages }) =>
                `Página ${pageNumber} de ${totalPages}`
              }
            />
          </View>
        </Page>
      )}
    </Document>
  );
}
