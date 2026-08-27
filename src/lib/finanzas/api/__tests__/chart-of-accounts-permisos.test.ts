/**
 * Tests de los PERMISOS de updateChartAccount (Fase 1, Tarea 6).
 *
 * Cubren los tres criterios de aceptación del documento de RM Consultores:
 *
 *   1. Solo el contador (y admin) puede cambiar la clasificación contable
 *      (`account_type` / `subcategoria`). La abogada conserva renombrar.
 *   2. Una cuenta CON MOVIMIENTOS no cambia de naturaleza — la toque quien la
 *      toque, contador incluido.
 *   3. Una cuenta CON MOVIMIENTOS tampoco se desactiva ("borrar" acá es
 *      active=false, y los reportes filtran por active).
 *
 * El cliente de Supabase se reemplaza por un stub encadenable: lo que se está
 * probando es la lógica de decisión, no PostgREST.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/api/__tests__/chart-of-accounts-permisos.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { updateChartAccount } from "@/lib/finanzas/api/chart-of-accounts";
import { MutationError } from "@/lib/finanzas/api/errors";
import type { UpdateChartAccountInput } from "@/lib/finanzas/types/chart-of-account";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

/** La cuenta tal como está HOY en la base, antes del PATCH. */
const CUENTA_ACTUAL = {
  id: ACCOUNT_ID,
  code: "610001",
  name: "Alquiler",
  account_type: "expense",
  subcategoria: "gastos_operativos",
  cuenta_control: null,
  saldo_inicial: 11472.78,
  description: null,
  active: true,
  is_system: false,
};

/** PATCH que NO toca la clasificación: solo renombra. */
function soloRenombrar(): UpdateChartAccountInput {
  return {
    name: "Alquiler de oficina",
    account_type: "expense",
    subcategoria: "gastos_operativos",
    cuenta_control: null,
    saldo_inicial: 11472.78,
    description: null,
    active: true,
  };
}

/** PATCH que SÍ reclasifica (cambia la subcategoría de actividad). */
function reclasificar(): UpdateChartAccountInput {
  return { ...soloRenombrar(), name: "Alquiler", subcategoria: "gastos_inversion" };
}

/** PATCH que desactiva la cuenta. */
function desactivar(): UpdateChartAccountInput {
  return { ...soloRenombrar(), name: "Alquiler", active: false };
}

/**
 * Stub del cliente Supabase. Devuelve `movimientos` al contar
 * journal_entry_lines y registra el UPDATE que se haya intentado.
 */
function makeDb(movimientos: number) {
  const registro: { update: Record<string, unknown> | null } = { update: null };

  // Objeto encadenable y "awaitable": .eq().eq() al final se puede await.
  function chain(resultado: unknown) {
    const obj: Record<string, unknown> = {
      select: () => obj,
      eq: () => obj,
      in: () => obj,
      maybeSingle: async () => resultado,
      single: async () => resultado,
      then: (res: (v: unknown) => unknown) => Promise.resolve(resultado).then(res),
    };
    return obj;
  }

  const db = {
    from(table: string) {
      if (table === "journal_entry_lines") {
        return chain({ count: movimientos, error: null });
      }
      if (table === "audit_log") {
        return { insert: async () => ({ error: null }) };
      }
      // chart_of_accounts
      const obj: Record<string, unknown> = {
        select: () => obj,
        eq: () => obj,
        maybeSingle: async () => ({ data: CUENTA_ACTUAL, error: null }),
        single: async () => ({ data: { ...CUENTA_ACTUAL, ...registro.update }, error: null }),
        update: (payload: Record<string, unknown>) => {
          registro.update = payload;
          return obj;
        },
      };
      return obj;
    },
  };

  return { db, registro };
}

async function capturar(fn: () => Promise<unknown>): Promise<MutationError | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof MutationError) return err;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 1) Quién puede reclasificar
// ---------------------------------------------------------------------------

test("abogada NO puede cambiar la clasificación contable → 403", async () => {
  const { db, registro } = makeDb(0);
  const err = await capturar(() =>
    updateChartAccount(db as never, TENANT, ACCOUNT_ID, "u1", "abogada", reclasificar())
  );
  assert.ok(err, "debía rechazar");
  assert.equal(err.status, 403);
  assert.match(err.message, /contador|administrador/i);
  assert.equal(registro.update, null, "no debe haber intentado el UPDATE");
});

test("abogada SÍ puede renombrar (no toca la clasificación)", async () => {
  const { db, registro } = makeDb(0);
  const err = await capturar(() =>
    updateChartAccount(db as never, TENANT, ACCOUNT_ID, "u1", "abogada", soloRenombrar())
  );
  assert.equal(err, null, "renombrar no debería fallar");
  assert.equal(registro.update?.name, "Alquiler de oficina");
});

test("contador y admin SÍ pueden reclasificar", async () => {
  for (const rol of ["contador", "admin"]) {
    const { db, registro } = makeDb(0);
    const err = await capturar(() =>
      updateChartAccount(db as never, TENANT, ACCOUNT_ID, "u1", rol, reclasificar())
    );
    assert.equal(err, null, `${rol} debería poder reclasificar`);
    assert.equal(registro.update?.subcategoria, "gastos_inversion");
  }
});

test("también se bloquea el cambio de account_type, no solo de subcategoría", async () => {
  const { db } = makeDb(0);
  const err = await capturar(() =>
    updateChartAccount(db as never, TENANT, ACCOUNT_ID, "u1", "abogada", {
      ...soloRenombrar(),
      name: "Alquiler",
      account_type: "cost",
      subcategoria: "costos_operativos",
    })
  );
  assert.ok(err);
  assert.equal(err.status, 403);
});

// ---------------------------------------------------------------------------
// 2) Cuentas con movimientos: nadie les cambia la naturaleza
// ---------------------------------------------------------------------------

test("cuenta CON movimientos: ni el contador puede reclasificarla → 409", async () => {
  const { db, registro } = makeDb(7);
  const err = await capturar(() =>
    updateChartAccount(db as never, TENANT, ACCOUNT_ID, "u1", "contador", reclasificar())
  );
  assert.ok(err, "debía rechazar");
  assert.equal(err.status, 409);
  assert.match(err.message, /movimiento/i);
  assert.equal(registro.update, null, "no debe haber intentado el UPDATE");
});

test("cuenta CON movimientos: el admin tampoco", async () => {
  const { db } = makeDb(3);
  const err = await capturar(() =>
    updateChartAccount(db as never, TENANT, ACCOUNT_ID, "u1", "admin", reclasificar())
  );
  assert.ok(err);
  assert.equal(err.status, 409);
});

test("cuenta CON movimientos: renombrar SIGUE permitido", async () => {
  // La regla protege la naturaleza contable, no el nombre: un typo en el
  // nombre se tiene que poder corregir aunque la cuenta ya tenga asientos.
  const { db, registro } = makeDb(12);
  const err = await capturar(() =>
    updateChartAccount(db as never, TENANT, ACCOUNT_ID, "u1", "contador", soloRenombrar())
  );
  assert.equal(err, null, "renombrar no debería fallar por tener movimientos");
  assert.equal(registro.update?.name, "Alquiler de oficina");
});

// ---------------------------------------------------------------------------
// 3) Cuentas con movimientos: tampoco se desactivan
// ---------------------------------------------------------------------------

test("cuenta CON movimientos: no se puede desactivar → 409", async () => {
  const { db, registro } = makeDb(5);
  const err = await capturar(() =>
    updateChartAccount(db as never, TENANT, ACCOUNT_ID, "u1", "admin", desactivar())
  );
  assert.ok(err, "debía rechazar");
  assert.equal(err.status, 409);
  assert.match(err.message, /desactivar/i);
  assert.equal(registro.update, null);
});

test("cuenta SIN movimientos: desactivar sigue funcionando", async () => {
  const { db, registro } = makeDb(0);
  const err = await capturar(() =>
    updateChartAccount(db as never, TENANT, ACCOUNT_ID, "u1", "admin", desactivar())
  );
  assert.equal(err, null);
  assert.equal(registro.update?.active, false);
});
