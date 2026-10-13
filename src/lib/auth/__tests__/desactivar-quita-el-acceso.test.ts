/**
 * DESACTIVAR A UN USUARIO LE QUITA EL ACCESO.
 *
 * Medido en staging el 05/10/2026: un contador «desactivado» desde Admin >
 * Usuarios volvía a entrar con su contraseña y /finanzas/reportes respondía
 * 200. `active` sólo vivía en `public.users`, que ni el login ni el middleware
 * leen. Ver src/lib/auth/acceso-de-usuario.ts.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  banDurationPara,
  sincronizarAccesoEnAuth,
  BLOQUEO_DE_USUARIO_INACTIVO,
} from "@/lib/auth/acceso-de-usuario";

const ROOT = resolve(__dirname, "../../../..");
const ruta = readFileSync(resolve(ROOT, "src/app/api/admin/users/[id]/route.ts"), "utf8").replace(/\r\n/g, "\n");

test("inactivo = bloqueado en Auth; activo = sin bloqueo", () => {
  assert.equal(banDurationPara(false), BLOQUEO_DE_USUARIO_INACTIVO);
  assert.equal(banDurationPara(true), "none");
});

test("sincronizarAccesoEnAuth manda el ban_duration y devuelve el error de Auth", async () => {
  const llamadas: unknown[] = [];
  const ok = { auth: { admin: { updateUserById: async (id: string, a: { ban_duration: string }) => { llamadas.push([id, a]); return { error: null }; } } } };
  assert.equal(await sincronizarAccesoEnAuth(ok, "u1", false), null);
  assert.deepEqual(llamadas, [["u1", { ban_duration: BLOQUEO_DE_USUARIO_INACTIVO }]]);
  const mal = { auth: { admin: { updateUserById: async () => ({ error: { message: "caído" } }) } } };
  assert.equal(await sincronizarAccesoEnAuth(mal, "u1", true), "caído");
});

function cuerpo(metodo: "PATCH" | "DELETE") {
  const i = ruta.indexOf(`export const ${metodo} =`);
  const fin = ruta.indexOf("export const ", i + 10);
  return ruta.slice(i, fin === -1 ? undefined : fin);
}

test("🔴 «Desactivar» (DELETE) bloquea en Auth ANTES de marcar inactivo", () => {
  const d = cuerpo("DELETE");
  const bloqueo = d.indexOf("sincronizarAccesoEnAuth(admin, targetId, false)");
  const perfil = d.indexOf("update({ active: false");
  assert.ok(bloqueo > -1, "DELETE no bloquea en Auth");
  assert.ok(perfil > bloqueo, "el perfil se marca inactivo antes de bloquear el acceso");
});

test("🔴 PATCH con `active` mueve el acceso en Auth antes del perfil (reactivar desbloquea)", () => {
  const p = cuerpo("PATCH");
  const sync = p.indexOf("sincronizarAccesoEnAuth(admin, targetId, Boolean(updates.active))");
  const perfil = p.indexOf('.from("users")\n      .update(updates)');
  assert.ok(sync > -1, "PATCH no sincroniza el acceso");
  assert.ok(perfil > sync, "el perfil cambia antes que el acceso");
});
