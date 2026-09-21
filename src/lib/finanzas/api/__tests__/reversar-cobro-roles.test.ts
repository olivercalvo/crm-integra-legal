/**
 * QUIÉN PUEDE REVERSAR UN COBRO: el guard de la ruta y la bandera de la
 * pantalla dicen lo mismo.
 *
 * El contador reversa (17/09/2026) por el mismo criterio de la guía de RM que
 * le da los asientos manuales y los períodos: corregir el libro es su trabajo.
 * Pero NO registra ni elimina cobros. Son dos banderas —`canMutate` y
 * `canReverse`— y este test existe para que no se fusionen por accidente ni se
 * separen del guard del servidor: ocultar el botón no reemplaza al 403, y el
 * 403 no reemplaza a ocultar el botón (CLAUDE.md §4).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const leer = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const RUTA_REVERSAR = "src/app/api/finanzas/payments/[id]/reverse/route.ts";
const RUTA_ELIMINAR = "src/app/api/finanzas/payments/[id]/route.ts";
const RUTA_REGISTRAR = "src/app/api/finanzas/invoices/[id]/payments/route.ts";
const RUTA_REGISTRAR_MULTI = "src/app/api/finanzas/payments/route.ts";
// Pagos a PROVEEDORES (Bloque 3): su guard es el de MUTAR compras, donde el
// contador SÍ entra (CRUD en Gastos del Bufete desde el 24/08).
const RUTA_COMPRAS = "src/app/api/finanzas/business-expenses/route.ts";
const RUTA_PAGO_PROV_CREAR = "src/app/api/finanzas/business-expenses/[id]/payments/route.ts";
const RUTA_PAGO_PROV_BORRAR = "src/app/api/finanzas/supplier-payments/[id]/route.ts";
const RUTA_PAGO_PROV_REVERSAR = "src/app/api/finanzas/supplier-payments/[id]/reverse/route.ts";
const PAGINA = "src/app/finanzas/facturas/[id]/page.tsx";
const SECCION = "src/app/finanzas/facturas/_components/payments-section.tsx";

function rolesDelGuard(src: string): string[] {
  const m = src.match(/if \(!\[([^\]]+)\]\.includes\(ctx\.userRole\)\)/);
  assert.ok(m, "no se encontró el guard de rol con el patrón esperado");
  return m[1].split(",").map((s) => s.trim().replace(/"/g, ""));
}

test("reversar: admin, abogada y contador. Asistente no", () => {
  assert.deepEqual(rolesDelGuard(leer(RUTA_REVERSAR)), ["admin", "abogada", "contador"]);
});

test("registrar un cobro es admin y abogada: el contador NO, aunque desde el 21/09 vea el listado", () => {
  assert.deepEqual(rolesDelGuard(leer(RUTA_REGISTRAR)), ["admin", "abogada"]);
  // La ruta multi-factura (Parte B) tiene EXACTAMENTE el mismo guard: son dos
  // puertas a la misma createPayment.
  assert.deepEqual(rolesDelGuard(leer(RUTA_REGISTRAR_MULTI)), ["admin", "abogada"]);
});

test("eliminar un cobro sigue siendo admin y abogada: el contador NO", () => {
  assert.deepEqual(rolesDelGuard(leer(RUTA_ELIMINAR)), ["admin", "abogada"]);
});

test("la pantalla tiene canReverse aparte de canMutate, y solo canReverse incluye al contador", () => {
  const src = leer(PAGINA);
  assert.match(src, /const canMutate = puedeAccionar;/);
  assert.match(src, /const canReverse = puedeAccionar \|\| userRole === "contador";/);
  assert.match(src, /canReverse=\{canReverse\}/, "y se la pasa a la sección de pagos");
});

test("la sección ofrece Reversar solo con asiento, y Eliminar solo sin asiento", () => {
  const src = leer(SECCION);
  assert.match(src, /canReverse && p\.status === "registrado" && !!p\.asiento/);
  assert.match(src, /canMutate && p\.status === "registrado" && !p\.asiento/);
});

function rolesConst(src: string, nombre: string): string[] {
  const m = src.match(new RegExp("const " + nombre + " = \\[([^\\]]+)\\] as const;"));
  assert.ok(m, `no se encontró ${nombre}`);
  return m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
}

test("pagos a proveedor: crear, borrar y reversar tienen EXACTAMENTE los roles de mutar compras (contador incluido)", () => {
  const compras = rolesConst(leer(RUTA_COMPRAS), "MUTATING_ROLES");
  assert.deepEqual(compras, ["admin", "abogada", "contador"]);
  for (const ruta of [RUTA_PAGO_PROV_CREAR, RUTA_PAGO_PROV_BORRAR, RUTA_PAGO_PROV_REVERSAR]) {
    assert.deepEqual(rolesConst(leer(ruta), "MUTATING_ROLES"), compras, ruta);
  }
});

test("la ruta vieja /mark-paid ya no existe (FND-009): el pago es una entidad", () => {
  assert.equal(
    existsSync(join(ROOT, "src/app/api/finanzas/business-expenses/[id]/mark-paid/route.ts")),
    false
  );
});
