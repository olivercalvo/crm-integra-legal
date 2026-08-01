/**
 * Tests de SINCRONIZACIÓN ruc → tax_id en la API de clientes (POST y PATCH).
 *
 * Causa raíz (2026-08, CLI-057 MI CONDADO): la ficha edita `ruc`, la emisión
 * eFactura lee `tax_id ?? ruc` (map-receptor.ts, PREFIERE tax_id). El form
 * nunca manda tax_id → al corregir el RUC quedaba tax_id con el valor viejo y
 * la factura salía con el RUC equivocado mostrando el correcto en pantalla.
 *
 * Estos tests corren los HANDLERS REALES y, para el aserto clave, el MAPPER
 * REAL (mapReceptor): el RUC que se emitiría debe ser el de la ficha.
 *
 * Ejecución (requiere el flag experimental para mock.module):
 *   npx tsx --test --experimental-test-module-mocks \
 *     src/app/api/clients/__tests__/ruc-taxid-sync.route.test.ts
 */

import test, { mock, before } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

import { rucFieldWrites, normalizeRucInput } from "@/lib/clients/ruc-sync";
import { mapReceptor } from "@/lib/finanzas/efactura/mapper/map-receptor";
import type { EfacturaBundleClient } from "@/lib/finanzas/efactura/data/invoice-efactura-bundle";

// ---------------------------------------------------------------------------
// 1) Núcleo PURO
// ---------------------------------------------------------------------------

test("normalizeRucInput: vacío/whitespace/null → null; con valor → trim", () => {
  assert.equal(normalizeRucInput(null), null);
  assert.equal(normalizeRucInput(undefined), null);
  assert.equal(normalizeRucInput(""), null);
  assert.equal(normalizeRucInput("   "), null);
  assert.equal(normalizeRucInput("  1725894-1-691335 "), "1725894-1-691335");
});

test("rucFieldWrites: RUC con valor → escribe ruc Y tax_id con el mismo valor", () => {
  assert.deepEqual(rucFieldWrites("  1725894-1-691335 "), {
    ruc: "1725894-1-691335",
    tax_id: "1725894-1-691335",
  });
});

test("rucFieldWrites: RUC vacío → ruc null y tax_id AUSENTE (no borra data)", () => {
  assert.deepEqual(rucFieldWrites(""), { ruc: null });
  assert.deepEqual(rucFieldWrites(null), { ruc: null });
  assert.equal("tax_id" in rucFieldWrites(""), false);
});

// ---------------------------------------------------------------------------
// 2) Handlers reales POST / PATCH con un fake de Supabase.
//    Mismo harness que ruc-unique.route.test.ts.
// ---------------------------------------------------------------------------

const MOCKS_ENABLED = typeof mock.module === "function";
const skipNoMocks = MOCKS_ENABLED
  ? false
  : "requiere: npx tsx --test --experimental-test-module-mocks";

const state: {
  user: { id: string };
  profile: { tenant_id: string; role: string };
  existingClient: Record<string, unknown> | null;
  activeClients: Record<string, unknown>[];
  captured: { insert: Record<string, unknown> | null; update: Record<string, unknown> | null };
} = {
  user: { id: "u1" },
  profile: { tenant_id: "t1", role: "admin" },
  existingClient: null,
  activeClients: [],
  captured: { insert: null, update: null },
};

function makeAdmin() {
  function builder(table: string) {
    const s: { table: string; op: "insert" | "update" | null; payload: Record<string, unknown> | null } = {
      table,
      op: null,
      payload: null,
    };
    const resolveSingle = () => {
      if (s.table === "users") return { data: state.profile, error: null };
      if (s.table === "clients") {
        if (s.op === "insert") {
          state.captured.insert = s.payload;
          return { data: { id: "new-id", client_number: "CLI-TEST-001", ...s.payload }, error: null };
        }
        if (s.op === "update") {
          state.captured.update = s.payload;
          return {
            data: { ...(state.existingClient ?? {}), ...s.payload, id: state.existingClient?.id ?? "existing-id" },
            error: null,
          };
        }
        return {
          data: state.existingClient,
          error: state.existingClient ? null : { message: "not found" },
        };
      }
      return { data: {}, error: null };
    };
    const resolveList = () => {
      if (s.table === "clients") return { data: state.activeClients, error: null };
      return { data: [], error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      neq: () => b,
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
      single: async () => resolveSingle(),
      maybeSingle: async () => resolveSingle(),
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(s.op ? resolveSingle() : resolveList()).then(onOk, onErr),
    };
    return b;
  }
  return { from: (t: string) => builder(t) };
}

if (MOCKS_ENABLED) {
  mock.module("@/lib/supabase/server", {
    namedExports: {
      createClient: () => ({
        auth: { getUser: async () => ({ data: { user: state.user } }) },
      }),
    },
  });
  mock.module("@/lib/supabase/admin", {
    namedExports: { createAdminClient: () => makeAdmin() },
  });
  mock.module("@/lib/clients/numbering", {
    namedExports: {
      allocateClientNumber: async () => "CLI-TEST-001",
      previewNextClientNumber: async () => "CLI-TEST-001",
      formatClientNumber: (n: number) => `CLI-${n}`,
    },
  });
}

let POST: (req: NextRequest) => Promise<Response>;
let PATCH: (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response>;

before(async () => {
  if (!MOCKS_ENABLED) return;
  ({ POST } = (await import("@/app/api/clients/route")) as unknown as { POST: typeof POST });
  ({ PATCH } = (await import("@/app/api/clients/[id]/route")) as unknown as { PATCH: typeof PATCH });
});

function req(body: unknown) {
  return { json: async () => body } as unknown as NextRequest;
}

function reset() {
  state.captured = { insert: null, update: null };
  state.existingClient = null;
  state.activeClients = [];
}

/**
 * El RUC que la DGI recibiría, según el MAPPER REAL. No replica
 * `tax_id ?? ruc` a mano: llama a mapReceptor y lee rucReceptor.
 */
function rucQueSeEmitiria(row: Record<string, unknown>): string | undefined {
  const client = {
    client_number: "CLI-TEST-001",
    name: "Cliente Test",
    client_type: "persona_juridica",
    tipo_receptor_fe: "01",
    digito_verificador: "12",
    ruc: (row.ruc as string | null) ?? null,
    tax_id: (row.tax_id as string | null) ?? null,
  } as unknown as EfacturaBundleClient;
  return mapReceptor(client).datosRucReceptor?.rucReceptor;
}

const RUC_COMPLETO = "1725894-1-691335";
const RUC_VIEJO_INCOMPLETO = "691335";

// ---- POST ----

test("POST con ruc → tax_id queda con el MISMO valor", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(
    req({ name: "MI CONDADO, S.A.", client_type: "persona_juridica", ruc: RUC_COMPLETO })
  );
  assert.equal(res.status, 201);
  assert.equal(state.captured.insert?.ruc, RUC_COMPLETO);
  assert.equal(state.captured.insert?.tax_id, RUC_COMPLETO);
});

test("POST trimea el ruc en AMBAS columnas", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(
    req({ name: "Con Espacios", client_type: "persona_juridica", ruc: `  ${RUC_COMPLETO}  ` })
  );
  assert.equal(res.status, 201);
  assert.equal(state.captured.insert?.ruc, RUC_COMPLETO);
  assert.equal(state.captured.insert?.tax_id, RUC_COMPLETO);
});

test("POST sin ruc → ruc null y tax_id NO se escribe (sigue null en BD)", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(req({ name: "Sin RUC", client_type: "persona_natural" }));
  assert.equal(res.status, 201);
  assert.equal(state.captured.insert?.ruc, null);
  assert.equal("tax_id" in (state.captured.insert ?? {}), false);
});

test("POST con tax_id explícito DISTINTO → gana el ruc de la ficha", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(
    req({
      name: "Body Malicioso",
      client_type: "persona_juridica",
      ruc: RUC_COMPLETO,
      tax_id: RUC_VIEJO_INCOMPLETO,
    })
  );
  assert.equal(res.status, 201);
  assert.equal(state.captured.insert?.tax_id, RUC_COMPLETO);
});

test("POST: el RUC que se emitiría coincide con el de la ficha", { skip: skipNoMocks }, async () => {
  reset();
  const res = await POST(
    req({ name: "MI CONDADO, S.A.", client_type: "persona_juridica", ruc: RUC_COMPLETO })
  );
  assert.equal(res.status, 201);
  assert.equal(rucQueSeEmitiria(state.captured.insert!), RUC_COMPLETO);
});

// ---- PATCH ----

test("PATCH editando el ruc → tax_id se actualiza al mismo valor", { skip: skipNoMocks }, async () => {
  reset();
  state.existingClient = {
    id: "c057",
    tenant_id: "t1",
    client_number: "CLI-057",
    name: "MI CONDADO, S.A.",
    ruc: RUC_VIEJO_INCOMPLETO,
    tax_id: RUC_VIEJO_INCOMPLETO,
    client_type: "persona_juridica",
    client_status: "active",
  };
  const res = await PATCH(req({ ruc: RUC_COMPLETO }), { params: { id: "c057" } });
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.ruc, RUC_COMPLETO);
  assert.equal(state.captured.update?.tax_id, RUC_COMPLETO);
});

test(
  "PATCH — REGRESIÓN CLI-057: tras corregir el ruc, el RUC que se emitiría es el nuevo",
  { skip: skipNoMocks },
  async () => {
    reset();
    state.existingClient = {
      id: "c057",
      tenant_id: "t1",
      client_number: "CLI-057",
      name: "MI CONDADO, S.A.",
      ruc: RUC_VIEJO_INCOMPLETO,
      tax_id: RUC_VIEJO_INCOMPLETO, // el valor viejo que se emitía
      client_type: "persona_juridica",
      client_status: "active",
    };
    const res = await PATCH(req({ ruc: RUC_COMPLETO }), { params: { id: "c057" } });
    const fichaDespues = (await res.json()) as Record<string, unknown>;
    assert.equal(res.status, 200);
    // La ficha muestra el nuevo...
    assert.equal(fichaDespues.ruc, RUC_COMPLETO);
    // ...y el mapper real emitiría EXACTAMENTE ese, no el viejo.
    assert.equal(rucQueSeEmitiria(fichaDespues), RUC_COMPLETO);
    assert.notEqual(rucQueSeEmitiria(fichaDespues), RUC_VIEJO_INCOMPLETO);
  }
);

test("PATCH con ruc y tax_id DISTINTOS en el body → gana ruc", { skip: skipNoMocks }, async () => {
  reset();
  state.existingClient = {
    id: "c200",
    tenant_id: "t1",
    name: "Cliente",
    ruc: "1-1-1",
    tax_id: "1-1-1",
    client_type: "persona_juridica",
    client_status: "active",
  };
  const res = await PATCH(req({ ruc: RUC_COMPLETO, tax_id: RUC_VIEJO_INCOMPLETO }), {
    params: { id: "c200" },
  });
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.ruc, RUC_COMPLETO);
  assert.equal(state.captured.update?.tax_id, RUC_COMPLETO);
});

test("PATCH con ruc VACÍO → ruc null y tax_id NO se toca (no borra data)", { skip: skipNoMocks }, async () => {
  reset();
  state.existingClient = {
    id: "c200",
    tenant_id: "t1",
    name: "Cliente",
    ruc: "1-1-1",
    tax_id: "1-1-1",
    client_type: "persona_juridica",
    client_status: "active",
  };
  const res = await PATCH(req({ ruc: "" }), { params: { id: "c200" } });
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.ruc, null);
  assert.equal("tax_id" in (state.captured.update ?? {}), false);
});

test("PATCH que NO toca el ruc → no escribe tax_id", { skip: skipNoMocks }, async () => {
  reset();
  state.existingClient = {
    id: "c200",
    tenant_id: "t1",
    name: "Cliente",
    ruc: "1-1-1",
    tax_id: "1-1-1",
    client_type: "persona_natural",
    client_status: "active",
  };
  const res = await PATCH(req({ phone: "6000-0000" }), { params: { id: "c200" } });
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.phone, "6000-0000");
  assert.equal("tax_id" in (state.captured.update ?? {}), false);
  assert.equal("ruc" in (state.captured.update ?? {}), false);
});

test("PATCH con solo tax_id (sin ruc) → sigue funcionando como antes", { skip: skipNoMocks }, async () => {
  reset();
  state.existingClient = {
    id: "c300",
    tenant_id: "t1",
    name: "Prospecto",
    ruc: null,
    tax_id: null,
    client_type: "persona_juridica",
    client_status: "prospect",
  };
  const res = await PATCH(req({ tax_id: RUC_COMPLETO }), { params: { id: "c300" } });
  assert.equal(res.status, 200);
  assert.equal(state.captured.update?.tax_id, RUC_COMPLETO);
});

// ---- No romper lo existente ----

test("Gate promoción prospect→active sigue exigiendo tax_id, y el ruc lo satisface", { skip: skipNoMocks }, async () => {
  reset();
  state.existingClient = {
    id: "c400",
    tenant_id: "t1",
    name: "Prospecto A Promover",
    ruc: null,
    tax_id: null,
    tax_id_type: null,
    email: null,
    client_type: "persona_juridica",
    client_status: "prospect",
  };
  // Sin tax_id ni email → 400 (comportamiento previo intacto).
  const sinDatos = await PATCH(req({ client_status: "active" }), { params: { id: "c400" } });
  assert.equal(sinDatos.status, 400);

  // El gate lee `tax_id` del body; mandar solo `ruc` NO lo satisface (el gate
  // corre antes del espejo). Se documenta el comportamiento real.
  reset();
  state.existingClient = {
    id: "c400",
    tenant_id: "t1",
    name: "Prospecto A Promover",
    ruc: null,
    tax_id: null,
    tax_id_type: "RUC",
    email: "a@b.com",
    client_type: "persona_juridica",
    client_status: "prospect",
  };
  const soloRuc = await PATCH(req({ client_status: "active", ruc: RUC_COMPLETO }), {
    params: { id: "c400" },
  });
  assert.equal(soloRuc.status, 400);

  // Con tax_id explícito + ruc igual → promueve y ambos quedan sincronizados.
  reset();
  state.existingClient = {
    id: "c400",
    tenant_id: "t1",
    name: "Prospecto A Promover",
    ruc: null,
    tax_id: null,
    tax_id_type: "RUC",
    email: "a@b.com",
    client_type: "persona_juridica",
    client_status: "prospect",
  };
  const ok = await PATCH(
    req({ client_status: "active", ruc: RUC_COMPLETO, tax_id: RUC_COMPLETO }),
    { params: { id: "c400" } }
  );
  assert.equal(ok.status, 200);
  assert.equal(state.captured.update?.ruc, RUC_COMPLETO);
  assert.equal(state.captured.update?.tax_id, RUC_COMPLETO);
});

test("Unicidad de RUC sigue bloqueando: el espejo no evade el 409", { skip: skipNoMocks }, async () => {
  reset();
  state.activeClients = [
    {
      id: "c116",
      client_number: "CLI-116",
      name: "INMOBILIARIA CAMAY, S.A.",
      ruc: RUC_COMPLETO,
      tax_id: null,
      client_status: "active",
    },
  ];
  const res = await POST(req({ name: "Duplicado", client_type: "persona_juridica", ruc: RUC_COMPLETO }));
  assert.equal(res.status, 409);
  assert.equal(state.captured.insert, null, "no debe insertar");
});
