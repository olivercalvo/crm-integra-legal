/**
 * 🔒 EL ANCLA EXTERNA DE LA CADENA (R-1b, migración 075).
 *
 *   1. Del archivo del respaldo se toman SÓLO las anclas del bufete de quien
 *      verifica: el respaldo trae todos los bufetes.
 *   2. Un archivo mal formado se rechaza con un mensaje, nunca con 500.
 *   3. El ancla la graba la BASE al cerrar (trigger de la 075); la ruta no la
 *      escribe, y la verificación va por el RPC con el tenant del perfil.
 *
 *   npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { anclasDesdeArchivo, huellaCorta } from "@/lib/finanzas/contabilidad/anclas";

const RAIZ = path.resolve(__dirname, "../../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const H = "ab".repeat(32);

test("del respaldo se toman sólo las anclas de este bufete", () => {
  const r = anclasDesdeArchivo(
    JSON.stringify([
      { tenant_id: "t1", entry_number: 98, hash: H },
      { tenant_id: "t2", entry_number: 5, hash: H },
      { tenant_id: "t1", entry_number: 106, hash: H.toUpperCase() },
    ]),
    "t1"
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.anclas, [
    { entry_number: 98, hash: H },
    { entry_number: 106, hash: H },
  ]);
  assert.equal(r.ignoradas, 1);
});

test("una lista armada a mano (sin tenant) se acepta", () => {
  const r = anclasDesdeArchivo([{ entry_number: 12, hash: H }], "t1");
  assert.ok(r.ok);
});

test("archivos malos: mensaje claro, nunca excepción", () => {
  for (const malo of ["no es json", "{}", "[]", JSON.stringify([{ entry_number: "x", hash: H }]), JSON.stringify([{ entry_number: 3, hash: "corto" }])]) {
    const r = anclasDesdeArchivo(malo, "t1");
    assert.equal(r.ok, false, malo);
  }
});

test("la huella corta deja ver principio y fin", () => {
  assert.equal(huellaCorta("0123456789abcdef".repeat(4)), "01234567…89abcdef");
});

test("🔒 la ruta de cierre NO escribe el ancla (la graba la base) y la verificación va por el RPC", () => {
  const ruta = leer("src/app/api/finanzas/periodos/route.ts");
  assert.doesNotMatch(ruta, /from\("accounting_chain_anchors"\)\s*\.insert/);
  const verificar = leer("src/app/api/finanzas/periodos/anclas/verificar/route.ts");
  assert.match(verificar, /rpc\("verify_chain_anchors"/);
  assert.match(verificar, /p_tenant_id: ctx\.tenantId/);
  assert.match(verificar, /const ROLES = \["admin", "contador"\]/);
  assert.match(leer("src/app/api/finanzas/periodos/anclas/[id]/pdf/route.ts"), /const ROLES = \["admin", "contador"\]/);
  const sql = leer("sql/pending/075_ancla_de_la_cadena.sql");
  assert.match(sql, /AFTER UPDATE OF status ON public\.accounting_periods/);
  assert.match(sql, /REVOKE ALL ON public\.accounting_chain_anchors FROM PUBLIC, anon, authenticated, service_role/);
});
