/**
 * Tests del endpoint de carga masiva del Plan de Cuentas (Paso 1b).
 *
 * Construye un .xlsx REAL en memoria con SheetJS y lo postea al handler, con un
 * fake de Supabase. Así se ejercita la cadena completa
 * (formData → XLSX.read → parser puro → clasificación → escritura + audit).
 *
 * Ejecución (requiere el flag experimental para mock.module):
 *   npx tsx --test --experimental-test-module-mocks \
 *     src/app/api/finanzas/configuracion/chart-of-accounts/bulk/__tests__/bulk.route.test.ts
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import type { NextRequest } from "next/server";

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

// ---------------------------------------------------------------------------
// Fake de Supabase
// ---------------------------------------------------------------------------

interface ExistingRow {
  id: string;
  code: string;
  name: string;
  account_type: string;
  subcategoria: string | null;
  saldo_inicial: number;
  description: string | null;
  active: boolean;
  is_system: boolean;
}

const state: {
  profile: { full_name: string; role: string; tenant_id: string };
  /** Cuentas que "ya existen" en la BD, por código. */
  existing: ExistingRow[];
  captured: {
    inserts: Record<string, unknown>[];
    updates: { id: string; payload: Record<string, unknown> }[];
    audit: Record<string, unknown>[];
  };
} = {
  profile: { full_name: "Tester", role: "admin", tenant_id: "t1" },
  existing: [],
  captured: { inserts: [], updates: [], audit: [] },
};

function reset() {
  state.profile = { full_name: "Tester", role: "admin", tenant_id: "t1" };
  state.existing = [];
  state.captured = { inserts: [], updates: [], audit: [] };
}

function makeAdmin() {
  function builder(table: string) {
    const s: {
      op: "insert" | "update" | null;
      payload: Record<string, unknown> | null;
      selectCols: string;
      inCodes: string[] | null;
      eqFilters: Record<string, unknown>;
    } = { op: null, payload: null, selectCols: "", inCodes: null, eqFilters: {} };

    const resolve = () => {
      if (table === "users") return { data: state.profile, error: null };

      if (table === "audit_log") {
        if (s.payload) state.captured.audit.push(s.payload);
        return { data: {}, error: null };
      }

      if (table === "chart_of_accounts") {
        if (s.op === "insert") {
          state.captured.inserts.push(s.payload!);
          return {
            data: { id: `new-${state.captured.inserts.length}`, is_system: false, ...s.payload },
            error: null,
          };
        }
        if (s.op === "update") {
          const id = String(s.eqFilters.id ?? "");
          state.captured.updates.push({ id, payload: s.payload! });
          const row = state.existing.find((e) => e.id === id);
          return { data: { ...(row ?? {}), ...s.payload, id }, error: null };
        }

        // findChartAccountsByCodes: SELECT ... .in("code", [...])
        if (s.inCodes) {
          const rows = state.existing.filter((e) => s.inCodes!.includes(e.code));
          return { data: rows, error: null };
        }

        // Fetch de existencia del UPDATE (incluye "name" en las columnas).
        if (s.selectCols.includes("name")) {
          const id = String(s.eqFilters.id ?? "");
          return { data: state.existing.find((e) => e.id === id) ?? null, error: null };
        }

        // findChartAccountByCode (guard de unicidad del CREATE).
        const code = String(s.eqFilters.code ?? "");
        return { data: state.existing.find((e) => e.code === code) ?? null, error: null };
      }

      return { data: {}, error: null };
    };

    const b: Record<string, unknown> = {
      select: (cols?: string) => {
        s.selectCols = String(cols ?? "");
        return b;
      },
      eq: (col: string, val: unknown) => {
        s.eqFilters[col] = val;
        return b;
      },
      in: (_col: string, vals: string[]) => {
        s.inCodes = vals;
        return b;
      },
      insert: (payload: Record<string, unknown>) => {
        s.op = "insert";
        s.payload = payload;
        return b;
      },
      update: (payload: Record<string, unknown>) => {
        s.op = "update";
        s.payload = payload;
        return b;
      },
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onOk, onErr),
    };
    return b;
  }
  return { from: (t: string) => builder(t) };
}

if (MOCKS_ENABLED) {
  mock.module("@/lib/supabase/server", {
    namedExports: {
      createClient: () => ({
        auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
      }),
    },
  });
  mock.module("@/lib/supabase/admin", {
    namedExports: { createAdminClient: () => makeAdmin() },
  });
}

let POST: (req: NextRequest) => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ POST } = (await import(
    "@/app/api/finanzas/configuracion/chart-of-accounts/bulk/route"
  )) as unknown as { POST: typeof POST });
});

// ---------------------------------------------------------------------------
// Helpers de request
// ---------------------------------------------------------------------------

/** Arma un .xlsx real en memoria a partir de una matriz de celdas. */
function xlsxBuffer(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Cuentas");
  return Buffer.from(XLSX.write(wb, { bookType: "xlsx", type: "buffer" }));
}

function req(buffer: Buffer, mode: "preview" | "commit"): NextRequest {
  const file = {
    size: buffer.length,
    arrayBuffer: async () => buffer,
  };
  const form = new Map<string, unknown>([
    ["file", file],
    ["mode", mode],
  ]);
  return { formData: async () => form } as unknown as NextRequest;
}

const HEADER = ["Código", "Nombre", "Tipo", "Subcategoría", "Saldo inicial"];

/** 5 cuentas, con un Costo y un Gasto para ejercitar el mapeo de subcategoría. */
const FIVE_ROWS: unknown[][] = [
  HEADER,
  ["100001", "Caja general", "Activo", "Activo corriente", 2500],
  ["300001", "Capital pagado", "Patrimonio", "Patrimonio", -15000],
  // La subcategoria va con el vocabulario NIIF 18 (migracion 025). "Ingreso" a
  // secas era el nombre viejo y hoy no clasifica.
  ["400001", "Derecho Corporativo", "Ingreso", "Ingresos Operativos", 0],
  ["500001", "Honorarios de abogados externos", "Costo", "", 0],
  ["600001", "Alquiler de oficina", "Gasto", "", 1200.5],
];

// ---------------------------------------------------------------------------
// PREVIEW
// ---------------------------------------------------------------------------

test("preview: clasifica 5 cuentas nuevas y NO escribe nada", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req(xlsxBuffer(FIVE_ROWS), "preview"));
  const json = (await res.json()) as {
    preview: {
      counts: { create: number; update: number; error: number };
      rows: Array<{ code: string; account_type: string; subcategoria: string | null; saldo_inicial: number }>;
    };
  };

  assert.equal(res.status, 200);
  assert.deepEqual(json.preview.counts, { create: 5, update: 0, error: 0 });

  // El mapeo Costo/Gasto → tipos DISTINTOS (cost / expense), cada uno con su
  // subcategoria operativa por defecto.
  const costo = json.preview.rows.find((r) => r.code === "500001");
  const gasto = json.preview.rows.find((r) => r.code === "600001");
  // Desde la migracion 025 el costo tiene TIPO propio, no es un expense con
  // subcategoria distinta. Es el sexto tipo de cuenta que pidio RM.
  assert.equal(costo?.account_type, "cost");
  assert.equal(costo?.subcategoria, "costos_operativos");
  assert.equal(gasto?.account_type, "expense");
  assert.equal(gasto?.subcategoria, "gastos_operativos");
  assert.equal(gasto?.saldo_inicial, 1200.5);

  // Negativo preservado.
  assert.equal(json.preview.rows.find((r) => r.code === "300001")?.saldo_inicial, -15000);

  // Lo esencial del preview: cero escrituras.
  assert.equal(state.captured.inserts.length, 0, "preview no debe insertar");
  assert.equal(state.captured.updates.length, 0, "preview no debe actualizar");
  assert.equal(state.captured.audit.length, 0, "preview no debe auditar");
});

test(
  "preview: un código existente se marca update, no create",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.existing = [
      {
        id: "acc-caja",
        code: "100001",
        name: "Caja (nombre viejo)",
        account_type: "asset",
        subcategoria: null,
        saldo_inicial: 0,
        description: "nota previa",
        active: true,
        is_system: false,
      },
    ];
    const res = await POST(req(xlsxBuffer(FIVE_ROWS), "preview"));
    const json = (await res.json()) as {
      preview: { counts: { create: number; update: number }; rows: Array<{ code: string; action: string }> };
    };
    assert.equal(res.status, 200);
    assert.equal(json.preview.counts.update, 1);
    assert.equal(json.preview.counts.create, 4);
    assert.equal(json.preview.rows.find((r) => r.code === "100001")?.action, "update");
  }
);

// ---------------------------------------------------------------------------
// COMMIT
// ---------------------------------------------------------------------------

test("commit: crea las 5 cuentas con is_system=false y audita cada una", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req(xlsxBuffer(FIVE_ROWS), "commit"));
  const json = (await res.json()) as {
    summary: { created: number; updated: number; failed: number };
  };

  assert.equal(res.status, 200);
  assert.deepEqual(json.summary.created, 5);
  assert.equal(json.summary.updated, 0);
  assert.equal(json.summary.failed, 0);

  assert.equal(state.captured.inserts.length, 5);
  for (const ins of state.captured.inserts) {
    assert.equal(ins.is_system, false, "las cuentas importadas nunca son del sistema");
    assert.equal(ins.active, true);
    assert.equal(ins.tenant_id, "t1");
  }

  const gasto = state.captured.inserts.find((i) => i.code === "600001");
  assert.equal(gasto?.subcategoria, "gastos_operativos");
  assert.equal(gasto?.saldo_inicial, 1200.5);

  // Una entrada de audit_log por cuenta creada.
  assert.equal(state.captured.audit.length, 5);
  const audited = JSON.parse(String(state.captured.audit[0].new_value)) as Record<string, unknown>;
  assert.ok("subcategoria" in audited && "saldo_inicial" in audited);
});

test(
  "commit: al actualizar PRESERVA description y active (el PATCH es reemplazo total)",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.existing = [
      {
        id: "acc-caja",
        code: "100001",
        name: "Caja (nombre viejo)",
        account_type: "asset",
        subcategoria: null,
        saldo_inicial: 0,
        // Estos dos NO vienen en el Excel y no se deben perder:
        description: "nota que el contador escribió a mano",
        active: false,
        is_system: false,
      },
    ];

    const res = await POST(req(xlsxBuffer(FIVE_ROWS), "commit"));
    const json = (await res.json()) as { summary: { created: number; updated: number } };
    assert.equal(res.status, 200);
    assert.equal(json.summary.updated, 1);
    assert.equal(json.summary.created, 4);

    const upd = state.captured.updates.find((u) => u.id === "acc-caja");
    assert.ok(upd, "debe haber un update de la cuenta existente");
    // Se aplica lo del Excel...
    assert.equal(upd.payload.name, "Caja general");
    assert.equal(upd.payload.subcategoria, "activo_corriente");
    assert.equal(upd.payload.saldo_inicial, 2500);
    // ...y se preserva lo que el Excel no trae.
    assert.equal(
      upd.payload.description,
      "nota que el contador escribió a mano",
      "el import no debe borrar la descripción"
    );
    assert.equal(upd.payload.active, false, "el import no debe reactivar una cuenta desactivada");
  }
);

test(
  "commit: fila con tipo inválido queda en error y NO aborta el resto",
  { skip: skipNoMocks },
  async () => {
    reset();
    const res = await POST(
      req(
        xlsxBuffer([
          HEADER,
          ["100001", "Caja general", "Activo", "Activo corriente", 100],
          ["700001", "Cuenta rara", "Cuenta de orden", "", 0], // tipo inválido
          ["600001", "Alquiler", "Gasto", "", 50],
        ]),
        "commit"
      )
    );

    const json = (await res.json()) as {
      summary: { created: number; failed: number };
      outcomes: Array<{ code: string; action: string; message?: string }>;
    };

    assert.equal(res.status, 200);
    assert.equal(json.summary.created, 2, "las 2 válidas se crean");
    assert.equal(json.summary.failed, 1);
    const bad = json.outcomes.find((o) => o.code === "700001");
    assert.equal(bad?.action, "error");
    assert.match(String(bad?.message), /Tipo de cuenta no reconocido/);
    assert.equal(state.captured.inserts.length, 2, "la fila inválida no se inserta");
  }
);

test("commit: código repetido en el archivo se escribe UNA sola vez", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(
    req(
      xlsxBuffer([
        HEADER,
        ["100001", "Caja", "Activo", "Activo corriente", 100],
        ["100001", "Caja duplicada", "Activo", "Activo corriente", 999],
      ]),
      "commit"
    )
  );
  const json = (await res.json()) as { summary: { created: number; failed: number } };
  assert.equal(json.summary.created, 1);
  assert.equal(json.summary.failed, 1);
  assert.equal(state.captured.inserts.length, 1);
  assert.equal(state.captured.inserts[0].saldo_inicial, 100, "gana la primera fila");
});

// ---------------------------------------------------------------------------
// Formato de Josuar + errores de archivo + permisos
// ---------------------------------------------------------------------------

test(
  "lee el balance de comprobación de Josuar (títulos arriba, columnas extra)",
  { skip: skipNoMocks },
  async () => {
    reset();
    const res = await POST(
      req(
        xlsxBuffer([
          ["INTEGRA LEGAL, S.A."],
          ["Balance de comprobación"],
          ["Al 31 de diciembre de 2025"],
          [],
          ["Código", "Nombre de cuenta", "Tipo de Cuenta", "Balance Inicial", "Débito", "Crédito", "Saldo final"],
          ["100001", "Caja general", "Activo", 2500, 100, 50, 2550],
          ["600001", "Alquiler de oficina", "Gastos", 1200, 0, 0, 1200],
          [null, "TOTALES", null, 3700, 100, 50, 3750],
        ]),
        "preview"
      )
    );
    const json = (await res.json()) as {
      preview: {
        counts: { create: number; error: number };
        skippedRows: number;
        hasSubcategoriaColumn: boolean;
        rows: Array<{ code: string; saldo_inicial: number; subcategoria: string | null }>;
      };
    };

    assert.equal(res.status, 200);
    assert.equal(json.preview.counts.create, 2);
    assert.equal(json.preview.counts.error, 0);
    assert.equal(json.preview.hasSubcategoriaColumn, false);
    assert.ok(json.preview.skippedRows >= 1, "la fila TOTALES se ignora");
    // Toma Balance Inicial, no Saldo final.
    assert.equal(json.preview.rows.find((r) => r.code === "100001")?.saldo_inicial, 2500);
    assert.equal(
      json.preview.rows.find((r) => r.code === "600001")?.subcategoria,
      "gastos_operativos",
      "Gastos → expense + gastos_operativos aunque no haya columna Subcategoría"
    );
  }
);

test("archivo sin encabezados reconocibles → 400", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req(xlsxBuffer([["foo", "bar"], ["1", "2"]]), "preview"));
  const json = (await res.json()) as { error: string };
  assert.equal(res.status, 400);
  assert.match(json.error, /encabezados/i);
  assert.equal(state.captured.inserts.length, 0);
});

test("archivo con encabezados pero sin cuentas → 400", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req(xlsxBuffer([HEADER, ["", "", "", "", ""]]), "preview"));
  const json = (await res.json()) as { error: string };
  assert.equal(res.status, 400);
  assert.match(json.error, /ninguna cuenta/i);
});

test("rol NO permitido (asistente) → 403, no escribe", { skip: skipNoMocks }, async () => {
  reset();
  state.profile.role = "asistente";
  const res = await POST(req(xlsxBuffer(FIVE_ROWS), "commit"));
  assert.equal(res.status, 403);
  assert.equal(state.captured.inserts.length, 0);
});

test("modo inválido → 400", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req(xlsxBuffer(FIVE_ROWS), "borrar" as "commit"));
  assert.equal(res.status, 400);
  assert.equal(state.captured.inserts.length, 0);
});
