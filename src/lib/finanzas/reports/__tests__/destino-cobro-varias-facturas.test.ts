/**
 * El Libro Mayor y un cobro aplicado a VARIAS facturas (Parte B, 21/09/2026):
 * antes quedaba sin enlace; ahora va al listado de cobros filtrado por su
 * número de recibo. Un cobro de UNA factura sigue yendo a la factura, y uno
 * sin número (anterior a la 047 sin backfill) sigue sin enlace.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadDestinosDeOrigen } from "@/lib/finanzas/reports/libro-mayor-source";
import { RUTA_DEL_DOCUMENTO, rutasDeEjemplo } from "@/lib/finanzas/reports/destino-documento";

const TENANT = "t1";

function fakeDb(datos: Record<string, unknown[]>) {
  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const op of ["select", "eq", "in", "order"]) q[op] = self;
    q.then = (r: (v: unknown) => unknown) => r({ data: datos[nombre] ?? [], error: null });
    return q;
  };
  return { from: tabla };
}

test("un cobro de una factura → la factura; de varias → /finanzas/cobros?q=REC-…; sin número → sin enlace", async () => {
  const db = fakeDb({
    payment_applications: [
      { payment_id: "p1", invoice_id: "i1" },
      { payment_id: "p2", invoice_id: "i1" },
      { payment_id: "p2", invoice_id: "i2" },
      { payment_id: "p3", invoice_id: "i3" },
      { payment_id: "p3", invoice_id: "i4" },
    ],
    payment_reversals: [],
    payments: [
      { id: "p2", payment_number: "REC-000012" },
      { id: "p3", payment_number: null },
    ],
  });
  const destinos = await loadDestinosDeOrigen(db as never, TENANT, [
    { source_type: "pago", source_id: "p1" },
    { source_type: "pago", source_id: "p2" },
    { source_type: "pago", source_id: "p3" },
  ] as never);

  assert.equal(destinos.get("p1"), "/finanzas/facturas/i1");
  assert.equal(destinos.get("p2"), "/finanzas/cobros?q=REC-000012");
  assert.equal(destinos.has("p3"), false, "sin número no hay qué filtrar: sin enlace, como antes");
});

test("la ruta del cobro multi-factura codifica el número y nav-guard la cruza sin el query", () => {
  assert.equal(RUTA_DEL_DOCUMENTO.cobro_varias_facturas("REC-000012"), "/finanzas/cobros?q=REC-000012");
  const ejemplo = rutasDeEjemplo().find((r) => r.sourceType === "cobro_varias_facturas");
  assert.equal(ejemplo?.ruta, "/finanzas/cobros", "el middleware decide por pathname");
});
