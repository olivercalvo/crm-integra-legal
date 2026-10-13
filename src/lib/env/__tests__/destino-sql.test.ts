// 🔒 run-sql.mjs sólo corre contra staging o una base local (07/10/2026).
import test from "node:test";
import assert from "node:assert/strict";
import { destinoPermitido } from "../../../../scripts/destino-sql.mjs";

test("producción se rechaza, por pooler o por host directo", () => {
  for (const c of [
    "postgresql://postgres.uqmmkklbhzxqybljiecs:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
    "postgresql://postgres:x@db.uqmmkklbhzxqybljiecs.supabase.co:5432/postgres",
  ]) assert.throws(() => destinoPermitido(c), /PRODUCCIÓN/);
});

test("otra base que no es staging ni local también se rechaza", () => {
  assert.throws(() => destinoPermitido("postgresql://postgres:x@db.otroproyecto123.supabase.co:5432/postgres"), /no es staging/);
});

test("staging y local pasan", () => {
  assert.equal(destinoPermitido("postgresql://postgres.xtyenhakplrkyifbcaow:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres"), "staging");
  assert.equal(destinoPermitido("postgresql://postgres@localhost:54329/ventana"), "local");
});
