/**
 * Bitácoras de auditoría: lo que la app hace con las filas (03/10/2026).
 * La captura y la cadena viven en la base (086/087) y se prueban en staging.
 *
 * Ejecución:  npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  cambiosLegibles,
  filtrosDesdeParams,
  hojaDeBitacora,
  horaDePanama,
  inicioDelDiaEnPanama,
  LECTORES,
  GRUPOS,
  type FilaBitacora,
} from "@/lib/auditoria/bitacoras";
import { puedeAccederA } from "@/lib/auth/route-access";

const fila = (over: Partial<FilaBitacora> = {}): FilaBitacora => ({
  id: 1,
  evento_id: "e1",
  ocurrido_en: "2026-10-04T00:30:00Z",
  usuario_id: "u1",
  usuario_nombre: "Elías",
  rol: "contador",
  accion: "editar",
  tabla: "clients",
  registro_id: "c1",
  documento: "CLI-003",
  cambios: { digito_verificador: ["06", "07"], ruc: [null, "8-1-1"] },
  origen: "usuario",
  ...over,
});

test("la hora se muestra en Panamá: 00:30 UTC del 4 es el 3 a las 19:30", () => {
  assert.equal(horaDePanama("2026-10-04T00:30:00Z"), "03/10/2026 19:30");
  assert.equal(inicioDelDiaEnPanama("2026-10-03"), "2026-10-03T00:00:00-05:00");
});

test("los filtros de la URL que no tienen forma se ignoran", () => {
  const f = filtrosDesdeParams("contable", {
    desde: "2026-10-01", hasta: "ayer", usuario: "x", accion: "borrar_todo", grupo: "ventas", documento: "  FAC ", origen: "sistema",
  });
  assert.deepEqual(f, { desde: "2026-10-01", grupo: "ventas", documento: "FAC", origen: "sistema" });
  assert.equal(filtrosDesdeParams("legal", { grupo: "ventas" }).grupo, undefined, "ventas no es un grupo legal");
});

test("los cambios se leen como «campo: antes → después» y sin «—»", () => {
  const l = cambiosLegibles(fila().cambios);
  assert.deepEqual(l, ["digito_verificador: 06 → 07", "ruc: 8-1-1"]);
  assert.ok(l.every((x) => !x.includes("—")));
});

test("el Excel tiene una fila por campo y celdas vacías donde no hay dato", () => {
  const h = hojaDeBitacora("contable", [fila(), fila({ id: 2, cambios: {} })], "Sin filtros.");
  assert.equal(h.filas.length, 3);
  assert.deepEqual(h.filas[1][8], { tipo: "vacia" }, "el antes del RUC estaba vacío");
  assert.deepEqual(h.filas[2][7], { tipo: "vacia" });
});

test("🔒 quién ve cada bitácora coincide con el middleware", () => {
  for (const rol of ["admin", "abogada", "asistente", "contador"] as const) {
    assert.equal(puedeAccederA(rol, "/finanzas/auditoria"), LECTORES.contable.includes(rol), `contable ${rol}`);
    assert.equal(puedeAccederA(rol, "/legal/admin/auditoria"), LECTORES.legal.includes(rol), `legal ${rol}`);
  }
});

test("🔒 cada tabla con trigger de la 087 está en algún grupo de su pantalla", () => {
  const sql = readFileSync("sql/pending/087_bitacoras_captura.sql", "utf8");
  const pares = Array.from(sql.matchAll(/\('([a-z_]+)', '(contable|legal|mixto)'\)/g)).map((m) => [m[1], m[2]])
    .filter(([t]) => !["contable", "legal", "mixto"].includes(t));
  assert.ok(pares.length >= 40);
  const en = (modulo: "contable" | "legal", t: string) =>
    Object.values(GRUPOS[modulo]).some((g) => g.tablas.includes(t));
  for (const [t, modo] of pares) {
    if (modo !== "legal") assert.ok(en("contable", t), `${t} no tiene grupo en la contable`);
    if (modo !== "contable") assert.ok(en("legal", t), `${t} no tiene grupo en la legal`);
  }
});
