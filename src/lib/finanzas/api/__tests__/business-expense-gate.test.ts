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
/** Los dos códigos del catálogo que el fake conoce (migración `045`). */
const ITBMS_7 = "44444444-4444-4444-4444-444444444444";
const EXENTO = "55555555-5555-5555-5555-555555555555";

interface Guion {
  /** ¿La compra ya tiene asiento? */
  tieneAsiento?: boolean;
  /** Qué devuelve `post_journal_entry`. */
  postea?: "ok" | { code: string; message: string };
  /** La cuenta de la línea es válida en el plan. */
  cuentaValida?: boolean;
  /** Qué códigos de impuesto devuelve `tax_codes` (activos del tenant). */
  taxCodes?: { id: string; code: string; rate: number }[];
}

function fake(g: Guion) {
  const reg = {
    borrados: [] as string[],
    insertados: [] as string[],
    posteos: 0,
    /** El último payload insertado en cada tabla, para afirmar qué se guardó. */
    payloads: {} as Record<string, unknown>,
  };

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
    q.insert = (payload: unknown) => {
      reg.insertados.push(nombre);
      reg.payloads[nombre] = payload;
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
      case "tax_codes":
        return {
          data: g.taxCodes ?? [
            { id: ITBMS_7, code: "ITBMS_7", rate: 0.07 },
            { id: EXENTO, code: "EXENTO", rate: 0 },
          ],
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
    supplier_invoice_number: null,
  lineas: [
    {
      description: "Útiles",
      chart_account_code: "610008",
      amount: 100,
      tax_code_id: ITBMS_7,
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

// ---------------------------------------------------------------------------
// El código de impuesto se resuelve contra el catálogo (migración `045`)
// ---------------------------------------------------------------------------

type LineaGuardada = { tax_code_id: string; tax_rate: number; tax_amount: number };

test("🔴 la tasa que se guarda es la del CATÁLOGO, aunque el body traiga otra", async () => {
  const { db, reg } = fake({ postea: "ok" });
  await createBusinessExpense(
    db as never,
    TENANT,
    USER,
    // El body dice 0 pero el id es el de ITBMS 7%: se le cree al id.
    { ...INPUT, lineas: [{ ...INPUT.lineas[0], tax_rate: 0, tax_amount: 7 }] },
    db as never
  );
  const lineas = reg.payloads["expense_lines"] as LineaGuardada[];
  assert.equal(lineas[0].tax_code_id, ITBMS_7);
  assert.equal(lineas[0].tax_rate, 0.07, "snapshot del catálogo, no del body");
});

test("🔴 un ITBMS que no calza con la tasa del código elegido se rechaza", async () => {
  const { db, reg } = fake({ postea: "ok" });
  await assert.rejects(
    () =>
      createBusinessExpense(
        db as never,
        TENANT,
        USER,
        // Eligió EXENTO pero tecleó 7,00 de ITBMS: la línea no puede decir las dos cosas.
        { ...INPUT, lineas: [{ ...INPUT.lineas[0], tax_code_id: EXENTO, tax_rate: 0, tax_amount: 7 }] },
        db as never
      ),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /EXENTO/);
      assert.match(e.message, /0\.00/);
      return true;
    }
  );
  assert.deepEqual(reg.insertados, [], "no se registró nada");
});

test("🔴 un código que no es de este bufete o está inactivo se rechaza antes de insertar", async () => {
  // El catálogo del tenant no conoce el id que manda el body.
  const { db, reg } = fake({ postea: "ok", taxCodes: [{ id: EXENTO, code: "EXENTO", rate: 0 }] });
  await assert.rejects(
    () => createBusinessExpense(db as never, TENANT, USER, INPUT, db as never),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /no existe o está inactivo/);
      return true;
    }
  );
  assert.deepEqual(reg.insertados, []);
  assert.equal(reg.posteos, 0);
});

test("compra mixta: cada línea conserva SU código y el encabezado suma los dos", async () => {
  const { db, reg } = fake({ postea: "ok" });
  await createBusinessExpense(
    db as never,
    TENANT,
    USER,
    {
      ...INPUT,
      lineas: [
        { description: "Internet de agosto", chart_account_code: "610008", amount: 25, tax_code_id: ITBMS_7, tax_rate: 0.07, tax_amount: 1.75 },
        { description: "Tasa municipal (exenta)", chart_account_code: "610008", amount: 10, tax_code_id: EXENTO, tax_rate: 0, tax_amount: 0 },
      ],
    },
    db as never
  );
  const lineas = reg.payloads["expense_lines"] as LineaGuardada[];
  assert.deepEqual(
    lineas.map((l) => [l.tax_code_id, l.tax_rate, l.tax_amount]),
    [[ITBMS_7, 0.07, 1.75], [EXENTO, 0, 0]]
  );
  const enc = reg.payloads["business_expenses"] as { subtotal: number; tax_amount: number; tax_rate: number };
  assert.equal(enc.subtotal, 35);
  assert.equal(enc.tax_amount, 1.75);
  assert.equal(enc.tax_rate, 0.07, "la tasa del encabezado es la más alta de las gravadas");
});
