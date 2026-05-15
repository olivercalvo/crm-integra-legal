/**
 * Server-side helper: convierte un VatSummaryDocument React-PDF en un Buffer
 * binario listo para devolver como response del endpoint export.
 *
 * Mismo patrón que generate-quote-pdf.ts (Sprint 2E.3).
 */

import { pdf, type DocumentProps } from "@react-pdf/renderer";
import React, { type ReactElement } from "react";
import {
  VatSummaryDocument,
  type VatSummaryDocumentProps,
} from "@/lib/finanzas/pdf/VatSummaryDocument";

export async function generateVatSummaryPdfBuffer(
  props: VatSummaryDocumentProps
): Promise<Buffer> {
  const element = React.createElement(VatSummaryDocument, props) as unknown as
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
