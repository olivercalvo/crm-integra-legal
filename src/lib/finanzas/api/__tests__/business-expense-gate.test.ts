/**
 * EL GATE CONTABLE DE COMPRAS, y el DELETE compensatorio.
 *
 * Dos reglas que no se ven hasta que hacen falta:
 *
 *   1. **Una compra que ya está en el libro no se edita ni se borra.** Mismo
 *      patrón que `cancelInvoice`. Hasta el 04/09/2026 este gate NO existía en
 *      compras y las tres sembradas en staging ya tenían asiento: el agujero
 *      estaba abierto, no era teórico.
 *   2. **Si el posteo falla, la compra no queda registrada.** No es "postear
 *      antes de registrar" —una compra nace registrada, y su id no existe hasta
 *      después del INSERT— sino registrar, postear, y deshacer con un DELETE
 *      compensatorio. Que el efecto sea el mismo no hace que la mecánica lo sea.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createBusinessExpense,
  updateBusinessExpense,
  deleteBusinessExpense,
} from "@/lib/finanzas/api/business-expenses";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const COMPRA = "33333333-3333-3333-3333-333333333333";
const USER = "22222222-2222-2222-2222-222222222222";

interface Guion {
  /** ¿La compra ya tiene asiento? */
  tieneAsiento?: boolean;
  /** Qué devuelve `post_journal_entry`. */
  postea?: "ok" | { code: string; message: string };
  /** La cuenta de la línea es válida en el plan. */
  cuentaValida?: boolean;
}

function fake(g: Guion) {
  const reg = { borrados: [] as string[], insertados: [] as string[], posteos: 0 };

  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = self;
    q.in = self;
    q.not = self;
    q.order = () => resolver(nombre);
    // ⚠️ `chart_of_accounts` se consulta con DOS intenciones distintas:
    //    `validarCuentaDeGasto` pide UNA fila (`maybeSingle`) y
    //    `cargarCompraParaAsiento` pide un ARRAY (`.in(...)`). Un fake que
    //    devuelve la misma forma para las dos hace que la segunda parezca "no
    //    encontrada" y el test falle por un motivo que no es el que prueba.
    q.maybeSingle = async () => resolverUno(nombre);
    // `.insert()` se usa de dos formas: encadenando `.select().single()` (la
    // compra, que necesita el id) y suelto (las líneas, el audit_log). El fake
    // devuelve un objeto que sirve para las dos.
    q.insert = () => {
      reg.insertados.push(nombre);
      const res = resolverUno(nombre);
      return {
        select: () => ({ single: async () => res }),
        then: (r: (v: unknown) => unknown) => r({ error: null }),
      };
    };
    q.delete = () => ({
      eq: () => ({
        eq: async () => {
          reg.borrados.push(nombre);
          return { error: null };
        },
      }),
    });
    q.update = () => ({ eq: () => ({ eq: async () => ({ error: null }) }) });
    q.single = async () => resolver(nombre);
    q.then = (res: (v: unknown) => unknown) => res(resolver(nombre));
    return q;
  };

  /** La variante de UNA fila. */
  function resolverUno(nombre: string) {
    const r = resolver(nombre) as { data: unknown; error: unknown };
    return Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r;
  }

  function resolver(nombre: string) {
    switch (nombre) {
      case "journal_entries":
        return { data: g.tieneAsiento ? { entry_number: 7 } : null, error: null };
      case "business_expenses":
        return {
          data: {
            id: COMPRA,
            total: 107,
            expense_date: "2026-09-04",
            description: "Insumos",
            supplier_name: "PROV",
            chart_account_code: null,
            status: "pendiente_pago",
          },
          error: null,
        };
      case "expense_lines":
        return {
          data: [
            {
              line_order: 1,
              description: "Útiles",
              amount: 100,
              tax_amount: 7,
              chart_account_code: "610008",
            },
          ],
          error: null,
        };
      case "chart_of_accounts":
        return {
          data:
            g.cuentaValida === false
              ? []
              : [{ code: "610008", active: true, account_type: "expense", name: "Útiles" }],
          error: null,
        };
      default:
        return { data: null, error: null };
    }
  }

  const db = {
    from: (n: string) => tabla(n),
    rpc: async (fn: string) => {
      if (fn === "post_journal_entry") {
        reg.posteos++;
        if (!g.postea || g.postea === "ok") return { data: "je-1", error: null };
        return { data: null, error: g.postea };
      }
      return { data: null, error: null };
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  };

  return { db, reg };
}

const INPUT = {
  expense_date: "2026-09-04",
  due_date: null,
  supplier_id: null,
  supplier_name: "PROV",
  supplier_ruc: null,
  lineas: [
    {
      description: "Útiles",
      chart_account_code: "610008",
      amount: 100,
      tax_rate: 0.07,
      tax_amount: 7,
    },
  ],
  description: "Insumos",
  subtotal: 100,
  tax_rate: 0.07,
  tax_amount: 7,
  status: "pendiente_pago" as const,
  payment_date: null,
  payment_method: null,
  notes: null,
};

// ---------------------------------------------------------------------------
// El gate
// ---------------------------------------------------------------------------

test("🔴 editar una compra CON asiento → 409, nombrando el asiento", async () => {
  const { db } = fake({ tieneAsiento: true });
  await assert.rejects(
    () => updateBusinessExpense(db as never, TENANT, COMPRA, USER, INPUT),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /asiento 7/);
      assert.match(e.message, /no se puede editar/);
      return true;
    }
  );
});

test("🔴 borrar una compra CON asiento → 409, y NO se toca el storage", async () => {
  const { db, reg } = fake({ tieneAsiento: true });
  await assert.rejects(
    () => deleteBusinessExpense(db as never, TENANT, COMPRA, USER),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /asiento 7/);
      return true;
    }
  );
  assert.deepEqual(reg.borrados, [], "no se borró nada, ni el comprobante");
});

test("borrar una compra SIN asiento sí procede", async () => {
  const { db, reg } = fake({ tieneAsiento: false });
  await deleteBusinessExpense(db as never, TENANT, COMPRA, USER);
  assert.ok(reg.borrados.includes("business_expenses"));
});

// ---------------------------------------------------------------------------
// El DELETE compensatorio
// ---------------------------------------------------------------------------

test("caso feliz: se registra, se postea, y NO se deshace nada", async () => {
  const { db, reg } = fake({ postea: "ok" });
  const r = await createBusinessExpense(db as never, TENANT, USER, INPUT, db as never);
  assert.equal(r.id, COMPRA);
  assert.equal(reg.posteos, 1);
  assert.deepEqual(reg.borrados, [], "no se deshizo el registro");
});

test("🔴 si el posteo falla, la compra se BORRA y el error sube", async () => {
  const { db, reg } = fake({
    postea: { code: "P0001", message: "El período 2026-09 está cerrado" },
  });

  await assert.rejects(
    () => createBusinessExpense(db as never, TENANT, USER, INPUT, db as never),
    (e: Error) => {
      assert.match(e.message, /período/);
      return true;
    }
  );

  assert.ok(
    reg.borrados.includes("business_expenses"),
    "la compra no puede quedar registrada sin asiento"
  );
});

test("🔴 si una línea apunta a una cuenta inválida, no se postea ni queda registrada", async () => {
  const { db, reg } = fake({ cuentaValida: false });

  await assert.rejects(
    () => createBusinessExpense(db as never, TENANT, USER, INPUT, db as never),
    (e: Error & { status?: number }) => {
      // 400 del guard por línea de `createBusinessExpense`, antes de insertar.
      assert.ok(e.status === 400 || e.status === 422);
      return true;
    }
  );
  assert.equal(reg.posteos, 0, "nunca se intentó postear");
});

test("una compra sin líneas se rechaza antes de tocar la base", async () => {
  const { db, reg } = fake({});
  await assert.rejects(
    () => createBusinessExpense(db as never, TENANT, USER, { ...INPUT, lineas: [] }, db as never),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /al menos una línea/);
      return true;
    }
  );
  assert.deepEqual(reg.insertados, []);
});

test("una línea sin cuenta se rechaza en el SERVIDOR, no solo en el formulario", async () => {
  const { db } = fake({});
  await assert.rejects(
    () =>
      createBusinessExpense(
        db as never,
        TENANT,
        USER,
        { ...INPUT, lineas: [{ ...INPUT.lineas[0], chart_account_code: null }] },
        db as never
      ),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /línea 1/);
      assert.match(e.message, /cuenta contable/);
      return true;
    }
  );
});
