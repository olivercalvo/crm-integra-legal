/**
 * FACTURA → ASIENTO.
 *
 * Lo que se fija acá, en orden de importancia:
 *
 *   1. **Que NO exista una cuenta por defecto.** Es la regla que más fácil se
 *      "arregla" después: alguien ve el rechazo, le parece incómodo, y le pone
 *      un fallback. El test de `cuenta_invalida` falla si eso pasa.
 *   2. Que el mensaje NOMBRE el servicio y la cuenta. El RPC ya rechaza, pero su
 *      mensaje solo dice el código; el valor de este módulo es el texto.
 *   3. Que el ITBMS vaya a UNA cuenta, la `200003`.
 *   4. Que el reembolso acredite `130003` y no una cuenta de ingreso.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CUENTA_ITBMS,
  CUENTA_POR_COBRAR,
  claveIdempotenteDeFactura,
  construirAsientoDeFactura,
  type FacturaParaAsiento,
  type LineaFacturaParaAsiento,
} from "@/lib/finanzas/contabilidad/asiento-factura";

const INVOICE_ID = "11111111-1111-1111-1111-111111111111";

function linea(p: Partial<LineaFacturaParaAsiento> = {}): LineaFacturaParaAsiento {
  return {
    line_order: 1,
    description: "Asesoría",
    subtotal: 1000,
    tax_amount: 70,
    service_code: "HON-COR",
    revenue_account: "400001",
    cuenta_valida: true,
    ...p,
  };
}

function factura(p: Partial<FacturaParaAsiento> = {}): FacturaParaAsiento {
  return {
    id: INVOICE_ID,
    invoice_number: "FAC-HON-000009",
    issue_date: "2026-09-04",
    grand_total: 1070,
    client_name: "Cliente S.A.",
    lineas: [linea()],
    ...p,
  };
}

// ---------------------------------------------------------------------------
// El caso feliz
// ---------------------------------------------------------------------------

test("factura con ITBMS: DEBE CxC, HABER ingreso, HABER ITBMS", () => {
  const r = construirAsientoDeFactura(factura());
  assert.equal(r.ok, true);
  if (!r.ok) return;

  assert.equal(r.asiento.source_type, "factura");
  assert.equal(r.asiento.source_id, INVOICE_ID);
  assert.equal(r.asiento.reference, "FAC-HON-000009");
  assert.equal(r.asiento.transaction_date, "2026-09-04");

  assert.deepEqual(
    r.asiento.lines.map((l) => [l.account_code, l.debit, l.credit]),
    [
      [CUENTA_POR_COBRAR, 1070, 0],
      ["400001", 0, 1000],
      [CUENTA_ITBMS, 0, 70],
    ]
  );
});

test("el ITBMS va a 200003 — una sola cuenta, ventas y compras", () => {
  assert.equal(CUENTA_ITBMS, "200003");
  const r = construirAsientoDeFactura(factura());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const itbms = r.asiento.lines.filter((l) => l.account_code === CUENTA_ITBMS);
  assert.equal(itbms.length, 1, "el ITBMS no se parte en dos cuentas");
});

test("factura exenta (reembolso): sin línea de ITBMS, HABER 130003", () => {
  const r = construirAsientoDeFactura(
    factura({
      invoice_number: "FAC-REI-000003",
      grand_total: 150,
      lineas: [
        linea({
          description: "Timbres",
          subtotal: 150,
          tax_amount: 0,
          service_code: "REIM-TIM",
          revenue_account: "130003",
        }),
      ],
    })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;

  assert.deepEqual(
    r.asiento.lines.map((l) => [l.account_code, l.debit, l.credit]),
    [
      [CUENTA_POR_COBRAR, 150, 0],
      ["130003", 0, 150],
    ]
  );
  assert.ok(
    !r.asiento.lines.some((l) => l.account_code === CUENTA_ITBMS),
    "un reembolso exento no genera línea de ITBMS"
  );
});

test("dos servicios con la MISMA cuenta se agrupan en una línea", () => {
  const r = construirAsientoDeFactura(
    factura({
      grand_total: 3210,
      lineas: [
        linea({ line_order: 1, subtotal: 1000, tax_amount: 70, service_code: "HON-COR" }),
        linea({ line_order: 2, subtotal: 2000, tax_amount: 140, service_code: "HON-CIV" }),
      ],
    })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const ingreso = r.asiento.lines.filter((l) => l.account_code === "400001");
  assert.equal(ingreso.length, 1);
  assert.equal(ingreso[0].credit, 3000);
});

test("servicios con cuentas distintas producen una línea cada uno", () => {
  const r = construirAsientoDeFactura(
    factura({
      grand_total: 3210,
      lineas: [
        linea({ line_order: 1, subtotal: 1000, tax_amount: 70, revenue_account: "400001" }),
        linea({
          line_order: 2,
          subtotal: 2000,
          tax_amount: 140,
          service_code: "HON-LAB",
          revenue_account: "400003",
        }),
      ],
    })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(
    r.asiento.lines.map((l) => l.account_code),
    [CUENTA_POR_COBRAR, "400001", "400003", CUENTA_ITBMS]
  );
});

// ---------------------------------------------------------------------------
// 🔴 LOS RECHAZOS. Acá vive la regla que hay que proteger.
// ---------------------------------------------------------------------------

test("cuenta inactiva → RECHAZA, y el mensaje nombra el servicio y la cuenta", () => {
  const r = construirAsientoDeFactura(
    factura({
      lineas: [linea({ service_code: "HON-COR", revenue_account: "4101", cuenta_valida: false })],
    })
  );
  assert.equal(r.ok, false);
  if (r.ok) return;

  assert.equal(r.motivo, "cuenta_invalida");
  assert.match(r.mensaje, /HON-COR/, "el mensaje nombra el SERVICIO");
  assert.match(r.mensaje, /4101/, "el mensaje nombra la CUENTA");
  assert.match(r.mensaje, /FAC-HON-000009/, "y la factura");
});

test("🔴 NO hay cuenta por defecto: una cuenta inválida nunca postea a un genérico", () => {
  const r = construirAsientoDeFactura(
    factura({
      lineas: [linea({ revenue_account: "4101", cuenta_valida: false })],
    })
  );
  // Si alguien agrega un fallback, esto empieza a devolver ok:true y el test
  // falla. Es el punto entero del archivo.
  assert.equal(
    r.ok,
    false,
    "una cuenta inválida NO puede resolverse con una cuenta genérica"
  );
});

test("varias líneas mal configuradas: el mensaje las nombra a todas, sin repetir", () => {
  const r = construirAsientoDeFactura(
    factura({
      lineas: [
        linea({ line_order: 1, service_code: "HON-COR", revenue_account: "4101", cuenta_valida: false }),
        linea({ line_order: 2, service_code: "HON-COR", revenue_account: "4101", cuenta_valida: false }),
        linea({ line_order: 3, service_code: "HON-FAM", revenue_account: "4101", cuenta_valida: false }),
      ],
    })
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.mensaje, /HON-COR/);
  assert.match(r.mensaje, /HON-FAM/);
  assert.equal(
    r.mensaje.match(/HON-COR/g)?.length,
    1,
    "el par servicio+cuenta repetido se nombra una sola vez"
  );
});

test("línea sin servicio → RECHAZA nombrando la línea", () => {
  const r = construirAsientoDeFactura(
    factura({
      lineas: [
        linea({ line_order: 2, description: "Cargo suelto", service_code: null, revenue_account: null }),
      ],
    })
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "sin_servicio");
  assert.match(r.mensaje, /línea 2/);
  assert.match(r.mensaje, /Cargo suelto/);
});

test("factura sin líneas → RECHAZA", () => {
  const r = construirAsientoDeFactura(factura({ lineas: [] }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "sin_lineas");
});

test("grand_total que no coincide con las líneas → RECHAZA sin postear", () => {
  const r = construirAsientoDeFactura(factura({ grand_total: 9999 }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "no_cuadra");
  assert.match(r.mensaje, /9999\.00/);
  assert.match(r.mensaje, /1070\.00/);
});

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------

test("la clave de idempotencia sale del id de la factura", () => {
  assert.equal(claveIdempotenteDeFactura(INVOICE_ID), `factura:${INVOICE_ID}`);
  const r = construirAsientoDeFactura(factura());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Las DOS llaves salen del mismo id: no pueden discrepar.
  assert.equal(r.asiento.idempotency_key, `factura:${INVOICE_ID}`);
  assert.equal(r.asiento.source_id, INVOICE_ID);
});

test("el mismo insumo produce el mismo asiento (determinista)", () => {
  const a = construirAsientoDeFactura(factura());
  const b = construirAsientoDeFactura(factura());
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Redondeo
// ---------------------------------------------------------------------------

test("centavos: tres líneas que suman con decimales cuadran igual", () => {
  const r = construirAsientoDeFactura(
    factura({
      grand_total: 107.0,
      lineas: [
        linea({ line_order: 1, subtotal: 33.33, tax_amount: 2.33 }),
        linea({ line_order: 2, subtotal: 33.33, tax_amount: 2.33 }),
        linea({ line_order: 3, subtotal: 33.34, tax_amount: 2.34 }),
      ],
    })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const d = r.asiento.lines.reduce((s, l) => s + l.debit, 0);
  const c = r.asiento.lines.reduce((s, l) => s + l.credit, 0);
  assert.equal(Math.round(d * 100), Math.round(c * 100));
});
