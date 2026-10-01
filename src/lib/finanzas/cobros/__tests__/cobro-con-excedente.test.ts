/**
 * 🔒 COBRO CON EXCEDENTE (Bloque 1, punto 5, migración 074).
 *
 *   1. El saldo a favor RESTA en la fila del cliente en la antigüedad (tramo
 *      corriente) y el total del auxiliar baja: así cuadra contra 100004, que
 *      el asiento del cobro acreditó por el total.
 *   2. La advertencia es UN texto, el mismo en las dos puertas.
 *   3. Aplicar el saldo a favor va por el RPC y NO postea (sin asiento).
 *   4. Lo aplicado de un cobro de una factura nunca pasa el saldo de esa factura.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildAntiguedad, type DocumentoPendiente } from "@/lib/finanzas/reports/antiguedad";
import { mensajeDeExcedente } from "@/lib/finanzas/cobros/repartir-por-antiguedad";

const RAIZ = path.resolve(__dirname, "../../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

const CONTROL = {
  saldoCuentaControl: 700,
  saldoApertura: 0,
  sinAsiento: { documentos: { cantidad: 0, monto: 0 }, cobros: { cantidad: 0, monto: 0 } },
  cuentaCodigo: "100004",
  cuentaNombre: "Cuentas por Cobrar Clientes",
};

test("el saldo a favor resta en la fila del cliente y el auxiliar cuadra con 100004", () => {
  const docs: DocumentoPendiente[] = [
    { id: "f1", numero: "FAC-HON-000030", tercero: "Cliente A", terceroId: "a", fechaReferencia: "2026-09-01",
      diasVencido: 45, saldo: 1000, sourceType: "factura" },
    { id: "p1", numero: "CO-000012 (saldo a favor)", tercero: "Cliente A", terceroId: "a", fechaReferencia: "2026-10-01",
      diasVencido: 0, saldo: -300, sourceType: "pago" },
  ];
  const a = buildAntiguedad(docs, CONTROL);
  assert.equal(a.filas.length, 1);
  assert.equal(a.filas[0].total, 700);
  assert.equal(a.filas[0].porTramo.corriente, -300, "el saldo a favor va al tramo corriente, en negativo");
  assert.equal(a.filas[0].porTramo.d31_60, 1000);
  assert.equal(a.control.cuadra, true);
});

test("un cliente sólo con saldo a favor queda en negativo", () => {
  const a = buildAntiguedad(
    [{ id: "p1", numero: "CO-000013 (saldo a favor)", tercero: "Cliente B", terceroId: "b", fechaReferencia: "2026-10-01",
       diasVencido: 0, saldo: -50, sourceType: "pago" }],
    { ...CONTROL, saldoCuentaControl: -50 }
  );
  assert.equal(a.filas[0].total, -50);
  assert.equal(a.control.cuadra, true);
});

test("la advertencia dice el monto, el cliente, 100004 y que se aplica a la próxima factura", () => {
  const m = mensajeDeExcedente(395, "FERRETERÍA VALLARINO, S.A.");
  assert.match(m, /B\/\. 395\.00/);
  assert.match(m, /saldo a favor de FERRETERÍA VALLARINO, S\.A\./);
  assert.match(m, /100004/);
  assert.match(m, /próxima factura/);
  assert.doesNotMatch(m, /—/, "sin guion largo en textos de usuario");
});

test("🔒 las dos puertas usan el MISMO texto y la ruta de una factura nunca aplica más que el saldo", () => {
  assert.match(leer("src/app/finanzas/facturas/_components/register-payment-dialog.tsx"), /mensajeDeExcedente\(/);
  assert.match(leer("src/app/finanzas/cobros/nuevo/_components/nuevo-cobro-form.tsx"), /mensajeDeExcedente\(/);
  assert.match(leer("src/app/api/finanzas/invoices/[id]/payments/route.ts"), /Math\.min\(monto,/);
});

test("🔒 aplicar el saldo a favor va por el RPC y no postea", () => {
  const api = leer("src/lib/finanzas/api/saldo-a-favor.ts");
  assert.match(api, /rpc\("apply_payment_credit"/);
  assert.doesNotMatch(api, /postJournalEntry\(/);
  // Oliver, 01/10/2026: también el contador. La ruta y la pantalla se mueven juntas.
  assert.match(leer("src/app/api/finanzas/payments/[id]/apply-credit/route.ts"), /\["admin", "abogada", "contador"\]/);
  assert.match(leer("src/app/finanzas/facturas/[id]/page.tsx"), /const canApplyCredit = puedeAccionar \|\| userRole === "contador"/);
});
