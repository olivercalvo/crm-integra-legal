/**
 * CLONAR UN ASIENTO (Bloque 7, commit 5 — D7).
 *
 * Josuarth: «abrís un asiento viejo, le das copiar, y te queda uno igual donde
 * solo cambiás los montos».
 *
 *   1. El clon **arrastra los montos**, las descripciones y los terceros. Si
 *      llegara en cero habría que teclearlo entero y el botón no ahorraría nada.
 *   2. 🔴 La fecha es la de HOY, nunca la del original: puede caer en un mes
 *      cerrado y el rechazo del RPC parecería un bug del botón.
 *   3. Solo se clonan asientos `manual`, y solo hasta el tope del formulario
 *      (D9): un asiento de 200 líneas entró por el importador y por ahí vuelve.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  borradoresDesdeAsiento,
  armarAsientoManual,
  MAX_LINEAS_MANUALES,
} from "@/lib/finanzas/contabilidad/asiento-manual";

const ORIGEN = [
  {
    account_code: "100004",
    debit: 12,
    credit: 0,
    descripcion: "Ajuste CxC",
    terceroClave: "cliente:c1",
  },
  {
    account_code: "200001",
    debit: 0,
    credit: 12,
    descripcion: null,
    terceroClave: "proveedor:s1",
  },
];

test("el clon arrastra montos, descripciones y terceros", () => {
  const b = borradoresDesdeAsiento(ORIGEN);

  assert.equal(b.length, 2);
  assert.equal(b[0].account_code, "100004");
  assert.equal(b[0].debit, "12.00", "el monto viene puesto, no en cero");
  assert.equal(b[0].credit, "", "el otro lado, vacío");
  assert.equal(b[0].description, "Ajuste CxC");
  assert.equal(b[0].tercero, "cliente:c1");
  assert.equal(b[1].credit, "12.00");
  assert.equal(b[1].description, "", "una línea sin glosa no inventa una");
  assert.equal(b[1].tercero, "proveedor:s1");
});

test("el clon vuelve a pasar por el mismo armador y sale igual que el original", () => {
  const r = armarAsientoManual(borradoresDesdeAsiento(ORIGEN));
  assert.ok(r.ok);
  assert.equal(r.lineas.length, 2);
  assert.equal(r.lineas[0].debit, 12);
  assert.equal(r.lineas[0].client_id, "c1");
  assert.equal(r.lineas[1].credit, 12);
  assert.equal(r.lineas[1].supplier_id, "s1");
  assert.equal(r.totales.cuadra, true);
});

test("las claves de línea del clon no chocan con las del editor vacío", () => {
  const b = borradoresDesdeAsiento(ORIGEN);
  assert.equal(new Set(b.map((l) => l.key)).size, b.length, "claves únicas");
  assert.ok(b.every((l) => l.key.startsWith("clon-")));
});

test("🔴 la fecha NO se clona: la pone la pantalla, y es la de hoy", () => {
  // `borradoresDesdeAsiento` ni siquiera recibe la fecha: no hay forma de que
  // se le escape. Y el formulario arranca en `hoy`, con el motivo escrito.
  const src = readFileSync(
    join(process.cwd(), "src/lib/finanzas/contabilidad/asiento-manual.ts"),
    "utf8"
  );
  const fn = src.slice(src.indexOf("export function borradoresDesdeAsiento"));
  assert.doesNotMatch(fn.slice(0, 400), /transaction_date|fecha/i);

  const form = readFileSync(
    join(process.cwd(), "src/app/finanzas/asientos/_components/asiento-manual-form.tsx"),
    "utf8"
  );
  assert.match(form, /SIEMPRE la de hoy, también en un clon/);
  assert.match(form, /const \[fecha, setFecha\] = useState\(hoy\);/);
  assert.match(form, /La fecha es la de hoy<\/strong>, no la del/);
});

test("la pantalla solo clona asientos manuales, y no más de lo que el formulario admite", () => {
  const page = readFileSync(join(process.cwd(), "src/app/finanzas/asientos/page.tsx"), "utf8");
  assert.match(page, /origen\.source_type !== "manual"/);
  assert.match(page, /salió de un documento/);
  assert.match(page, /origen\.lineas\.length > MAX_LINEAS_MANUALES/);
  assert.equal(MAX_LINEAS_MANUALES, 100);

  // Y el botón vive solo en los manuales.
  const detalle = readFileSync(
    join(process.cwd(), "src/app/finanzas/asientos/[id]/page.tsx"),
    "utf8"
  );
  assert.match(detalle, /\{esManual && \(\s*<Link\s*\n?\s*href=\{`\/finanzas\/asientos\?clonar=\$\{asiento\.id\}`\}/);
});
