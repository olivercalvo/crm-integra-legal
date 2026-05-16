/**
 * Server-side helper: convierte un CreditNoteDocument React-PDF en un Buffer
 * binario, generación on-demand sin cache.
 *
 * Mismo patrón que generate-quote-pdf.ts pero sin el cache en `documents`:
 * las NCs se ven raramente (solo al anular), así que pagar 1-2 segundos de
 * regeneración cada call es aceptable y simplifica el código.
 */

import { pdf, type DocumentProps } from "@react-pdf/renderer";
import {
  CreditNoteDocument,
  type CreditNoteDocumentProps,
} from "@/lib/finanzas/pdf/CreditNoteDocument";
import React, { type ReactElement } from "react";

export async function generateCreditNotePdfBuffer(
  props: CreditNoteDocumentProps
): Promise<Buffer> {
  const element = React.createElement(
    CreditNoteDocument,
    props
  ) as unknown as ReactElement<DocumentProps>;
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
