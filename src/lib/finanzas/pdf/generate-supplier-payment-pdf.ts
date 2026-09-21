/**
 * Server-side helper: convierte un SupplierPaymentDocument (comprobante de
 * egreso) en un Buffer listo para subir a Storage. Bloque 3 — espejo de
 * generate-receipt-pdf.ts.
 */

import { pdf, type DocumentProps } from "@react-pdf/renderer";
import {
  SupplierPaymentDocument,
  type SupplierPaymentDocumentProps,
} from "@/lib/finanzas/pdf/SupplierPaymentDocument";
import React, { type ReactElement } from "react";

export async function generateSupplierPaymentPdfBuffer(
  props: SupplierPaymentDocumentProps
): Promise<Buffer> {
  const element = React.createElement(SupplierPaymentDocument, props) as unknown as
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
