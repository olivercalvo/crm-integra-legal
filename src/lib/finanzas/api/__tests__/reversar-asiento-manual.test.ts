/**
 * REVERSAR UN ASIENTO MANUAL (Bloque 7, commit 7 — D8).
 *
 *   1. El espejo lo arma `construirAsientoDeReversion` —la única
 *      implementación— y lo que va al RPC sale de ahí, sin intercambiar débito
 *      y crédito por su cuenta.
 *   2. 🔴 El filtro: un asiento con documento NO se reversa desde acá. Está en
 *      el RPC (que es el permiso), en este helper (para el mensaje) y en la
 *      pantalla (que no ofrece el botón).
 *   3. `source_id` va NULL: el vínculo es `reverses_entry_id`. Con el id del
 *      original ahí, el Mayor intentaría abrirlo como si fuera un documento.
 *   4. Un asiento ya reversado no se reversa de nuevo.
 *   5. La ruta la pueden llamar admin y contador —los mismos que cargan— y no
 *      la abogada: si no puede lo menos, no puede deshacerlo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const leer = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const HELPER = "src/lib/finanzas/api/asientos.ts";
const RUTA = "src/app/api/finanzas/asientos/[id]/reverse/route.ts";
const SQL = "sql/pending/055_reversion_de_asiento_manual.sql";
const REIMPLEMENTACION = /\b(debit|debe)\s*:\s*[\w.]*\b(credit|haber)\b|\b(credit|haber)\s*:\s*[\w.]*\b(debit|debe)\b/;

test("🔒 el espejo sale de construirAsientoDeReversion y no se reimplementa", () => {
  const src = leer(HELPER);
  assert.match(src, /import \{ construirAsientoDeReversion \}/);
  assert.match(src, /const armado = construirAsientoDeReversion\(/);
  assert.match(src, /p_lines: armado\.asiento\.lines\.map/);
  assert.doesNotMatch(src, REIMPLEMENTACION, "no intercambia débito y crédito por su cuenta");
  assert.doesNotMatch(src, /transaction_date: ['"]/, "la fecha la pone la función pura, no un literal");
});

test("🔴 el filtro a `manual` está en las TRES capas", () => {
  // 1. El RPC, que es el permiso.
  const sql = leer(SQL);
  assert.match(sql, /IF v_source_type <> 'manual' THEN/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION\s*\n?\s*public\.reverse_journal_entry/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION\s*\n?\s*public\.reverse_journal_entry\(uuid, uuid, text, date, text, jsonb, uuid\)\s*\n?\s*TO service_role;/);

  // 2. El helper, para el mensaje.
  const src = leer(HELPER);
  assert.match(src, /original\.source_type !== "manual"/);
  assert.match(src, /salió de un documento/);

  // 3. La pantalla, que no ofrece el botón.
  const page = leer("src/app/finanzas/asientos/[id]/page.tsx");
  assert.match(page, /\{esManual && !yaReversado && \(\s*<ReversePaymentDialog/);
});

test("source_id va NULL: el vínculo es reverses_entry_id", () => {
  const src = leer(HELPER);
  assert.match(src, /\{ hoy, motivo: reason, source_id: null \}/);
  const sql = leer(SQL);
  assert.match(sql, /NULL, NULL, p_entry_id, btrim\(p_reason\)/);
});

test("un asiento ya reversado se rechaza antes de llamar al RPC", () => {
  const src = leer(HELPER);
  const iChequeo = src.indexOf("original.reversadoPor");
  const iRpc = src.indexOf('ledgerDb.rpc("reverse_journal_entry"');
  assert.ok(iChequeo > 0 && iRpc > 0 && iChequeo < iRpc);
  // Y el índice único lo sostiene aunque alguien saltee el helper.
  assert.match(leer(SQL), /CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_una_reversion_por_asiento/);
});

test("la ruta: admin y contador, el tenant del contexto y el cliente de servicio", () => {
  const src = leer(RUTA);
  assert.match(src, /const MUTATING_ROLES = \["admin", "contador"\] as const;/);
  assert.match(src, /createAdminClient\(\)/);
  assert.match(src, /ctx\.tenantId/);
  assert.doesNotMatch(src, /body.*tenant_id|tenant_id.*body/, "el tenant nunca sale del body");
  // El motivo se valida con el mismo rango que las otras tres reversiones.
  assert.match(src, /MOTIVO_MIN|MOTIVO_MAX/);
});

test("el diálogo tiene su cuarta variante y sigue siendo el mismo componente", () => {
  const dlg = leer("src/app/finanzas/facturas/_components/reverse-payment-dialog.tsx");
  assert.match(dlg, /variante\?: "cobro" \| "pago" \| "gasto" \| "asiento";/);
  assert.match(dlg, /endpoint: \(id: string\) => `\/api\/finanzas\/asientos\/\$\{id\}\/reverse`/);
  assert.match(dlg, /construirAsientoDeReversion/, "la vista previa sigue saliendo de la función pura");
});
