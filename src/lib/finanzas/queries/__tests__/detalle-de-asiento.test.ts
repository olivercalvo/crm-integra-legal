/**
 * EL DETALLE DE UN ASIENTO (Bloque 7, commit 4 — D6).
 *
 *   1. Los DOS lados de la reversión: qué asiento reversa este, y qué asiento
 *      lo reversó a él. El segundo es el que evita reversar dos veces lo mismo.
 *   2. Los vecinos se leen en consultas aparte, NO con un embed por nombre de
 *      FK: un self-join de `journal_entries` da PGRST200 (pasó el 21/09 con la
 *      reversión del gasto de trámite).
 *   3. La pantalla es de admin y contador —cae en el prefijo
 *      `/finanzas/asientos`— y el enlace desde el Diario está gateado, porque
 *      ese reporte lo ve también la abogada.
 *   4. Se abre cualquier asiento; lo acotado a `manual` son las ACCIONES.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getAsientoDelLibro } from "@/lib/finanzas/queries/asiento-manual";
import { puedeAccederA } from "@/lib/auth/route-access";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const ID = "aaaaaaaa-1111-2222-3333-444444444444";

interface Mundo {
  cabecera: Record<string, unknown> | null;
  lineas: Record<string, unknown>[];
  /** Asientos por id, para el que ESTE reversa. */
  porId: Record<string, unknown>;
  /** El que reversa a ESTE, buscado por `reverses_entry_id`. */
  reversadoPor: Record<string, unknown> | null;
  consultas: string[];
}

function fakeDb(w: Mundo) {
  const tabla = (nombre: string) => {
    const filtros: [string, unknown][] = [];
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.order = () => resolver(nombre, filtros);
    q.eq = (c: string, v: unknown) => {
      filtros.push([c, v]);
      return q;
    };
    q.maybeSingle = async () => resolver(nombre, filtros);
    q.then = (res: (v: unknown) => unknown) => res(resolver(nombre, filtros));
    return q;
  };

  function resolver(nombre: string, filtros: [string, unknown][]) {
    const por = (c: string) => filtros.find(([k]) => k === c)?.[1];
    if (nombre === "journal_entry_lines") return { data: w.lineas, error: null };
    if (nombre === "journal_entries") {
      if (por("reverses_entry_id") !== undefined) {
        w.consultas.push("reversadoPor");
        return { data: w.reversadoPor, error: null };
      }
      const id = String(por("id"));
      if (id === ID) return { data: w.cabecera, error: null };
      w.consultas.push("reversa");
      return { data: w.porId[id] ?? null, error: null };
    }
    return { data: null, error: null };
  }

  return { from: (n: string) => tabla(n) };
}

function mundo(over: Partial<Mundo> = {}): Mundo {
  return {
    cabecera: {
      id: ID,
      entry_number: 50,
      transaction_date: "2026-09-22",
      record_date: "2026-09-22",
      description: "Ajuste con tercero",
      source_type: "manual",
      source_id: null,
      reference: null,
      reversal_reason: null,
      reverses_entry_id: null,
      created_at: "2026-09-22T12:00:00Z",
    },
    lineas: [
      {
        line_order: 1,
        debit: 12,
        credit: 0,
        line_description: "CxC",
        client_id: "c1",
        supplier_id: null,
        clients: { name: "Aníbal Serracín Concepción" },
        suppliers: null,
        chart_of_accounts: { code: "100004", name: "Cuentas por Cobrar Clientes" },
      },
      {
        line_order: 2,
        debit: 0,
        credit: 12,
        line_description: null,
        client_id: null,
        supplier_id: "s1",
        clients: null,
        suppliers: { legal_name: "CABLE ONDA S.A" },
        chart_of_accounts: { code: "200001", name: "Cuentas por pagar" },
      },
    ],
    porId: {},
    reversadoPor: null,
    consultas: [],
    ...over,
  };
}

test("el detalle trae líneas con su tercero, el total y el tipo", async () => {
  const w = mundo();
  const a = await getAsientoDelLibro(fakeDb(w) as never, TENANT, ID);
  assert.ok(a);
  assert.equal(a.entry_number, 50);
  assert.equal(a.total, 12);
  assert.equal(a.lineas[0].tercero, "Aníbal Serracín Concepción");
  assert.equal(a.lineas[0].terceroClave, "cliente:c1");
  assert.equal(a.lineas[1].tercero, "CABLE ONDA S.A");
  assert.equal(a.lineas[1].terceroClave, "proveedor:s1");
  assert.equal(a.reversa, null);
  assert.equal(a.reversadoPor, null);
});

test("🔴 D6: los DOS lados de la reversión", async () => {
  // Este asiento reversa al 43 y a su vez fue reversado por el 61.
  const w = mundo({
    cabecera: {
      ...mundo().cabecera,
      entry_number: 48,
      source_type: "reversion",
      reverses_entry_id: "otro-43",
      reversal_reason: "FND-011",
    },
    porId: { "otro-43": { id: "otro-43", entry_number: 43, transaction_date: "2026-09-22" } },
    reversadoPor: { id: "otro-61", entry_number: 61, transaction_date: "2026-09-25" },
  });

  const a = await getAsientoDelLibro(fakeDb(w) as never, TENANT, ID);
  assert.ok(a);
  assert.equal(a.reversa?.entry_number, 43, "a quién reversa");
  assert.equal(a.reversadoPor?.entry_number, 61, "quién lo reversó");
  assert.equal(a.reversal_reason, "FND-011");
});

test("un asiento sin `reverses_entry_id` no consulta el vecino que no existe", async () => {
  const w = mundo();
  await getAsientoDelLibro(fakeDb(w) as never, TENANT, ID);
  assert.ok(!w.consultas.includes("reversa"), "no se pregunta por un id nulo");
  assert.ok(w.consultas.includes("reversadoPor"), "pero sí si alguien lo reversó");
});

test("la pantalla es de admin y contador, y el enlace del Diario está gateado", () => {
  const ruta = `/finanzas/asientos/${ID}`;
  assert.equal(puedeAccederA("admin", ruta), true);
  assert.equal(puedeAccederA("contador", ruta), true);
  assert.equal(puedeAccederA("abogada", ruta), false, "la abogada no carga ni abre asientos");
  assert.equal(puedeAccederA("asistente", ruta), false);

  const page = readFileSync(join(process.cwd(), "src/app/finanzas/asientos/[id]/page.tsx"), "utf8");
  assert.match(page, /const ROLES = \["admin", "contador"\];/);
  assert.match(page, /redirect\("\/finanzas"\)/);

  // El Diario lo ve la abogada: el enlace al asiento va detrás de una bandera.
  const tabla = readFileSync(
    join(process.cwd(), "src/app/finanzas/reportes/diario/_components/diario-table.tsx"),
    "utf8"
  );
  assert.match(tabla, /puedeAbrirElAsiento \?/);
  const pagina = readFileSync(join(process.cwd(), "src/app/finanzas/reportes/diario/page.tsx"), "utf8");
  assert.match(pagina, /puedeAbrirElAsiento=\{ctx\.userRole === "admin" \|\| ctx\.userRole === "contador"\}/);
});

test("el detalle NO se limita a los asientos manuales: lo acotado son las acciones", async () => {
  const w = mundo({
    cabecera: { ...mundo().cabecera, source_type: "factura", source_id: "inv-1" },
  });
  const a = await getAsientoDelLibro(fakeDb(w) as never, TENANT, ID);
  assert.ok(a, "un asiento de factura también se abre");
  assert.equal(a.source_type, "factura");

  const page = readFileSync(join(process.cwd(), "src/app/finanzas/asientos/[id]/page.tsx"), "utf8");
  assert.match(page, /const esManual = asiento\.source_type === "manual";/);
  assert.match(page, /se corrige por el documento/);
});
