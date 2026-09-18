/**
 * EL GATE `invoice_kind` ↔ `service_type` TAMBIÉN AL EMITIR (18/09/2026).
 *
 * `invoice-kind-gate.test.ts` prueba `createInvoice`/`updateInvoice`. Este
 * archivo prueba el hueco que quedaba: un borrador guardado ANTES de que
 * existiera la validación (o escrito por otro camino) llegaba a `emitInvoice`
 * sin que nadie lo mirara. Emitir es el último punto antes de que el documento
 * sea irreversible ante la DGI, y con el tipo 09 en el mapper una REI con una
 * línea de honorarios saldría rotulada como reembolso exento con ITBMS adentro.
 *
 * Lo que se prueba:
 *   - Rechaza en los dos sentidos, con el mensaje de SOP-029 y `fieldErrors`.
 *   - Rechaza ANTES de consumir el correlativo: `get_next_sequence_number` no
 *     se llama. Un rechazo no puede quemar un número.
 *   - Las líneas se RELEEN de la base (no llegan por parámetro), filtradas por
 *     tenant, y el catálogo también.
 *   - Usa la MISMA función que crear/editar: no hay una variante para emitir.
 *   - Una línea Personalizada (sin `service_id`) no bloquea.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { emitInvoice } from "@/lib/finanzas/api/invoices";
import { MutationError } from "@/lib/finanzas/api/errors";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const INVOICE = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

const CATALOGO = [
  { id: "hon-cor", code: "HON-COR", name: "Honorarios corporativos", service_type: "honorarios" },
  { id: "reim-jud", code: "REIM-JUD", name: "Reembolso de gastos judiciales", service_type: "reembolso" },
];

interface Guion {
  kind: "HONORARIOS" | "REEMBOLSO";
  lineas: { service_id: string | null; description: string; line_order: number }[];
}

function fake(g: Guion) {
  const reg = {
    rpcs: [] as string[],
    tenantFiltrado: { invoice_lines: false, services_catalog: false },
    lineasLeidas: false,
  };

  const tabla = (nombre: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = (col: string) => {
      if (col === "tenant_id" && (nombre === "invoice_lines" || nombre === "services_catalog")) {
        reg.tenantFiltrado[nombre] = true;
      }
      return q;
    };
    q.in = self;
    q.order = self;
    q.maybeSingle = async () => resolverUno(nombre);
    q.single = async () => resolverUno(nombre);
    q.update = () => ({ eq: () => ({ eq: async () => ({ error: null }) }) });
    q.then = (res: (v: unknown) => unknown) => res(resolver(nombre));
    return q;
  };

  function resolverUno(nombre: string) {
    const r = resolver(nombre) as { data: unknown; error: unknown };
    return Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r;
  }

  function resolver(nombre: string) {
    switch (nombre) {
      case "invoices":
        return { data: { id: INVOICE, invoice_kind: g.kind, status: "borrador" }, error: null };
      case "invoice_lines":
        reg.lineasLeidas = true;
        return { data: g.lineas, error: null };
      case "services_catalog":
        return { data: CATALOGO, error: null };
      default:
        return { data: null, error: null };
    }
  }

  const db = {
    from: (n: string) => tabla(n),
    rpc: async (fn: string) => {
      reg.rpcs.push(fn);
      // Si el gate deja pasar, el flujo sigue hacia el asiento; para estos tests
      // alcanza con que el correlativo NO se pida. Se corta acá con un error
      // reconocible para no simular todo el posteo.
      return { data: null, error: { message: "corte-de-test", code: "TEST" } };
    },
  };
  return { db, reg };
}

async function rechazo(p: Promise<unknown>): Promise<MutationError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof MutationError, `esperaba MutationError, llegó ${String(e)}`);
    return e;
  }
  assert.fail("debía rechazar");
}

test("🔴 borrador REEMBOLSO con una línea HON-COR: 400 al emitir, y NO consume correlativo", async () => {
  const { db, reg } = fake({
    kind: "REEMBOLSO",
    lineas: [
      { service_id: "reim-jud", description: "Tasa judicial", line_order: 0 },
      { service_id: "hon-cor", description: "Honorarios corporativos", line_order: 1 },
    ],
  });
  const e = await rechazo(emitInvoice(db as never, TENANT, INVOICE, db as never, USER));
  assert.equal(e.status, 400);
  assert.match(e.message, /línea 2 \(HON-COR · Honorarios corporativos\) es un servicio de Honorarios/);
  assert.match(e.message, /esta factura es de Reembolso/);
  assert.ok(e.fieldErrors?.["lines.1.service"], "marca la línea concreta");
  assert.deepEqual(reg.rpcs, [], "get_next_sequence_number NO se llamó: el rechazo no quema un número");
  assert.equal(reg.lineasLeidas, true, "las líneas se releen de la base");
  assert.equal(reg.tenantFiltrado.invoice_lines, true, "invoice_lines filtrado por tenant");
  assert.equal(reg.tenantFiltrado.services_catalog, true, "services_catalog filtrado por tenant");
});

test("el caso espejo: borrador HONORARIOS con una línea REIM-JUD también se rechaza", async () => {
  const { db, reg } = fake({
    kind: "HONORARIOS",
    lineas: [{ service_id: "reim-jud", description: "Tasa judicial", line_order: 0 }],
  });
  const e = await rechazo(emitInvoice(db as never, TENANT, INVOICE, db as never, USER));
  assert.equal(e.status, 400);
  assert.match(e.message, /línea 1 \(REIM-JUD · Reembolso de gastos judiciales\) es un servicio de Reembolso/);
  assert.deepEqual(reg.rpcs, []);
});

test("todo combina (o la línea es Personalizada): el gate deja pasar y recién ahí se pide el correlativo", async () => {
  const { db, reg } = fake({
    kind: "REEMBOLSO",
    lineas: [
      { service_id: "reim-jud", description: "Tasa judicial", line_order: 0 },
      { service_id: null, description: "Personalizada sin servicio", line_order: 1 },
    ],
  });
  const e = await rechazo(emitInvoice(db as never, TENANT, INVOICE, db as never, USER));
  // Llegó al RPC del correlativo (el fake lo corta a propósito): el gate no lo frenó.
  assert.deepEqual(reg.rpcs, ["get_next_sequence_number"]);
  assert.doesNotMatch(e.message, /solo puede llevar líneas/);
});

test("sin líneas sigue siendo el rechazo de siempre, antes del gate y del correlativo", async () => {
  const { db, reg } = fake({ kind: "REEMBOLSO", lineas: [] });
  const e = await rechazo(emitInvoice(db as never, TENANT, INVOICE, db as never, USER));
  assert.equal(e.status, 400);
  assert.match(e.message, /no tiene líneas/);
  assert.deepEqual(reg.rpcs, []);
});

test("emitir usa la MISMA función que crear/editar: validarLineasContraKind, no una variante", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/finanzas/api/invoices.ts"), "utf8");
  const emit = src.slice(src.indexOf("export async function emitInvoice("));
  const cuerpo = emit.slice(0, emit.indexOf("get_next_sequence_number"));
  assert.match(cuerpo, /await validarLineasContraKind\(/, "el gate está en emitInvoice, ANTES del correlativo");
  // Una sola definición del gate en el archivo, y una sola función pura detrás.
  assert.equal((src.match(/async function validarLineasContraKind\(/g) ?? []).length, 1);
  // Llamadas reales (asignación), no menciones en comentarios.
  assert.equal(
    (src.match(/= validarConsistenciaDeKind\(/g) ?? []).length,
    1,
    "validarConsistenciaDeKind se llama en un solo lugar del helper"
  );
});
