/**
 * EL GATE `invoice_kind` ↔ `service_type`, en `createInvoice` / `updateInvoice`.
 *
 * Tres facturas de producción (FAC-REI-000039, -042, -048; jul-ago/2026)
 * quedaron con líneas HON-COR dentro de una factura de REEMBOLSO. El hueco:
 * cambiar el "Tipo de documento" del encabezado después de cargar las líneas
 * no revalidaba nada — ni cliente ni servidor.
 *
 * Este archivo prueba que el SERVIDOR (no solo el picker del formulario)
 * rechaza el caso, en los dos sentidos, y que:
 *   - Rechaza ANTES de escribir nada (ni encabezado ni líneas).
 *   - La tasa/servicio la resuelve el SERVIDOR contra `services_catalog`,
 *     filtrado por tenant — no le cree al `service_id` que manda el body.
 *   - Una línea Personalizada (sin `service_id`) nunca bloquea.
 *   - El caso feliz (todo combina) sigue funcionando igual que antes.
 *
 * El módulo PURO que decide la regla se prueba aparte, sin fake-db, en
 * `validators/__tests__/invoice-kind-consistencia.test.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createInvoice, updateInvoice } from "@/lib/finanzas/api/invoices";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const INVOICE = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const CLIENT = "33333333-3333-3333-3333-333333333333";

/** Catálogo fake: HON-COR es de honorarios, REIM-JUD es de reembolso. */
const CATALOGO = [
  { id: "hon-cor", code: "HON-COR", name: "Honorarios corporativos", service_type: "honorarios" },
  { id: "reim-jud", code: "REIM-JUD", name: "Reembolso de gastos judiciales", service_type: "reembolso" },
];

interface Registro {
  insertados: string[];
  actualizados: string[];
  serviceIdsConsultados: string[] | null;
}

function fake() {
  const reg: Registro = { insertados: [], actualizados: [], serviceIdsConsultados: null };

  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = self;
    q.in = (col: string, vals: string[]) => {
      if (nombre === "services_catalog" && col === "id") reg.serviceIdsConsultados = vals;
      return q;
    };
    q.order = self;
    q.maybeSingle = async () => resolverUno(nombre);
    q.single = async () => resolverUno(nombre);
    q.insert = (payload: unknown) => {
      reg.insertados.push(nombre);
      const res = resolverUno(nombre);
      return {
        select: () => ({ single: async () => res }),
        then: (r: (v: unknown) => unknown) => r({ error: null, data: payload }),
      };
    };
    q.update = () => {
      reg.actualizados.push(nombre);
      return { eq: () => ({ eq: async () => ({ error: null }) }) };
    };
    q.delete = () => ({ eq: () => ({ in: async () => ({ error: null }) }) });
    q.then = (res: (v: unknown) => unknown) => res(resolver(nombre));
    return q;
  };

  function resolverUno(nombre: string) {
    const r = resolver(nombre) as { data: unknown; error: unknown };
    return Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r;
  }

  function resolver(nombre: string) {
    switch (nombre) {
      case "clients":
        return { data: { client_status: "active" }, error: null };
      case "invoices":
        return { data: { id: INVOICE }, error: null };
      case "invoice_lines":
        // Diff de updateInvoice: ninguna línea existente (todas se insertan).
        return { data: [], error: null };
      case "services_catalog":
        return { data: CATALOGO, error: null };
      default:
        return { data: null, error: null };
    }
  }

  const db = { from: (n: string) => tabla(n) };
  return { db, reg };
}

const BASE_HEADER = {
  client_id: CLIENT,
  case_id: null,
  issue_date: "2026-09-17",
  due_date: "2026-10-17",
  notes: null,
};

// ---------------------------------------------------------------------------
// El caso real de producción
// ---------------------------------------------------------------------------

test("🔴 HON-COR en una factura de REEMBOLSO: 400, nombra la línea, no inserta nada", async () => {
  const { db, reg } = fake();
  await assert.rejects(
    () =>
      createInvoice(db as never, TENANT, USER, {
        ...BASE_HEADER,
        invoice_kind: "REEMBOLSO",
        lines: [
          {
            service_id: "hon-cor",
            description: "Honorarios — cambio de junta directiva",
            quantity: 1,
            unit_price: 750,
            tax_code_id: "tc-7",
            tax_code: "ITBMS_7",
            tax_rate: 0.07,
          },
        ],
      }),
    (e: Error & { status?: number; fieldErrors?: Record<string, string> }) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /línea 1/i);
      assert.match(e.message, /HON-COR/);
      assert.ok(e.fieldErrors?.["lines.0.service"], "el campo de la línea queda marcado");
      return true;
    }
  );
  assert.deepEqual(reg.insertados, [], "no se insertó ni el encabezado ni las líneas");
});

test("el caso espejo: REIM-JUD en una factura de HONORARIOS también rechaza", async () => {
  const { db, reg } = fake();
  await assert.rejects(
    () =>
      createInvoice(db as never, TENANT, USER, {
        ...BASE_HEADER,
        invoice_kind: "HONORARIOS",
        lines: [
          {
            service_id: "reim-jud",
            description: "Reembolso de gastos judiciales",
            quantity: 1,
            unit_price: 150,
            tax_code_id: "tc-0",
            tax_code: "EXENTO",
            tax_rate: 0,
          },
        ],
      }),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /REIM-JUD/);
      return true;
    }
  );
  assert.deepEqual(reg.insertados, []);
});

// ---------------------------------------------------------------------------
// El hueco reportado: cambiar el kind DESPUÉS de tener líneas cargadas
// ---------------------------------------------------------------------------

test("🔴 updateInvoice: cambiar el kind del encabezado con una línea ya cargada que ya no combina", async () => {
  const { db, reg } = fake();
  await assert.rejects(
    () =>
      updateInvoice(db as never, TENANT, USER, INVOICE, {
        ...BASE_HEADER,
        invoice_kind: "REEMBOLSO", // la abogada cambió esto...
        lines: [
          {
            _key: "l1",
            id: "line-1", // ...pero esta línea (HON-COR) no se tocó
            service_id: "hon-cor",
            description: "Honorarios — cambio de junta directiva",
            quantity: 1,
            unit_price: 750,
            tax_code_id: "tc-7",
            tax_code: "ITBMS_7",
            tax_rate: 0.07,
          },
        ],
      }),
    (e: Error & { status?: number }) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /línea 1/i);
      return true;
    }
  );
  assert.deepEqual(reg.actualizados, [], "no se tocó el encabezado ni ninguna línea");
});

// ---------------------------------------------------------------------------
// Lo que NO debe bloquear
// ---------------------------------------------------------------------------

test("una línea Personalizada (sin service_id) nunca bloquea, en ninguna factura", async () => {
  const { db, reg } = fake();
  await createInvoice(db as never, TENANT, USER, {
    ...BASE_HEADER,
    invoice_kind: "REEMBOLSO",
    lines: [
      {
        service_id: null,
        description: "Gasto personalizado sin catálogo",
        quantity: 1,
        unit_price: 50,
        tax_code_id: "tc-0",
        tax_code: "EXENTO",
        tax_rate: 0,
      },
    ],
  });
  assert.ok(reg.insertados.includes("invoices"));
  assert.ok(reg.insertados.includes("invoice_lines"));
});

test("caso feliz: HON-COR en una factura de HONORARIOS se registra sin problema", async () => {
  const { db, reg } = fake();
  await createInvoice(db as never, TENANT, USER, {
    ...BASE_HEADER,
    invoice_kind: "HONORARIOS",
    lines: [
      {
        service_id: "hon-cor",
        description: "Honorarios — cambio de junta directiva",
        quantity: 1,
        unit_price: 750,
        tax_code_id: "tc-7",
        tax_code: "ITBMS_7",
        tax_rate: 0.07,
      },
    ],
  });
  assert.ok(reg.insertados.includes("invoices"));
  assert.ok(reg.insertados.includes("invoice_lines"));
});

// ---------------------------------------------------------------------------
// El servidor no le cree al service_id: lo resuelve, filtrado por tenant
// ---------------------------------------------------------------------------

test("resuelve el service_id contra la base filtrado por tenant, no acepta lo que diga el body", async () => {
  const { db, reg } = fake();
  await assert.rejects(() =>
    createInvoice(db as never, TENANT, USER, {
      ...BASE_HEADER,
      invoice_kind: "REEMBOLSO",
      lines: [
        {
          service_id: "hon-cor",
          description: "Honorarios — cambio de junta directiva",
          quantity: 1,
          unit_price: 750,
          tax_code_id: "tc-7",
          tax_code: "ITBMS_7",
          tax_rate: 0.07,
        },
      ],
    })
  );
  assert.deepEqual(reg.serviceIdsConsultados, ["hon-cor"]);
});
