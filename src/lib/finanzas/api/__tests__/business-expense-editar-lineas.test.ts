/**
 * 🔒 EDITAR UNA COMPRA GUARDA SUS LÍNEAS (bug del 07/10/2026).
 *
 * Hasta ese día `updateBusinessExpense` usaba las líneas del formulario sólo
 * para recalcular los totales del encabezado y nunca escribía `expense_lines`:
 * una cuenta cambiada en la pantalla se perdía sin aviso, y la compra se
 * contabilizaba después con la cuenta vieja. Este test falla si vuelve a pasar.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { updateBusinessExpense } from "@/lib/finanzas/api/business-expenses";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const COMPRA = "33333333-3333-3333-3333-333333333333";
const PROV = "66666666-6666-6666-6666-666666666666";
const ITBMS_7 = "44444444-4444-4444-4444-444444444444";
const EXENTO = "55555555-5555-5555-5555-555555555555";

type Op = { tabla: string; op: string; payload?: unknown; filtros: [string, string, unknown][] };

/** Una base falsa que anota cada operación y contesta lo mínimo. */
function fake(lineasActuales: { id: string; line_order: number }[]) {
  const ops: Op[] = [];
  const contestar = (o: Op): { data: unknown; error: null } => {
    if (o.op === "select" && o.tabla === "business_expenses") {
      return { data: { id: COMPRA, expense_date: "2026-07-05", supplier_id: PROV }, error: null };
    }
    if (o.op === "select" && o.tabla === "journal_entries") return { data: null, error: null };
    if (o.op === "select" && o.tabla === "suppliers") return { data: { id: PROV }, error: null };
    if (o.op === "select" && o.tabla === "tax_codes") {
      return { data: [{ id: ITBMS_7, code: "ITBMS7", rate: 0.07 }, { id: EXENTO, code: "EXENTO", rate: 0 }], error: null };
    }
    if (o.op === "select" && o.tabla === "expense_lines") return { data: lineasActuales, error: null };
    return { data: null, error: null };
  };
  const db = {
    from(tabla: string) {
      const o: Op = { tabla, op: "select", filtros: [] };
      const q: Record<string, unknown> = {};
      const yo = () => q;
      q.select = () => { if (o.op === "select") o.op = "select"; return q; };
      for (const f of ["eq", "in", "is", "neq"]) {
        q[f] = (col: string, val: unknown) => { o.filtros.push([f, col, val]); return q; };
      }
      q.order = yo;
      q.limit = yo;
      q.update = (payload: unknown) => { o.op = "update"; o.payload = payload; ops.push(o); return q; };
      q.delete = () => { o.op = "delete"; ops.push(o); return q; };
      q.insert = (payload: unknown) => { o.op = "insert"; o.payload = payload; ops.push(o); return q; };
      q.maybeSingle = async () => contestar(o);
      q.single = async () => contestar(o);
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(contestar(o)).then(ok, ko);
      return q;
    },
  };
  return { db: db as never, ops };
}

const input = (lineas: { description: string; chart_account_code: string; amount: number; tax_code_id: string; tax_amount: number }[]) =>
  ({
    expense_date: "2026-07-05",
    accounting_date: "2026-07-05",
    due_date: "2026-08-04",
    supplier_id: PROV,
    supplier_name: "Proveedor",
    supplier_ruc: null,
    supplier_invoice_number: "F-1",
    description: "Compra",
    payment_method: null,
    notes: null,
    lineas: lineas.map((l) => ({ ...l, tax_rate: 0 })),
  }) as never;

test("🔴 la cuenta cambiada de una línea se ESCRIBE en expense_lines", async () => {
  const { db, ops } = fake([{ id: "L1", line_order: 1 }]);
  await updateBusinessExpense(db, TENANT, COMPRA, "u", input([
    { description: "Papelería", chart_account_code: "600009", amount: 100, tax_code_id: ITBMS_7, tax_amount: 7 },
  ]));
  const escrita = ops.find((o) => o.tabla === "expense_lines" && o.op === "update");
  assert.ok(escrita, "la línea no se escribió: el cambio de cuenta se perdería");
  assert.equal((escrita!.payload as { chart_account_code: string }).chart_account_code, "600009");
  assert.ok(escrita!.filtros.some(([, c, v]) => c === "id" && v === "L1"));
  // La tasa es la del catálogo, no la del body (que venía en 0).
  assert.equal((escrita!.payload as { tax_rate: number }).tax_rate, 0.07);
});

test("una línea nueva se inserta y la que sobra se borra", async () => {
  const dos = fake([{ id: "L1", line_order: 1 }]);
  await updateBusinessExpense(dos.db, TENANT, COMPRA, "u", input([
    { description: "Papelería", chart_account_code: "600009", amount: 100, tax_code_id: ITBMS_7, tax_amount: 7 },
    { description: "Mensajería", chart_account_code: "600010", amount: 20, tax_code_id: EXENTO, tax_amount: 0 },
  ]));
  const nueva = dos.ops.find((o) => o.tabla === "expense_lines" && o.op === "insert");
  assert.ok(nueva);
  assert.equal((nueva!.payload as { chart_account_code: string; line_order: number }).chart_account_code, "600010");
  assert.equal((nueva!.payload as { business_expense_id: string }).business_expense_id, COMPRA);

  const una = fake([{ id: "L1", line_order: 1 }, { id: "L2", line_order: 2 }]);
  await updateBusinessExpense(una.db, TENANT, COMPRA, "u", input([
    { description: "Papelería", chart_account_code: "600009", amount: 100, tax_code_id: ITBMS_7, tax_amount: 7 },
  ]));
  const borrada = una.ops.find((o) => o.tabla === "expense_lines" && o.op === "delete");
  assert.ok(borrada);
  assert.ok(borrada!.filtros.some(([f, c, v]) => f === "in" && c === "id" && JSON.stringify(v) === '["L2"]'));
});
