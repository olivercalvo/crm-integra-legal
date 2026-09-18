/**
 * `emitInvoice` con el cableado contable puesto.
 *
 * Tres comportamientos, y los tres son de los que no se ven hasta que duelen:
 *
 *   1. **El asiento se postea ANTES del UPDATE a 'emitida'.** Si se invirtiera,
 *      un posteo fallido dejaría una factura emitida sin asiento — la
 *      divergencia silenciosa que todo esto existe para impedir.
 *   2. **Si el asiento no se puede armar, NO se emite.** Con el mensaje que
 *      nombra el servicio y la cuenta.
 *   3. 🔴 **Si el asiento YA existía (23505), la emisión SIGUE.** Es el reintento
 *      de una emisión que posteó pero no llegó al UPDATE. Tratarlo como error
 *      dejaría la factura en borrador para siempre, con su asiento ya en el
 *      libro y el UNIQUE impidiendo volver a intentarlo. Es exactamente el bug
 *      que apareció el 03/09 en la ruta de gastos: el código de Postgres viaja
 *      en `MutationError.detail`, NO en `cause`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { emitInvoice } from "@/lib/finanzas/api/invoices";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const INVOICE = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

interface Guion {
  /** Qué devuelve `post_journal_entry`. */
  postea: "ok" | { code: string; message: string };
  /** El servicio apunta a una cuenta activa. */
  cuentaActiva?: boolean;
}

interface Registro {
  orden: string[];
  update: Record<string, unknown> | null;
}

function fake(g: Guion) {
  const reg: Registro = { orden: [], update: null };

  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = self;
    q.in = self;
    q.order = () => resolver(nombre);
    q.maybeSingle = async () => resolver(nombre);
    q.update = (v: Record<string, unknown>) => {
      reg.orden.push("update:emitida");
      reg.update = v;
      return { eq: () => ({ eq: async () => ({ error: null }) }) };
    };
    // `.select("id", { count })` sin `.maybeSingle()` se resuelve como thenable.
    q.then = (res: (v: unknown) => unknown) => res(resolver(nombre));
    return q;
  };

  function resolver(nombre: string) {
    switch (nombre) {
      case "invoices":
        return {
          data: {
            id: INVOICE,
            invoice_kind: "HONORARIOS",
            status: "borrador",
            issue_date: "2026-09-04",
            grand_total: 1070,
            client: { name: "Cliente S.A." },
          },
          error: null,
          count: 1,
        };
      case "invoice_lines":
        return {
          data: [
            {
              line_order: 1,
              description: "Asesoría",
              subtotal: 1000,
              tax_amount: 70,
              service_id: "svc-1",
            },
          ],
          error: null,
          count: 1,
        };
      case "services_catalog":
        return {
          // `name` y `service_type` son NOT NULL en la tabla real; el gate
          // invoice_kind ↔ service_type de emitInvoice (18/09) los lee.
          data: [
            { id: "svc-1", code: "HON-COR", name: "Honorarios corporativos", service_type: "honorarios", revenue_account: "400001" },
          ],
          error: null,
        };
      case "chart_of_accounts":
        return {
          data: g.cuentaActiva === false ? [] : [{ code: "400001" }],
          error: null,
        };
      default:
        return { data: null, error: null };
    }
  }

  const db = {
    from: (n: string) => tabla(n),
    rpc: async (fn: string) => {
      if (fn === "get_next_sequence_number") {
        reg.orden.push("correlativo");
        return { data: 9, error: null };
      }
      if (fn === "post_journal_entry") {
        reg.orden.push("asiento");
        if (g.postea === "ok") return { data: "je-1", error: null };
        return { data: null, error: g.postea };
      }
      return { data: null, error: null };
    },
  };

  return { db, reg };
}

test("caso feliz: correlativo → asiento → emisión, en ese orden", async () => {
  const { db, reg } = fake({ postea: "ok" });
  const r = await emitInvoice(db as never, TENANT, INVOICE, db as never, USER);

  assert.equal(r.invoice_number, "FAC-HON-000009");
  assert.deepEqual(reg.orden, ["correlativo", "asiento", "update:emitida"]);
  assert.equal(reg.update?.status, "emitida");
  assert.equal(reg.update?.invoice_number, "FAC-HON-000009");
});

test("🔴 el asiento va ANTES de emitir, nunca después", async () => {
  const { db, reg } = fake({ postea: "ok" });
  await emitInvoice(db as never, TENANT, INVOICE, db as never, USER);
  assert.ok(
    reg.orden.indexOf("asiento") < reg.orden.indexOf("update:emitida"),
    "invertir el orden deja facturas emitidas sin asiento"
  );
});

test("cuenta inactiva: rechaza, NO emite, y el mensaje nombra servicio y cuenta", async () => {
  const { db, reg } = fake({ postea: "ok", cuentaActiva: false });

  await assert.rejects(
    () => emitInvoice(db as never, TENANT, INVOICE, db as never, USER),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 422);
      assert.match(e.message, /HON-COR/);
      assert.match(e.message, /400001/);
      return true;
    }
  );

  assert.equal(reg.update, null, "la factura NO se emitió");
  assert.ok(!reg.orden.includes("asiento"), "ni se intentó postear");
});

test("el posteo falla por otra causa: no se emite y el error sube", async () => {
  const { db, reg } = fake({
    postea: { code: "P0001", message: "El período 2026-09 está cerrado" },
  });

  await assert.rejects(
    () => emitInvoice(db as never, TENANT, INVOICE, db as never, USER),
    (e: Error) => {
      assert.match(e.message, /período/);
      return true;
    }
  );

  assert.equal(reg.update, null, "la factura queda en borrador");
});

test("🔴 23505: el asiento ya existía → la emisión SE COMPLETA igual", async () => {
  const { db, reg } = fake({
    postea: { code: "23505", message: "duplicate key value violates unique constraint" },
  });

  const r = await emitInvoice(db as never, TENANT, INVOICE, db as never, USER);

  assert.equal(r.invoice_number, "FAC-HON-000009");
  assert.equal(
    reg.update?.status,
    "emitida",
    "un reintento de una emisión que ya posteó tiene que poder terminar"
  );
});
