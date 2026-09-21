/**
 * Plantilla PDF del RECIBO DE CAJA (Bloque 2, 21/09/2026).
 *
 * Mismo estilo que `InvoiceDocument.tsx` (paleta navy/gold, Helvetica, carta):
 *   - Header: logo + "RECIBO DE CAJA" + REC-000012 + badge de estado.
 *   - Dos columnas: CLIENTE (nombre, N°, RUC y DV en líneas SEPARADAS) y
 *     DATOS DEL COBRO (fecha, método, banco, referencia, asiento).
 *   - Tabla "Aplicado a": una fila por factura (hoy una; el modelo admite
 *     varias), con emisión, total de la factura y monto aplicado.
 *   - Total cobrado en la tarjeta dorada.
 *   - Banda roja "REVERSADO" con fecha, motivo y asiento espejo, si aplica.
 *   - Footer fijo: "Documento interno de control. No es factura ni documento
 *     fiscal." — un recibo de caja no pasa por la DGI.
 *
 * Server-only: usa @react-pdf/renderer. NO importar desde Client Components.
 */

import React from "react";
import path from "node:path";
import fs from "node:fs";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";

const LOGO_PNG_BUFFER: Buffer = fs.readFileSync(path.join(process.cwd(), "public", "integra-logo.png"));
const LOGO_SRC = { data: LOGO_PNG_BUFFER, format: "png" as const };

export interface ReceiptDocumentProps {
  payment_number: string;
  payment_date: string; // YYYY-MM-DD
  amount: number;
  method_label: string;
  reference: string | null;
  notes: string | null;
  reversado: boolean;
  client: {
    name: string;
    client_number: string;
    tax_id: string | null;
    tax_id_type: string | null;
    digito_verificador: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  aplicaciones: {
    invoice_number: string;
    issue_date: string;
    grand_total: number;
    amount_applied: number;
  }[];
  banco: { code: string; name: string } | null;
  asiento: { entry_number: number; transaction_date: string } | null;
  reversion: { entry_number: number; reversed_at: string; reason: string } | null;
  registrado_por: string | null;
  generated_at_label: string;
  generated_by_label: string;
}

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
const COLOR_GREEN_700 = "#15803D";

function formatUSD(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `B/. ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateEs(iso: string | null): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatDateTimeEs(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
      return "RUC";
  }
}

const styles = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 44, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 9, color: COLOR_NAVY },
  header: {
    borderBottomWidth: 2, borderBottomColor: COLOR_GOLD, paddingBottom: 10, marginBottom: 14,
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end",
  },
  brandLogo: { width: 130, height: 57 },
  docHeader: { alignItems: "flex-end" },
  docHeaderTitle: { fontFamily: "Helvetica-Bold", fontSize: 13, color: COLOR_NAVY, letterSpacing: 1 },
  docHeaderNumber: { fontFamily: "Helvetica-Bold", fontSize: 14, color: COLOR_GOLD, marginTop: 2 },
  docHeaderKind: { fontFamily: "Helvetica", fontSize: 8, color: COLOR_GRAY_500, marginTop: 2, letterSpacing: 0.5 },
  statusBadge: {
    marginTop: 4, paddingVertical: 2, paddingHorizontal: 6, borderWidth: 1, borderColor: COLOR_GREEN_700,
    borderRadius: 3, fontSize: 7, fontFamily: "Helvetica-Bold", color: COLOR_GREEN_700, letterSpacing: 1,
  },
  statusBadgeDanger: { borderColor: COLOR_RED_700, color: COLOR_RED_700, backgroundColor: COLOR_RED_50 },
  infoRow: { flexDirection: "row", marginBottom: 10, gap: 14 },
  infoCol: { flex: 1, borderWidth: 1, borderColor: COLOR_GRAY_200, borderRadius: 4, padding: 8 },
  infoColHeading: { fontFamily: "Helvetica-Bold", fontSize: 8, color: COLOR_GOLD, letterSpacing: 1.5, marginBottom: 6 },
  infoLine: { flexDirection: "row", marginBottom: 2 },
  infoLineLabel: { width: 65, color: COLOR_GRAY_500, fontSize: 8 },
  infoLineValue: { flex: 1, color: COLOR_NAVY, fontSize: 9 },
  infoLineValueBold: { fontFamily: "Helvetica-Bold" },
  sectionHeading: { fontFamily: "Helvetica-Bold", fontSize: 9, color: COLOR_GOLD, letterSpacing: 1.5, marginBottom: 6, marginTop: 4 },
  table: { marginBottom: 12, borderWidth: 1, borderColor: COLOR_GRAY_200, borderRadius: 3 },
  tableHeader: { flexDirection: "row", backgroundColor: COLOR_NAVY, paddingVertical: 6, paddingHorizontal: 6 },
  tableHeaderCell: { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: COLOR_WHITE, letterSpacing: 0.5 },
  tableRow: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: COLOR_GRAY_200 },
  tableRowAlt: { backgroundColor: COLOR_GRAY_50 },
  tableCell: { fontSize: 8, color: COLOR_NAVY },
  colInv: { width: "35%" },
  colDate: { width: "20%" },
  colTotal: { width: "22%", textAlign: "right" as const },
  colApplied: { width: "23%", textAlign: "right" as const },
  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 12 },
  totalsCard: { width: "45%", borderWidth: 1, borderColor: COLOR_GOLD, borderRadius: 4, padding: 10, backgroundColor: COLOR_GRAY_50 },
  totalsGrandLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalsGrandLabel: { fontFamily: "Helvetica-Bold", fontSize: 11, color: COLOR_NAVY },
  totalsGrandValue: { fontFamily: "Helvetica-Bold", fontSize: 14, color: COLOR_NAVY },
  notesBox: { borderWidth: 0.5, borderColor: COLOR_GRAY_200, borderRadius: 3, padding: 8, backgroundColor: COLOR_GRAY_50, marginBottom: 14 },
  notesText: { fontSize: 8.5, color: COLOR_NAVY, lineHeight: 1.4 },
  reversalBox: { borderWidth: 1, borderColor: COLOR_RED_700, borderRadius: 3, padding: 8, backgroundColor: COLOR_RED_50, marginBottom: 14 },
  reversalTitle: { fontFamily: "Helvetica-Bold", fontSize: 9, color: COLOR_RED_700, letterSpacing: 1.5, marginBottom: 4 },
  reversalText: { fontSize: 8.5, color: COLOR_NAVY, lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, borderTopWidth: 0.5, borderTopColor: COLOR_GRAY_300, paddingTop: 5, flexDirection: "column" },
  footerNote: { fontSize: 7, color: COLOR_GRAY_500, fontFamily: "Helvetica-Oblique", marginBottom: 2 },
  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 6.5, color: COLOR_GRAY_400 },
});

function InfoLine({ label, value, bold }: { label: string; value: string | null | undefined; bold?: boolean }) {
  if (!value) return null;
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLineLabel}>{label}</Text>
      <Text style={[styles.infoLineValue, ...(bold ? [styles.infoLineValueBold] : [])]}>{value}</Text>
    </View>
  );
}

export function ReceiptDocument(props: ReceiptDocumentProps) {
  const {
    payment_number, payment_date, amount, method_label, reference, notes, reversado,
    client, aplicaciones, banco, asiento, reversion, registrado_por, generated_at_label, generated_by_label,
  } = props;

  return (
    <Document
      title={`Recibo de caja ${payment_number}`}
      author="Integra Legal"
      subject={`Recibo de caja ${payment_number} · ${client.name}`}
      creator="CRM Integra Legal"
      producer="CRM Integra Legal"
    >
      <Page size="LETTER" style={styles.page}>
        {/* ===== Header ===== */}
        <View style={styles.header} fixed>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- Image de react-pdf, no un <img> del DOM */}
            <Image src={LOGO_SRC} style={styles.brandLogo} />
          </View>
          <View style={styles.docHeader}>
            <Text style={styles.docHeaderTitle}>RECIBO DE CAJA</Text>
            <Text style={styles.docHeaderNumber}>{payment_number}</Text>
            <Text style={styles.docHeaderKind}>COBRO A CLIENTE</Text>
            <Text style={[styles.statusBadge, ...(reversado ? [styles.statusBadgeDanger] : [])]}>
              {reversado ? "REVERSADO" : "REGISTRADO"}
            </Text>
          </View>
        </View>

        {/* ===== Cliente + datos del cobro ===== */}
        <View style={styles.infoRow}>
          <View style={styles.infoCol}>
            <Text style={styles.infoColHeading}>RECIBIDO DE</Text>
            <InfoLine label="Nombre" value={client.name} bold />
            <InfoLine label="N° cliente" value={client.client_number} />
            {/* RUC y DV en dos líneas, nunca concatenados (CLAUDE.md §5). */}
            <InfoLine label={taxIdTypeLabel(client.tax_id_type)} value={client.tax_id} />
            <InfoLine label="DV" value={client.digito_verificador} />
            <InfoLine label="Email" value={client.email} />
            <InfoLine label="Teléfono" value={client.phone} />
            <InfoLine label="Dirección" value={client.address} />
          </View>
          <View style={styles.infoCol}>
            <Text style={styles.infoColHeading}>DATOS DEL COBRO</Text>
            <InfoLine label="Fecha" value={formatDateEs(payment_date)} bold />
            <InfoLine label="Método" value={method_label} bold />
            <InfoLine label="Banco" value={banco ? `${banco.code} — ${banco.name}` : null} />
            <InfoLine label="Referencia" value={reference} />
            <InfoLine label="Moneda" value="USD (B/.)" />
            <InfoLine label="Asiento" value={asiento ? `N° ${asiento.entry_number} · ${formatDateEs(asiento.transaction_date)}` : null} />
            <InfoLine label="Registró" value={registrado_por} />
          </View>
        </View>

        {/* ===== Aplicado a ===== */}
        <Text style={styles.sectionHeading}>APLICADO A</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colInv]}>FACTURA</Text>
            <Text style={[styles.tableHeaderCell, styles.colDate]}>EMISIÓN</Text>
            <Text style={[styles.tableHeaderCell, styles.colTotal]}>TOTAL FACTURA</Text>
            <Text style={[styles.tableHeaderCell, styles.colApplied]}>MONTO APLICADO</Text>
          </View>
          {aplicaciones.map((a, i) => (
            <View key={`${a.invoice_number}-${i}`} style={[styles.tableRow, ...(i % 2 === 1 ? [styles.tableRowAlt] : [])]}>
              <Text style={[styles.tableCell, styles.colInv, styles.infoLineValueBold]}>{a.invoice_number}</Text>
              <Text style={[styles.tableCell, styles.colDate]}>{formatDateEs(a.issue_date)}</Text>
              <Text style={[styles.tableCell, styles.colTotal]}>{formatUSD(a.grand_total)}</Text>
              <Text style={[styles.tableCell, styles.colApplied]}>{formatUSD(a.amount_applied)}</Text>
            </View>
          ))}
        </View>

        {/* ===== Total ===== */}
        <View style={styles.totalsWrap}>
          <View style={styles.totalsCard}>
            <View style={styles.totalsGrandLine}>
              <Text style={styles.totalsGrandLabel}>TOTAL COBRADO</Text>
              <Text style={styles.totalsGrandValue}>{formatUSD(amount)}</Text>
            </View>
          </View>
        </View>

        {/* ===== Reversión ===== */}
        {reversado && reversion && (
          <View style={styles.reversalBox}>
            <Text style={styles.reversalTitle}>REVERSADO</Text>
            <Text style={styles.reversalText}>
              Este cobro fue reversado el {formatDateTimeEs(reversion.reversed_at)} con el asiento N° {reversion.entry_number}.
              El monto ya no está aplicado a la factura.
            </Text>
            <Text style={styles.reversalText}>Motivo: {reversion.reason}</Text>
          </View>
        )}

        {/* ===== Notas ===== */}
        {notes && (
          <>
            <Text style={styles.sectionHeading}>NOTAS</Text>
            <View style={styles.notesBox}>
              <Text style={styles.notesText}>{notes}</Text>
            </View>
          </>
        )}

        {/* ===== Footer ===== */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerNote}>
            Documento interno de control. No es factura ni documento fiscal; la factura fiscal correspondiente es la indicada arriba.
          </Text>
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>
              Integra Legal · Panamá · Generado el {generated_at_label}
              {generated_by_label ? ` por ${generated_by_label}` : ""}
            </Text>
            <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
          </View>
        </View>
      </Page>
    </Document>
  );
}
