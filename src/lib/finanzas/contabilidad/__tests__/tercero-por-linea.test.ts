/**
 * EL TERCERO DE CADA LÍNEA (Bloque 7, migración `054`).
 *
 *   1. `postJournalEntry` manda `client_id` / `supplier_id` **dentro de cada
 *      línea**, no como parámetro del RPC: la firma de trece parámetros no
 *      cambió y ningún llamador viejo se tocó.
 *   2. Una línea sin tercero manda `null` en los dos, nunca `undefined` — un
 *      `undefined` desaparece al serializar el JSON y el RPC lo leería como
 *      ausente, que es lo mismo, pero deja de ser explícito en el payload.
 *   3. 🔬 El tercero entra en el `content_hash` y las FK son `NO ACTION`: lo
 *      fija la migración, y acá se lee para que nadie la "simplifique" después
 *      con un `SET NULL` que el trigger de inmutabilidad haría fallar.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { postJournalEntry, type AsientoInput } from "@/lib/finanzas/contabilidad/posting";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const CLIENTE = "11111111-1111-1111-1111-111111111111";
const PROVEEDOR = "22222222-2222-2222-2222-222222222222";

function fakeDb(capturado: { args?: Record<string, unknown> }) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      capturado.args = args;
      return { data: fn === "post_journal_entry" ? "je-1" : null, error: null };
    },
  };
}

const ASIENTO: AsientoInput = {
  transaction_date: "2026-09-22",
  description: "Ajuste manual",
  source_type: "manual",
  lines: [
    { account_code: "100004", debit: 10, credit: 0, description: "CxC", client_id: CLIENTE },
    { account_code: "200001", debit: 0, credit: 10, supplier_id: PROVEEDOR },
  ],
};

test("el tercero viaja DENTRO de cada línea, no como parámetro del RPC", async () => {
  const cap: { args?: Record<string, unknown> } = {};
  await postJournalEntry(fakeDb(cap) as never, TENANT, ASIENTO, null);

  const lineas = cap.args?.p_lines as Array<Record<string, unknown>>;
  assert.equal(lineas[0].client_id, CLIENTE);
  assert.equal(lineas[0].supplier_id, null);
  assert.equal(lineas[1].supplier_id, PROVEEDOR);
  assert.equal(lineas[1].client_id, null);

  // La firma no creció: nada de p_client_id / p_supplier_id.
  const claves = Object.keys(cap.args ?? {});
  assert.ok(!claves.some((k) => /client|supplier/.test(k)), `la firma del RPC creció: ${claves.join(", ")}`);
  assert.equal(claves.length, 13, "el RPC sigue teniendo trece parámetros");
});

test("una línea sin tercero manda null explícito en los dos campos", async () => {
  const cap: { args?: Record<string, unknown> } = {};
  await postJournalEntry(
    fakeDb(cap) as never,
    TENANT,
    {
      ...ASIENTO,
      lines: [
        { account_code: "100004", debit: 10, credit: 0 },
        { account_code: "200001", debit: 0, credit: 10 },
      ],
    },
    null
  );
  for (const l of cap.args?.p_lines as Array<Record<string, unknown>>) {
    assert.ok("client_id" in l && l.client_id === null);
    assert.ok("supplier_id" in l && l.supplier_id === null);
  }
});

test("🔬 la 054: el tercero entra al hash, el CHECK es 'cero o uno' y las FK son NO ACTION", () => {
  const sql = readFileSync(join(process.cwd(), "sql/pending/054_tercero_por_linea.sql"), "utf8");

  assert.match(sql, /CHECK \(num_nonnulls\(client_id, supplier_id\) <= 1\)/);
  assert.match(sql, /REFERENCES public\.clients\(id\)\s+ON DELETE NO ACTION/);
  assert.match(sql, /REFERENCES public\.suppliers\(id\) ON DELETE NO ACTION/);
  assert.doesNotMatch(sql, /ON DELETE SET NULL/, "un SET NULL fallaría contra trg_jel_no_update");

  // El tercero dentro del string que se hashea, junto a cuenta/debe/haber/glosa.
  assert.match(
    sql,
    /concat_ws\(':', code, debit::text, credit::text, coalesce\(descr, ''\),\s*coalesce\(client_id::text, ''\), coalesce\(supplier_id::text, ''\)\)/,
    "el tercero tiene que entrar en v_lineas_txt, que es lo que se hashea"
  );

  // Y el tenant del tercero se verifica: una FK sola no mira el tenant.
  assert.match(sql, /Cliente\(s\) inexistentes o de otro bufete/);
  assert.match(sql, /Proveedor\(es\) inexistentes o de otro bufete/);
});

test("SOP-014 lista las tres versiones de la fórmula del content_hash, con fecha", () => {
  const sop = readFileSync(join(process.cwd(), "sop.md"), "utf8");
  const i = sop.indexOf("Las tres versiones de la fórmula");
  assert.ok(i > 0, "falta la sección en SOP-014: un verificador futuro la necesita");
  const bloque = sop.slice(i, i + 1800);
  assert.match(bloque, /2026-08-27/, "la fórmula original");
  assert.match(bloque, /2026-09-03/, "la que sumó reference (039)");
  assert.match(bloque, /2026-09-22/, "la que sumó el tercero (054)");
});
