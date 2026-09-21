/**
 * Server-side helper: convierte un ReceiptDocument (recibo de caja) en un
 * Buffer listo para subir a Storage. Bloque 2 — espejo de
 * generate-invoice-pdf.ts.
 */

import { pdf, type DocumentProps } from "@react-pdf/renderer";
import {
  ReceiptDocument,
  type ReceiptDocumentProps,
} from "@/lib/finanzas/pdf/ReceiptDocument";
import React, { type ReactElement } from "react";

export async function generateReceiptPdfBuffer(
  props: ReceiptDocumentProps
): Promise<Buffer> {
  const element = React.createElement(ReceiptDocument, props) as unknown as
    ReactElement<DocumentProps>;
  const instance = pdf(element);
  const stream = await instance.toBuffer();
  return await streamToBuffer(stream);
}

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
