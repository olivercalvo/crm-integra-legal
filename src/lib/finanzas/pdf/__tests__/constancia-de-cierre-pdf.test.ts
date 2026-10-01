/** La constancia de cierre (075) se genera y es un PDF de verdad. */
import test from "node:test";
import assert from "node:assert/strict";
import { generateConstanciaDeCierrePdfBuffer } from "@/lib/finanzas/pdf/generate-constancia-de-cierre-pdf";

test("la constancia de cierre se genera como PDF", async () => {
  const buf = await generateConstanciaDeCierrePdfBuffer({
    bufete: "INTEGRA LEGAL",
    periodo: "Octubre 2026",
    entryNumber: 106,
    hash: "3f".repeat(32),
    ancladoEl: "01/10/2026 15:00",
    ancladoPor: null,
    generadoEl: "01/10/2026 15:01",
  });
  assert.equal(buf.subarray(0, 4).toString(), "%PDF");
  assert.ok(buf.length > 1000);
});
