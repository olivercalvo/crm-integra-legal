/**
 * FND-011 — EL ASIENTO NUNCA QUEDA CON UN NÚMERO QUE NO ES DE SU FACTURA.
 *
 * `emitInvoice` postea el asiento con el número (en `reference` y en la
 * descripción) y recién después lo escribe en la factura. Si ese UPDATE falla
 * por `invoices_tenant_number_unique` —la numeración quedó DETRÁS de las
 * facturas emitidas—, el asiento queda en un libro inmutable con el número de
 * OTRA factura. Pasó el 22/09/2026 en staging: asiento 43, `FAC-HON-000007`,
 * sobre un borrador.
 *
 * Los dos cierres, probados acá:
 *
 *   1. **Guard antes de postear.** Si el número ya es de otra factura, 409 y no
 *      se postea NADA. El hueco en la secuencia se acepta; el asiento con
 *      número ajeno no.
 *   2. **El reintento toma el número DEL ASIENTO**, no uno nuevo. Se apoya en
 *      el UNIQUE `journal_entries_un_asiento_por_documento` de la `034`.
 *
 * El test del medio es el que pedía el bug: fuerza el 23505 en el UPDATE
 * DESPUÉS del posteo y verifica la invariante sobre el mundo entero — ningún
 * asiento con un número que no le corresponda a su factura.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { emitInvoice } from "@/lib/finanzas/api/invoices";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const BORRADOR = "11111111-1111-1111-1111-111111111111";
const OTRA = "99999999-9999-9999-9999-999999999999";
const USER = "22222222-2222-2222-2222-222222222222";

interface Mundo {
  /** Facturas por número: el UNIQUE (tenant, invoice_number). */
  numeros: Map<string, string>;
  /** El asiento `factura` del borrador, si ya está en el libro. */
  asiento: { entry_number: number; reference: string | null } | null;
  /** Lo que la secuencia va a devolver en la próxima llamada. */
  proximoNumero: number;
  /** El UPDATE final falla con el UNIQUE (la carrera que FND-011 describe). */
  updateChoca?: boolean;
  // — registro —
  orden: string[];
  posteado: { reference: string | null; description: string } | null;
  emitidaComo: string | null;
}

function fake(w: Mundo) {
  const tabla = (nombre: string) => {
    const filtros: [string, unknown][] = [];
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.in = self;
    q.eq = (col: string, val: unknown) => {
      filtros.push([col, val]);
      return q;
    };
    q.order = () => resolver(nombre, filtros);
    q.maybeSingle = async () => resolver(nombre, filtros);
    q.update = (v: Record<string, unknown>) => {
      w.orden.push("update:emitida");
      if (w.updateChoca) {
        return {
          eq: () => ({
            eq: async () => ({
              error: {
                code: "23505",
                message: 'duplicate key value violates unique constraint "invoices_tenant_number_unique"',
              },
            }),
          }),
        };
      }
      w.emitidaComo = String(v.invoice_number);
      w.numeros.set(String(v.invoice_number), BORRADOR);
      return { eq: () => ({ eq: async () => ({ error: null }) }) };
    };
    q.then = (res: (v: unknown) => unknown) => res(resolver(nombre, filtros));
    return q;
  };

  function resolver(nombre: string, filtros: [string, unknown][]) {
    const por = (col: string) => filtros.find(([c]) => c === col)?.[1];
    switch (nombre) {
      case "invoices": {
        // El guard de FND-011 busca por NÚMERO; el resto, por id.
        const numero = por("invoice_number");
        if (numero !== undefined) {
          w.orden.push("guard:numero-libre");
          const duenio = w.numeros.get(String(numero));
          return { data: duenio ? { id: duenio } : null, error: null, count: 0 };
        }
        return {
          data: {
            id: BORRADOR,
            invoice_kind: "HONORARIOS",
            status: "borrador",
            issue_date: "2026-09-22",
            grand_total: 1070,
            client: { name: "Cliente S.A." },
          },
          error: null,
          count: 1,
        };
      }
      case "journal_entries":
        w.orden.push("busca:asiento-previo");
        return { data: w.asiento, error: null };
      case "invoice_lines":
        return {
          data: [
            { line_order: 1, description: "Asesoría", subtotal: 1000, tax_amount: 70, service_id: "svc-1" },
          ],
          error: null,
          count: 1,
        };
      case "services_catalog":
        return {
          data: [
            { id: "svc-1", code: "HON-COR", name: "Honorarios corporativos", service_type: "honorarios", revenue_account: "400001" },
          ],
          error: null,
        };
      case "chart_of_accounts":
        return { data: [{ code: "400001" }], error: null };
      default:
        return { data: null, error: null };
    }
  }

  const db = {
    from: (n: string) => tabla(n),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "get_next_sequence_number") {
        w.orden.push("correlativo");
        return { data: w.proximoNumero++, error: null };
      }
      if (fn === "post_journal_entry") {
        w.orden.push("asiento");
        // El libro guarda lo que se posteó, con su referencia.
        w.posteado = {
          reference: (args.p_reference as string | null) ?? null,
          description: String(args.p_description ?? ""),
        };
        w.asiento = { entry_number: 43, reference: w.posteado.reference };
        return { data: "je-1", error: null };
      }
      return { data: null, error: null };
    },
  };
  return db;
}

function mundo(over: Partial<Mundo> = {}): Mundo {
  return {
    numeros: new Map<string, string>(),
    asiento: null,
    proximoNumero: 7,
    orden: [],
    posteado: null,
    emitidaComo: null,
    ...over,
  };
}

/** La invariante: si hay asiento, su número es el de SU factura. */
function asientoYFacturaDicenLoMismo(w: Mundo): boolean {
  if (!w.asiento?.reference) return true;
  const duenio = w.numeros.get(w.asiento.reference);
  // O la factura del asiento es la nuestra, o ese número no se usó todavía.
  return duenio === undefined || duenio === BORRADOR;
}

test("🔴 el guard: si el número de la secuencia ya es de otra factura, 409 y NO se postea nada", async () => {
  const w = mundo({ numeros: new Map([["FAC-HON-000007", OTRA]]), proximoNumero: 7 });
  const db = fake(w);

  await assert.rejects(
    () => emitInvoice(db as never, TENANT, BORRADOR, db as never, USER),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /FAC-HON-000007 ya pertenece a otra factura/);
      assert.match(e.message, /no se registró ningún asiento/);
      return true;
    }
  );

  assert.equal(w.posteado, null, "el libro no se tocó");
  assert.equal(w.emitidaComo, null, "la factura sigue en borrador");
  assert.ok(w.orden.indexOf("guard:numero-libre") < (w.orden.includes("asiento") ? 0 : Infinity));
  assert.ok(asientoYFacturaDicenLoMismo(w));
});

test("🔴 el UPDATE falla DESPUÉS del posteo (la carrera): el reintento se emite con el número DEL ASIENTO, no con uno nuevo", async () => {
  // El número 7 está libre cuando se postea y lo toma otra factura entremedio.
  const w = mundo({ proximoNumero: 7, updateChoca: true });
  const db = fake(w);

  await assert.rejects(() => emitInvoice(db as never, TENANT, BORRADOR, db as never, USER));
  assert.equal(w.posteado?.reference, "FAC-HON-000007", "el asiento quedó en el libro");
  assert.equal(w.emitidaComo, null, "la factura NO se emitió");

  // El reintento. Sin el arreglo pediría el 8 y el asiento seguiría diciendo 7.
  w.updateChoca = false;
  w.orden = [];
  const r = await emitInvoice(db as never, TENANT, BORRADOR, db as never, USER);

  assert.equal(r.invoice_number, "FAC-HON-000007");
  assert.equal(w.emitidaComo, "FAC-HON-000007");
  assert.ok(!w.orden.includes("correlativo"), "el reintento NO consume otro número");
  assert.ok(!w.orden.includes("asiento"), "ni vuelve a postear: el asiento ya está");
  assert.equal(w.proximoNumero, 8, "la secuencia quedó donde la dejó el primer intento");
  assert.ok(asientoYFacturaDicenLoMismo(w), "ningún asiento con un número ajeno");
});

test("🔴 el reintento cuyo número ya se lo llevó otra factura no emite: 409 que nombra el asiento", async () => {
  const w = mundo({
    asiento: { entry_number: 43, reference: "FAC-HON-000007" },
    numeros: new Map([["FAC-HON-000007", OTRA]]),
  });
  const db = fake(w);

  await assert.rejects(
    () => emitInvoice(db as never, TENANT, BORRADOR, db as never, USER),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /asiento 43 con el número FAC-HON-000007/);
      assert.match(e.message, /avisale a Oliver/i);
      return true;
    }
  );
  assert.equal(w.emitidaComo, null);
  assert.ok(!w.orden.includes("correlativo"), "tampoco quema un número");
});

test("un asiento sin `reference` (anterior a la 039) detiene la emisión en vez de inventar un número", async () => {
  const w = mundo({ asiento: { entry_number: 9, reference: null } });
  const db = fake(w);

  await assert.rejects(
    () => emitInvoice(db as never, TENANT, BORRADOR, db as never, USER),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /asiento 9/);
      assert.match(e.message, /no registra con qué número se posteó/);
      return true;
    }
  );
  assert.equal(w.emitidaComo, null);
});

test("el camino normal sigue igual: correlativo → guard → asiento → emisión", async () => {
  const w = mundo({ proximoNumero: 12 });
  const db = fake(w);

  const r = await emitInvoice(db as never, TENANT, BORRADOR, db as never, USER);

  assert.equal(r.invoice_number, "FAC-HON-000012");
  assert.deepEqual(
    w.orden.filter((o) => o !== "busca:asiento-previo"),
    ["correlativo", "guard:numero-libre", "asiento", "update:emitida"]
  );
  assert.equal(w.posteado?.reference, "FAC-HON-000012");
  assert.ok(asientoYFacturaDicenLoMismo(w));
});
