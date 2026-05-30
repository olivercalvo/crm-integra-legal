/**
 * Server-side helper: convierte un InvoiceDocument React-PDF en un Buffer
 * binario listo para subir a Storage (Sprint 2F — espejo de
 * generate-quote-pdf.ts).
 */

import { pdf, type DocumentProps } from "@react-pdf/renderer";
import {
  InvoiceDocument,
  type InvoiceDocumentProps,
} from "@/lib/finanzas/pdf/InvoiceDocument";
import React, { type ReactElement } from "react";

export async function generateInvoicePdfBuffer(
  props: InvoiceDocumentProps
): Promise<Buffer> {
  const element = React.createElement(InvoiceDocument, props) as unknown as
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
