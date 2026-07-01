/**
 * Unit tests del allocator atómico de client_number.
 *
 * Ejecución:
 *   npx tsx --test src/lib/clients/__tests__/numbering.test.ts
 *
 * Contexto (hotfix 2026-07-01):
 *   La UI de /clientes/nuevo dejó de enviar client_number en el body del POST.
 *   Con el body sin `client_number`, POST /api/clients debe entrar por la
 *   rama del allocator (numbering_sequences + RPC atómica) y NO tocar la
 *   validación UNIQUE app-level de la rama "custom".
 *
 * Estos tests cubren el helper que ejecuta esa rama:
 *   1. formatClientNumber padea a 3 dígitos por defecto (CLI-001, CLI-1000 OK).
 *   2. allocateClientNumber invoca la RPC get_next_sequence_number con los
 *      argumentos correctos y NO consulta la tabla clients (cero SELECT
 *      contra `clients` — la rama custom es la que valida UNIQUE ahí).
 *   3. allocateClientNumber devuelve el número formateado a partir del INT
 *      que retorna la RPC.
 *   4. Si la RPC falla (misconfig de numbering_sequences), el helper lanza
 *      un Error explícito.
 *   5. previewNextClientNumber lee last_number sin consumir la secuencia
 *      (no llama a la RPC).
 *
 * Patrón: node:test + assert/strict, sin frameworks externos (consistente
 * con map-invoice.test.ts y validate-update-quote.test.ts). Se mockea el
 * SupabaseClient con un stub que registra las llamadas para poder assertar
 * sobre ellas.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  allocateClientNumber,
  formatClientNumber,
  previewNextClientNumber,
  CLIENT_SEQUENCE_TYPE,
} from "@/lib/clients/numbering";

// ---------------------------------------------------------------------------
// Stub de Supabase — registra llamadas para poder assertar sobre ellas.
// ---------------------------------------------------------------------------

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface FromCall {
  table: string;
  filters: Array<{ op: string; column: string; value: unknown }>;
  finalizer: "maybeSingle" | "single" | null;
}

interface StubOptions {
  /** Valor que devuelve la RPC get_next_sequence_number. */
  rpcResult?: number;
  /** Error que devuelve la RPC. Si está seteado, gana sobre rpcResult. */
  rpcError?: { message: string };
  /** Última fila de numbering_sequences que devuelve el SELECT del preview. */
  seqRow?: { last_number: number } | null;
}

function makeStub(opts: StubOptions = {}) {
  const rpcCalls: RpcCall[] = [];
  const fromCalls: FromCall[] = [];

  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      return { data: opts.rpcResult ?? null, error: null };
    },
    from: (table: string) => {
      const call: FromCall = { table, filters: [], finalizer: null };
      fromCalls.push(call);
      const chain = {
        select: (_cols: string) => chain,
        eq: (column: string, value: unknown) => {
          call.filters.push({ op: "eq", column, value });
          return chain;
        },
        maybeSingle: async () => {
          call.finalizer = "maybeSingle";
          return { data: opts.seqRow ?? null, error: null };
        },
        single: async () => {
          call.finalizer = "single";
          return { data: opts.seqRow ?? null, error: null };
        },
      };
      return chain;
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, rpcCalls, fromCalls };
}

const TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("1. formatClientNumber padea a 3 dígitos y admite 4+", () => {
  assert.equal(formatClientNumber(1), "CLI-001");
  assert.equal(formatClientNumber(76), "CLI-076");
  assert.equal(formatClientNumber(999), "CLI-999");
  assert.equal(formatClientNumber(1000), "CLI-1000");
  assert.equal(formatClientNumber(12345), "CLI-12345");
});

test("2. allocateClientNumber llama la RPC correcta y NO valida UNIQUE en `clients`", async () => {
  const { db, rpcCalls, fromCalls } = makeStub({ rpcResult: 77 });

  const result = await allocateClientNumber(db, TENANT);

  assert.equal(result, "CLI-077", "número formateado a partir del INT de la RPC");

  // La RPC atómica es la única fuente de verdad.
  assert.equal(rpcCalls.length, 1, "debe haber exactamente 1 llamada a rpc");
  assert.equal(rpcCalls[0].fn, "get_next_sequence_number");
  assert.deepEqual(rpcCalls[0].args, {
    p_tenant_id: TENANT,
    p_sequence_type: CLIENT_SEQUENCE_TYPE,
  });

  // Bug histórico: la rama custom valida UNIQUE con SELECT ... FROM clients.
  // El allocator NO debe tocar la tabla clients — su serialización viene
  // 100% de la RPC (SELECT FOR UPDATE sobre numbering_sequences).
  const clientsQueries = fromCalls.filter((c) => c.table === "clients");
  assert.equal(
    clientsQueries.length,
    0,
    `allocator no debe consultar la tabla 'clients'; recibí: ${JSON.stringify(clientsQueries)}`
  );
});

test("3. allocateClientNumber formatea correctamente números >= 1000", async () => {
  const { db } = makeStub({ rpcResult: 1234 });
  const result = await allocateClientNumber(db, TENANT);
  assert.equal(result, "CLI-1234");
});

test("4. allocateClientNumber lanza Error explícito si la RPC falla", async () => {
  const { db } = makeStub({ rpcError: { message: "no_data_found" } });

  await assert.rejects(
    () => allocateClientNumber(db, TENANT),
    (err: unknown) => {
      assert.ok(err instanceof Error, "debe ser Error");
      assert.match(
        err.message,
        /allocateClientNumber.*no_data_found/,
        `mensaje inesperado: ${(err as Error).message}`
      );
      return true;
    }
  );
});

test("5. allocateClientNumber lanza Error si la RPC devuelve tipo inesperado (null)", async () => {
  const { db } = makeStub({ rpcResult: undefined });

  await assert.rejects(
    () => allocateClientNumber(db, TENANT),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(
        (err as Error).message,
        /allocateClientNumber/,
        "debe prefijarse con allocateClientNumber"
      );
      return true;
    }
  );
});

test("6. previewNextClientNumber lee last_number sin consumir la secuencia (no llama RPC)", async () => {
  const { db, rpcCalls, fromCalls } = makeStub({ seqRow: { last_number: 76 } });

  const result = await previewNextClientNumber(db, TENANT);

  assert.equal(result, "CLI-077", "preview = last_number + 1, formateado");
  assert.equal(rpcCalls.length, 0, "preview NO debe llamar la RPC (no consume)");

  // Debe leer sólo numbering_sequences, filtrando por tenant + sequence_type.
  assert.equal(fromCalls.length, 1);
  assert.equal(fromCalls[0].table, "numbering_sequences");
  const filterCols = fromCalls[0].filters.map((f) => f.column).sort();
  assert.deepEqual(filterCols, ["sequence_type", "tenant_id"]);
});

test("7. previewNextClientNumber devuelve null si la fila no existe (misconfig)", async () => {
  const { db } = makeStub({ seqRow: null });
  const result = await previewNextClientNumber(db, TENANT);
  assert.equal(result, null);
});
