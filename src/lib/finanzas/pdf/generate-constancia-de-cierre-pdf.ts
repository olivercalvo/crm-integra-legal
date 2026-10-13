/**
 * Server-side: la constancia de cierre de período (075) como Buffer PDF.
 * Mismo patrón que `generate-vat-summary-pdf.ts`. No se guarda en el bucket:
 * se genera cada vez desde el ancla, que es inmutable, así que siempre dice lo
 * mismo.
 */

import { pdf, type DocumentProps } from "@react-pdf/renderer";
import React, { type ReactElement } from "react";
import {
  ConstanciaDeCierreDocument,
  type ConstanciaDeCierreProps,
} from "@/lib/finanzas/pdf/ConstanciaDeCierreDocument";

export async function generateConstanciaDeCierrePdfBuffer(props: ConstanciaDeCierreProps): Promise<Buffer> {
  const element = React.createElement(ConstanciaDeCierreDocument, props) as unknown as ReactElement<DocumentProps>;
  const salida = await pdf(element).toBuffer();
  if (Buffer.isBuffer(salida)) return salida;
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const s = salida as unknown as NodeJS.ReadableStream;
    s.on("data", (c: Buffer | string) => chunks.push(typeof c === "string" ? Buffer.from(c) : c));
    s.on("end", () => resolve(Buffer.concat(chunks)));
    s.on("error", reject);
  });
}
