/**
 * Server-side helper: convierte un QuoteDocument React-PDF en un Buffer
 * binario listo para subir a Storage o adjuntar a un email (Sprint 2E.3).
 *
 * Uso:
 *   const buffer = await generateQuotePdfBuffer(documentProps);
 *
 * Notas técnicas:
 *   - @react-pdf/renderer es ESM-only y server-compatible (usa pdfkit
 *     bajo el capó, no requiere browser APIs). Funciona en Vercel
 *     serverless con runtime nodejs.
 *   - pdf(<Component />) devuelve un instance con métodos asíncronos.
 *     `toBuffer()` retorna un Node Readable; lo materializamos a Buffer
 *     completo (los PDFs de cotizaciones son chicos, ≤ pocos MB).
 *   - NO usar `renderToBuffer` directamente porque la API estable de
 *     react-pdf 4.x expone `pdf().toBuffer()`.
 */

import { pdf, type DocumentProps } from "@react-pdf/renderer";
import {
  QuoteDocument,
  type QuoteDocumentProps,
} from "@/lib/finanzas/pdf/QuoteDocument";
import React, { type ReactElement } from "react";

/**
 * Genera el PDF de una cotización y devuelve el Buffer Node completo.
 *
 * @throws Si la generación falla, propaga el error original (típicamente
 * problemas de layout, fuentes no embebidas o memoria insuficiente para
 * cotizaciones gigantes).
 */
export async function generateQuotePdfBuffer(
  props: QuoteDocumentProps
): Promise<Buffer> {
  // pdf() exige ReactElement<DocumentProps>. QuoteDocument retorna <Document>
  // pero TS infiere QuoteDocumentProps en el wrapper — cast seguro.
  const element = React.createElement(QuoteDocument, props) as unknown as
    ReactElement<DocumentProps>;
  const instance = pdf(element);
  // toBuffer() retorna NodeJS.ReadableStream en react-pdf 4.x.
  // Lo materializamos a Buffer completo.
  const stream = await instance.toBuffer();
  return await streamToBuffer(stream);
}

/**
 * Materializa un Readable stream Node.js a un Buffer completo.
 * Si lo que recibimos ya es un Buffer, lo devuelve tal cual (defensivo).
 */
async function streamToBuffer(
  stream: NodeJS.ReadableStream | Buffer
): Promise<Buffer> {
  if (Buffer.isBuffer(stream)) {
    return stream;
  }
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
