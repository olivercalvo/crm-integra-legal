/**
 * COBRO y PAGO A PROVEEDOR → ASIENTO.
 *
 * Lo que se fija acá:
 *
 *   1. **Que no haya banco por defecto.** Es la regla que más fácil se "arregla"
 *      después, y la que más caro sale: `100003 Banco General Saldo Clientes`
 *      guarda plata que NO es del bufete, así que un default a la operativa
 *      diría que el bufete cobró algo que está reteniendo.
 *   2. Que el cobro y el pago sean **espejo** (el banco al debe / al haber).
 *   3. Que `pago_proveedor` sea un `source_type` DISTINTO de `pago`. Si alguien
 *      los unifica, el enlace del Libro Mayor manda a una factura que no existe.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CUENTA_POR_COBRAR,
  CUENTA_POR_PAGAR,
  SOURCE_TYPE_COBRO,
  SOURCE_TYPE_PAGO_PROVEEDOR,
  claveIdempotenteDeCobro,
  claveIdempotenteDePagoProveedor,
  construirAsientoDeCobro,
  construirAsientoDePagoProveedor,
  esCuentaDeBancoValida,
  type CobroParaAsiento,
  type PagoProveedorParaAsiento,
} from "@/lib/finanzas/contabilidad/asiento-tesoreria";

const COBRO_ID = "44444444-4444-4444-4444-444444444444";
const COMPRA_ID = "55555555-5555-5555-5555-555555555555";

function cobro(p: Partial<CobroParaAsiento> = {}): CobroParaAsiento {
  return {
    id: COBRO_ID,
    payment_number: "REC-000004",
    payment_date: "2026-09-04",
    amount: 1070,
    client_name: "Cliente S.A.",
    facturas: ["FAC-HON-000001"],
    payment_account_code: "100001",
    banco_valido: true,
    ...p,
  };
}

function pago(p: Partial<PagoProveedorParaAsiento> = {}): PagoProveedorParaAsiento {
  return {
    compra_id: COMPRA_ID,
    payment_date: "2026-09-04",
    total: 321,
    description: "Insumos de septiembre",
    supplier_name: "PROVEEDOR, S.A.",
    payment_account_code: "100001",
    banco_valido: true,
    ...p,
  };
}

// ---------------------------------------------------------------------------
// COBRO
// ---------------------------------------------------------------------------

test("cobro: DEBE el banco elegido / HABER 100004", () => {
  const r = construirAsientoDeCobro(cobro());
  assert.equal(r.ok, true);
  if (!r.ok) return;

  assert.equal(r.asiento.source_type, SOURCE_TYPE_COBRO);
  assert.equal(r.asiento.source_id, COBRO_ID);
  assert.deepEqual(
    r.asiento.lines.map((l) => [l.account_code, l.debit, l.credit]),
    [
      ["100001", 1070, 0],
      [CUENTA_POR_COBRAR, 0, 1070],
    ]
  );
});

test("cobro: el banco es EL QUE ELIGIERON, no uno fijo", () => {
  for (const banco of ["100001", "100002", "100003"]) {
    const r = construirAsientoDeCobro(cobro({ payment_account_code: banco }));
    assert.equal(r.ok, true);
    if (!r.ok) continue;
    assert.equal(
      r.asiento.lines[0].account_code,
      banco,
      "el débito tiene que ir a la cuenta elegida, no a una por defecto"
    );
  }
});

test("🔴 cobro SIN banco → RECHAZA, y no inventa 100001", () => {
  const r = construirAsientoDeCobro(cobro({ payment_account_code: null, banco_valido: false }));
  assert.equal(r.ok, false, "sin banco no hay asiento posible");
  if (r.ok) return;
  assert.equal(r.motivo, "sin_banco");
  // El mensaje explica POR QUÉ no se puede deducir, no solo que falta.
  assert.match(r.mensaje, /saldos de clientes/);
});

test("cobro con banco inválido (inactivo o no-activo) → RECHAZA nombrando la cuenta", () => {
  const r = construirAsientoDeCobro(cobro({ payment_account_code: "610001", banco_valido: false }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "banco_invalido");
  assert.match(r.mensaje, /610001/);
});

test("cobro de varias facturas: la descripción las nombra a todas", () => {
  const r = construirAsientoDeCobro(
    cobro({ facturas: ["FAC-HON-000001", "FAC-HON-000002"] })
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.match(r.asiento.description, /FAC-HON-000001/);
  assert.match(r.asiento.description, /FAC-HON-000002/);
  // UN asiento de DOS líneas por el total, no una línea de 100004 por factura:
  // 100004 es cuenta control y su auxiliar es por cliente; el detalle por
  // factura vive en payment_applications y en el PDF del recibo.
  assert.equal(r.asiento.lines.length, 2);
  assert.equal(r.asiento.lines[0].debit, 1070);
  assert.equal(r.asiento.lines[1].credit, 1070);
});

test("la referencia del asiento es el RECIBO (REC-), no la primera factura — también con una sola", () => {
  const una = construirAsientoDeCobro(cobro());
  const varias = construirAsientoDeCobro(cobro({ facturas: ["FAC-HON-000001", "FAC-HON-000002"] }));
  assert.equal(una.ok && una.asiento.reference, "REC-000004");
  assert.equal(varias.ok && varias.asiento.reference, "REC-000004");
  // Los cobros anteriores a la 047 (sin número) caen a la factura, como siempre.
  const viejo = construirAsientoDeCobro(cobro({ payment_number: null }));
  assert.equal(viejo.ok && viejo.asiento.reference, "FAC-HON-000001");
});

test("cobro con monto cero o negativo → RECHAZA", () => {
  for (const monto of [0, -5]) {
    const r = construirAsientoDeCobro(cobro({ amount: monto }));
    assert.equal(r.ok, false);
  }
});

// ---------------------------------------------------------------------------
// PAGO A PROVEEDOR
// ---------------------------------------------------------------------------

test("pago: DEBE 200001 / HABER el banco — espejo del cobro", () => {
  const r = construirAsientoDePagoProveedor(pago());
  assert.equal(r.ok, true);
  if (!r.ok) return;

  assert.deepEqual(
    r.asiento.lines.map((l) => [l.account_code, l.debit, l.credit]),
    [
      [CUENTA_POR_PAGAR, 321, 0],
      ["100001", 0, 321],
    ]
  );
});

test("🔴 pago SIN banco → RECHAZA", () => {
  const r = construirAsientoDePagoProveedor(
    pago({ payment_account_code: null, banco_valido: false })
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "sin_banco");
});

test("🔴 pago_proveedor es un source_type DISTINTO de pago", () => {
  assert.equal(SOURCE_TYPE_COBRO, "pago");
  assert.equal(SOURCE_TYPE_PAGO_PROVEEDOR, "pago_proveedor");
  assert.notEqual(
    SOURCE_TYPE_COBRO,
    SOURCE_TYPE_PAGO_PROVEEDOR,
    "unificarlos manda el enlace del Libro Mayor a /finanzas/facturas/<id-de-una-compra>"
  );
});

test("el source_id del pago es la COMPRA (no hay tabla de pagos a proveedor)", () => {
  const r = construirAsientoDePagoProveedor(pago());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.asiento.source_id, COMPRA_ID);
});

// ---------------------------------------------------------------------------
// El predicado del banco
// ---------------------------------------------------------------------------

test("una cuenta de banco tiene que ser un ACTIVO ACTIVO", () => {
  const base = { code: "100001", name: "Banco General Operativa" };
  assert.equal(esCuentaDeBancoValida({ ...base, account_type: "asset", active: true }), true);
  assert.equal(esCuentaDeBancoValida({ ...base, account_type: "asset", active: false }), false);
  assert.equal(esCuentaDeBancoValida({ ...base, account_type: "expense", active: true }), false);
  assert.equal(esCuentaDeBancoValida({ ...base, account_type: "income", active: true }), false);
  assert.equal(esCuentaDeBancoValida(null), false);
});

test("el guard NO se limita a los tres bancos conocidos por código", () => {
  // El bufete puede abrir una cuenta nueva; el plan de cuentas es el que manda.
  assert.equal(
    esCuentaDeBancoValida({
      code: "100009",
      name: "Banco Nuevo",
      account_type: "asset",
      active: true,
    }),
    true
  );
});

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------

test("las claves salen del id del documento y no se pisan entre sí", () => {
  assert.equal(claveIdempotenteDeCobro(COBRO_ID), `cobro:${COBRO_ID}`);
  assert.equal(claveIdempotenteDePagoProveedor(COMPRA_ID), `pago-proveedor:${COMPRA_ID}`);
  // Aunque el uuid fuera el mismo, los prefijos las separan.
  assert.notEqual(claveIdempotenteDeCobro(COBRO_ID), claveIdempotenteDePagoProveedor(COBRO_ID));
});

test("los dos asientos son deterministas", () => {
  assert.deepEqual(construirAsientoDeCobro(cobro()), construirAsientoDeCobro(cobro()));
  assert.deepEqual(
    construirAsientoDePagoProveedor(pago()),
    construirAsientoDePagoProveedor(pago())
  );
});
