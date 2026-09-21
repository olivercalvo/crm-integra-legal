/**
 * 🔒 UN PAGO A PROVEEDOR TIENE DOS DESTINOS (049): una compra o un gasto de
 * trámite. Cada lectura de `supplier_payments` que embeba la compra tiene que
 * embeber también el gasto de trámite, y viceversa; si no, para el destino que
 * falta el join devuelve null y la pantalla, el asiento o el PDF muestran una
 * descripción vacía sin que nada falle.
 *
 * Es la regla que pidió Oliver al aprobar la opción (b) del diseño (21/09):
 * "el costo real es la rama en las lecturas, y ahí un test estructural que lea
 * los archivos buscando el join sin la rama evita que se olvide."
 *
 * Lee los archivos y falla si:
 *   · un `select` embebe `business_expenses!supplier_payments_business_expense_id_fkey`
 *     sin `expenses!supplier_payments_expense_id_fkey` en el mismo select (o al revés);
 *   · el tipo de fila sigue declarando `business_expense_id: string` (no nullable);
 *   · el validador o `createSupplierPayment` dejaron de conocer `expense_id`.
 *
 * Cuando se agregue una lectura nueva de `supplier_payments` con embed, se suma
 * a la lista ARCHIVOS.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateCreateSupplierPayment } from "@/lib/finanzas/validators/supplier-payment";
import { destinoDePago } from "@/lib/finanzas/types/supplier-payment";

const ROOT = process.cwd();
const leer = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const EMBED_COMPRA = "business_expenses!supplier_payments_business_expense_id_fkey";
const EMBED_TRAMITE = "expenses!supplier_payments_expense_id_fkey";

/** Archivos que leen `supplier_payments` con un embed al documento. */
const ARCHIVOS = [
  "src/lib/finanzas/queries/tesoreria-para-asiento.ts",
  "src/lib/finanzas/pdf/supplier-payment-pdf-data.ts",
];

/** Cada `.select(...)` del archivo, como texto. */
function selects(src: string): string[] {
  const out: string[] = [];
  const re = /\.select\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") depth -= 1;
      i += 1;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

for (const rel of ARCHIVOS) {
  test(`${rel}: cada select que embebe la compra embebe también el gasto de trámite`, () => {
    const src = leer(rel);
    const conEmbed = selects(src).filter((s) => s.includes(EMBED_COMPRA) || s.includes(EMBED_TRAMITE));
    assert.ok(conEmbed.length > 0, `${rel} ya no embebe el documento del pago: ¿se movió la lectura? Actualizar ARCHIVOS`);
    for (const s of conEmbed) {
      assert.ok(
        s.includes(EMBED_COMPRA) && s.includes(EMBED_TRAMITE),
        `\n🔒 ${rel} tiene un select con un solo destino del pago:\n${s.slice(0, 300)}\n` +
          `   Desde la 049 un pago es de una compra O de un gasto de trámite. Un select que solo\n` +
          `   embebe uno devuelve null para el otro y la descripción sale vacía sin que nada falle.\n`
      );
    }
  });
}

test("la fila de supplier_payments declara los dos destinos como nullable", () => {
  const src = leer("src/lib/finanzas/types/supplier-payment.ts");
  assert.match(src, /business_expense_id: string \| null;/);
  assert.match(src, /expense_id: string \| null;/);
  assert.doesNotMatch(src, /business_expense_id: string;/, "ya no es NOT NULL (049)");
});

test("las lecturas de la sección Pagos piden expense_id junto con business_expense_id", () => {
  const src = leer("src/lib/finanzas/queries/supplier-payments.ts");
  assert.match(src, /"id, business_expense_id, expense_id, kind,/);
  assert.match(src, /getSupplierPaymentsForTramite/);
});

test("el Mayor resuelve el pago a su compra O a su gasto de trámite", () => {
  const src = leer("src/lib/finanzas/reports/libro-mayor-source.ts");
  assert.match(src, /\.select\("id, business_expense_id, expense_id"\)/);
  assert.match(src, /RUTA_DEL_DOCUMENTO\.gasto_tramite\(row\.expense_id\)/);
});

test("createSupplierPayment ramifica por destino e inserta el arco exclusivo", () => {
  const src = leer("src/lib/finanzas/api/supplier-payments.ts");
  assert.match(src, /const destino = destinoDePago\(input\)/);
  assert.match(src, /business_expense_id: destino\.kind === "compra" \? destino\.id : null/);
  assert.match(src, /expense_id: destino\.kind === "tramite" \? destino\.id : null/);
  assert.match(src, /posted_entry_id/, "un gasto sin asiento no se paga: no hay cuenta por pagar en el libro");
});

test("el validador exige exactamente un destino", () => {
  const base = { payment_date: "2026-09-21", amount: 10, method: "transferencia", payment_account_code: "100001", reference: null, notes: null };
  const compra = "55555555-5555-5555-5555-555555555555";
  const tramite = "77777777-7777-7777-7777-777777777777";
  assert.ok(validateCreateSupplierPayment({ ...base, business_expense_id: compra, expense_id: null } as never).ok);
  assert.ok(validateCreateSupplierPayment({ ...base, business_expense_id: null, expense_id: tramite } as never).ok);
  const ninguno = validateCreateSupplierPayment({ ...base, business_expense_id: null, expense_id: null } as never);
  assert.equal(ninguno.ok, false);
  assert.ok(ninguno.errors?.destino);
  const ambos = validateCreateSupplierPayment({ ...base, business_expense_id: compra, expense_id: tramite } as never);
  assert.equal(ambos.ok, false);
  assert.ok(ambos.errors?.destino);
});

test("destinoDePago: uno de los dos, o explota (viola el arco)", () => {
  assert.deepEqual(destinoDePago({ business_expense_id: "c", expense_id: null }), { kind: "compra", id: "c" });
  assert.deepEqual(destinoDePago({ business_expense_id: null, expense_id: "t" }), { kind: "tramite", id: "t" });
  assert.throws(() => destinoDePago({ business_expense_id: null, expense_id: null }));
});

test("las dos rutas de pago ponen el destino desde el PATH y anulan el otro", () => {
  const compra = leer("src/app/api/finanzas/business-expenses/[id]/payments/route.ts");
  const tramite = leer("src/app/api/expenses/[id]/payments/route.ts");
  assert.match(compra, /business_expense_id: params\.id/);
  assert.match(tramite, /business_expense_id: null,\s*expense_id: params\.id/);
  const roles = (src: string) => src.match(/const MUTATING_ROLES = \[([^\]]+)\]/)?.[1].replace(/["\s]/g, "");
  assert.equal(roles(tramite), "admin,abogada,contador", "la unión de las dos entradas (a) y (b) de Oliver");
});
