/**
 * Tests de los guards de autorización de la capa /api:
 *   - requireRole(role, allowed)            → gate de rol (403 estandarizado)
 *   - requireEntityInTenant(db, ...)        → guard anti-IDOR (404 cross-tenant)
 *
 * Ejecución:
 *   npx tsx --test src/lib/supabase/__tests__/authz-guards.test.ts
 *
 * Contexto: el middleware NO gatea /api/**; el rol se valida dentro de cada
 * handler. Estos dos helpers concentran TODA la lógica de autorización nueva
 * que este cambio agrega a los endpoints legales. Cada handler delega su
 * decisión de rol a requireRole(...) con su lista `allowed`, y los 2 endpoints
 * con IDOR de escritura (comments, documents/register) delegan la verificación
 * de pertenencia al tenant a requireEntityInTenant(...). Por eso los probamos
 * directamente y de forma exhaustiva, etiquetando cada caso por endpoint.
 *
 * (No se drivean los route handlers de Next end-to-end: `next/headers`
 * `cookies()` lanza fuera de un request scope y el runner no soporta
 * module-mocks que compongan con tsx. La lógica agregada vive 100% en estos
 * helpers, que sí son deterministas y testeables.)
 */

import test from "node:test";
import assert from "node:assert/strict";

import { requireRole, requireEntityInTenant } from "@/lib/supabase/server-query";

// ---------------------------------------------------------------------------
// Matriz de roles del proyecto:
//   admin     → todo
//   abogada   → CRUD legal + finanzas
//   asistente → ver casos asignados, registrar gastos, cumplir tareas,
//               comentar, subir documentos (NO crea/edita clientes/casos/prospectos)
//   contador  → solo finanzas (NO recursos legales)
// ---------------------------------------------------------------------------

const LEGAL_WRITE = ["admin", "abogada"] as const; // clients/cases/prospects mutaciones
const LEGAL_CONTRIB = ["admin", "abogada", "asistente"] as const; // comentar / subir docs

/** allowed que usa CADA endpoint tocado, para cobertura 1:1. */
const ENDPOINTS: Array<{ name: string; allowed: readonly string[] }> = [
  { name: "POST /api/clients", allowed: LEGAL_WRITE },
  { name: "PATCH /api/clients/[id]", allowed: LEGAL_WRITE },
  { name: "DELETE /api/clients/[id]", allowed: LEGAL_WRITE },
  { name: "POST /api/cases", allowed: LEGAL_WRITE },
  // PATCH /api/cases/[id] gatea por ACCIÓN: change-status permite asistente
  // (actualizar estado de sus casos, CLAUDE.md); el resto de la edición NO.
  { name: "PATCH /api/cases/[id] (edición general)", allowed: LEGAL_WRITE },
  { name: "PATCH /api/cases/[id] (change-status)", allowed: LEGAL_CONTRIB },
  { name: "POST /api/prospects", allowed: LEGAL_WRITE },
  { name: "PATCH /api/prospects/[id]", allowed: LEGAL_WRITE },
  { name: "DELETE /api/prospects/[id]", allowed: LEGAL_WRITE },
  { name: "POST /api/prospects/[id]/convert", allowed: LEGAL_WRITE },
  { name: "POST /api/comments", allowed: LEGAL_CONTRIB },
  { name: "POST /api/documents/register", allowed: LEGAL_CONTRIB },
];

const ALL_ROLES = ["admin", "abogada", "asistente", "contador"] as const;

// ---------------------------------------------------------------------------
// requireRole — por cada endpoint: rol-no-permitido → 403 y rol-permitido → OK
// ---------------------------------------------------------------------------

for (const ep of ENDPOINTS) {
  const denied = ALL_ROLES.filter((r) => !ep.allowed.includes(r));
  const allowed = ep.allowed;

  test(`${ep.name}: roles NO permitidos → 403 (${denied.join(", ")})`, async () => {
    for (const role of denied) {
      const res = requireRole(role, ep.allowed);
      assert.ok(res, `${role} debería ser bloqueado en ${ep.name}`);
      assert.equal(res!.status, 403);
      const body = await res!.json();
      assert.deepEqual(body, { error: "Sin permiso" });
    }
  });

  test(`${ep.name}: roles permitidos → OK/null (${allowed.join(", ")})`, () => {
    for (const role of allowed) {
      const res = requireRole(role, ep.allowed);
      assert.equal(res, null, `${role} debería pasar en ${ep.name}`);
    }
  });
}

test("requireRole falla CERRADO ante rol null/undefined/desconocido → 403", async () => {
  for (const role of [null, undefined, "", "root", "superuser"]) {
    const res = requireRole(role as string | null | undefined, LEGAL_WRITE);
    assert.ok(res, `rol ${JSON.stringify(role)} debería bloquearse`);
    assert.equal(res!.status, 403);
    assert.deepEqual(await res!.json(), { error: "Sin permiso" });
  }
});

test("contador NUNCA accede a recursos legales (ni siquiera a comentar/subir docs)", async () => {
  // contador solo finanzas — bloqueado en TODOS los endpoints legales tocados.
  for (const ep of ENDPOINTS) {
    const res = requireRole("contador", ep.allowed);
    assert.ok(res, `contador debería bloquearse en ${ep.name}`);
    assert.equal(res!.status, 403);
  }
});

// ---------------------------------------------------------------------------
// requireEntityInTenant — IDOR: entidad de OTRO tenant → 404; mismo tenant → OK
// ---------------------------------------------------------------------------

type StoreRow = { id: string; tenant_id: string };

/** Fake mínimo del builder de Supabase para el patrón select().eq().eq().maybeSingle(). */
function fakeDb(rows: StoreRow[]) {
  return {
    from() {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        maybeSingle: async () => {
          const match = rows.find(
            (r) => r.id === filters.id && r.tenant_id === filters.tenant_id
          );
          return { data: match ? { id: match.id } : null, error: null };
        },
      };
      return builder;
    },
  };
}

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";

test("documents/register IDOR: entity de OTRO tenant → 404 'Recurso no encontrado'", async () => {
  // El caso 'case-1' existe pero pertenece a T2. Un usuario de T1 no puede
  // colgarle un documento pasando ese entity_id.
  const db = fakeDb([{ id: "case-1", tenant_id: T2 }]);
  const res = await requireEntityInTenant(db as never, "cases", "case-1", T1);
  assert.ok(res, "debe rechazar cross-tenant");
  assert.equal(res!.status, 404);
  assert.deepEqual(await res!.json(), { error: "Recurso no encontrado" });
});

test("documents/register IDOR: entity del MISMO tenant → OK/null", async () => {
  const db = fakeDb([{ id: "case-1", tenant_id: T1 }]);
  const res = await requireEntityInTenant(db as never, "cases", "case-1", T1);
  assert.equal(res, null);
});

test("comments IDOR: caso de OTRO tenant → 404 'Caso no encontrado'", async () => {
  const db = fakeDb([{ id: "case-9", tenant_id: T2 }]);
  const res = await requireEntityInTenant(
    db as never,
    "cases",
    "case-9",
    T1,
    "Caso no encontrado"
  );
  assert.ok(res);
  assert.equal(res!.status, 404);
  assert.deepEqual(await res!.json(), { error: "Caso no encontrado" });
});

test("comments IDOR: caso del MISMO tenant → OK/null", async () => {
  const db = fakeDb([{ id: "case-9", tenant_id: T1 }]);
  const res = await requireEntityInTenant(
    db as never,
    "cases",
    "case-9",
    T1,
    "Caso no encontrado"
  );
  assert.equal(res, null);
});

test("requireEntityInTenant: entidad inexistente → 404 (no filtra existencia entre tenants)", async () => {
  const db = fakeDb([]); // no existe en ningún tenant
  const res = await requireEntityInTenant(db as never, "clients", "nope", T1);
  assert.ok(res);
  assert.equal(res!.status, 404);
});
