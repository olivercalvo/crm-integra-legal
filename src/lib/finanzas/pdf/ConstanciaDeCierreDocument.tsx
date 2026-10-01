/**
 * CONSTANCIA DE CIERRE DE PERÍODO (R-1b, migración `075`).
 *
 * El documento que el contador guarda FUERA del sistema: dice el período, el
 * último asiento del libro al cerrarlo y su huella (el hash completo). Si algún
 * día alguien reescribe la cadena, el hash de ese asiento ya no coincide con lo
 * que dice este papel, y `verify_chain_anchors` lo señala.
 *
 * Server-only: usa @react-pdf/renderer. Paleta Integra: navy y dorado.
 */

import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const NAVY = "#1B2A4A";
const GOLD = "#C5A55A";
const GRIS = "#6B7280";

export interface ConstanciaDeCierreProps {
  bufete: string;
  /** «Octubre 2026», o «Ancla inicial» si no salió de un cierre. */
  periodo: string;
  entryNumber: number;
  hash: string;
  /** Fecha y hora del cierre, ya en texto de Panamá. */
  ancladoEl: string;
  ancladoPor: string | null;
  generadoEl: string;
}

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10, color: "#111827", padding: 36 },
  banda: { backgroundColor: NAVY, padding: 14, marginBottom: 18 },
  titulo: { color: "#FFFFFF", fontSize: 15, fontFamily: "Helvetica-Bold" },
  subtitulo: { color: GOLD, fontSize: 10, marginTop: 3 },
  fila: { flexDirection: "row", marginBottom: 8 },
  etiqueta: { width: 150, color: GRIS },
  valor: { flex: 1, fontFamily: "Helvetica-Bold" },
  huellaCaja: { marginTop: 10, borderWidth: 1, borderColor: GOLD, padding: 10 },
  huella: { fontFamily: "Courier", fontSize: 10, letterSpacing: 0.5 },
  nota: { marginTop: 18, color: GRIS, fontSize: 9, lineHeight: 1.4 },
  pie: { position: "absolute", bottom: 24, left: 36, right: 36, color: GRIS, fontSize: 8 },
});

export function ConstanciaDeCierreDocument(p: ConstanciaDeCierreProps) {
  // La huella en bloques de 16 para que se pueda dictar y comparar a ojo.
  const bloques = p.hash.match(/.{1,16}/g) ?? [p.hash];
  return (
    <Document title={`Constancia de cierre ${p.periodo}`}>
      <Page size="A4" style={s.page}>
        <View style={s.banda}>
          <Text style={s.titulo}>Constancia de cierre de período</Text>
          <Text style={s.subtitulo}>{p.bufete}</Text>
        </View>

        <View style={s.fila}>
          <Text style={s.etiqueta}>Período</Text>
          <Text style={s.valor}>{p.periodo}</Text>
        </View>
        <View style={s.fila}>
          <Text style={s.etiqueta}>Último asiento del libro</Text>
          <Text style={s.valor}>N.º {p.entryNumber}</Text>
        </View>
        <View style={s.fila}>
          <Text style={s.etiqueta}>Anclado el</Text>
          <Text style={s.valor}>{p.ancladoEl}</Text>
        </View>
        {p.ancladoPor && (
          <View style={s.fila}>
            <Text style={s.etiqueta}>Cerró</Text>
            <Text style={s.valor}>{p.ancladoPor}</Text>
          </View>
        )}

        <View style={s.huellaCaja}>
          <Text style={{ color: GRIS, marginBottom: 6 }}>Huella del asiento (hash SHA-256)</Text>
          {bloques.map((b, i) => (
            <Text key={i} style={s.huella}>
              {b}
            </Text>
          ))}
        </View>

        <Text style={s.nota}>
          Guarde esta constancia fuera del sistema. Si alguna vez se reescribiera el libro contable,
          la huella del asiento N.º {p.entryNumber} dejaría de coincidir con la de este documento, y
          la verificación de la cadena lo señala. Una constancia no se corrige: cada cierre emite la
          suya.
        </Text>

        <Text style={s.pie}>Generada el {p.generadoEl}. CRM Integra Legal.</Text>
      </Page>
    </Document>
  );
}
