/**
 * EL TERCERO EN EL FORMULARIO DE ASIENTO (Bloque 7, commit 2).
 *
 *   1. `parseTercero` traduce el valor del `<select>` a las dos columnas de la
 *      línea, y **nunca devuelve las dos cargadas**: es la razón de que la
 *      pantalla use UN campo y no dos.
 *   2. `armarAsientoManual` lo pasa a la línea que va al RPC.
 *   3. Una fila con SOLO tercero NO se descarta: se le reclama la cuenta, igual
 *      que a una con solo glosa. Elegir un tercero es tocar la fila a propósito.
 *   4. 🔴 D9: `MAX_LINEAS_MANUALES` es el tope del FORMULARIO, y está dicho en
 *      el código para que nadie lo "unifique" con el importador.
 *   5. D2: el mensaje de un cliente o proveedor que aparece en el libro habla
 *      del libro, no de una constraint.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  armarAsientoManual,
  parseTercero,
  valorDeTercero,
  MAX_LINEAS_MANUALES,
  type LineaManualDraft,
} from "@/lib/finanzas/contabilidad/asiento-manual";
import { buildLedgerBlockMessage } from "@/lib/clients/delete-guards";

const CLI = "11111111-1111-1111-1111-111111111111";
const PROV = "22222222-2222-2222-2222-222222222222";

function linea(over: Partial<LineaManualDraft> = {}): LineaManualDraft {
  return {
    key: "k" + Math.random(),
    account_code: "100004",
    debit: "",
    credit: "",
    description: "",
    tercero: "",
    ...over,
  };
}

test("parseTercero: cliente, proveedor, vacío y basura — nunca los dos a la vez", () => {
  assert.deepEqual(parseTercero(valorDeTercero("cliente", CLI)), { client_id: CLI, supplier_id: null });
  assert.deepEqual(parseTercero(valorDeTercero("proveedor", PROV)), { client_id: null, supplier_id: PROV });
  for (const v of ["", "   ", "cliente:", ":algo", "otracosa:x", "sin-separador", null, undefined]) {
    assert.deepEqual(parseTercero(v), { client_id: null, supplier_id: null }, `valor: ${String(v)}`);
  }
});

test("armarAsientoManual lleva el tercero a la línea del RPC", () => {
  const r = armarAsientoManual([
    linea({ debit: "10", tercero: valorDeTercero("cliente", CLI) }),
    linea({ account_code: "200001", credit: "10", tercero: valorDeTercero("proveedor", PROV) }),
    linea({ account_code: "", debit: "0", credit: "0" }),
  ]);
  assert.ok(r.ok);
  assert.equal(r.lineas.length, 2, "la tercera está intacta y se descarta");
  assert.equal(r.lineas[0].client_id, CLI);
  assert.equal(r.lineas[0].supplier_id, null);
  assert.equal(r.lineas[1].supplier_id, PROV);
  assert.equal(r.lineas[1].client_id, null);
});

test("una línea sin tercero manda null en los dos campos, no `undefined`", () => {
  const r = armarAsientoManual([linea({ debit: "5" }), linea({ account_code: "200001", credit: "5" })]);
  assert.ok(r.ok);
  for (const l of r.lineas) {
    assert.equal(l.client_id, null);
    assert.equal(l.supplier_id, null);
  }
});

test("una fila con SOLO tercero no se descarta: se pide la cuenta, como con la descripción", () => {
  // Elegir un tercero es tocar la fila a propósito, igual que escribir una
  // glosa. El formulario ya trata una glosa suelta así: reclama la cuenta en
  // vez de tirar la fila en silencio. El tercero sigue esa misma regla —si
  // alguna vez se separan, una de las dos va a sorprender a alguien.
  const r = armarAsientoManual([
    linea({ debit: "5" }),
    linea({ account_code: "200001", credit: "5" }),
    linea({ account_code: "", tercero: valorDeTercero("cliente", CLI) }),
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /sin cuenta contable/);

  // Y con la glosa suelta pasa exactamente lo mismo: es el precedente.
  const conGlosa = armarAsientoManual([
    linea({ debit: "5" }),
    linea({ account_code: "200001", credit: "5" }),
    linea({ account_code: "", description: "algo" }),
  ]);
  assert.equal(conGlosa.ok, false);
});

test("🔴 D9: el tope de 100 líneas es del FORMULARIO y el código lo dice", () => {
  assert.equal(MAX_LINEAS_MANUALES, 100);
  const src = readFileSync(
    join(process.cwd(), "src/lib/finanzas/contabilidad/asiento-manual.ts"),
    "utf8"
  );
  assert.match(src, /tope de ESTA pantalla, no del libro/i);
  assert.match(src, /importador de\s*\n?\s*\*\s*Excel|importador de Excel/i);
});

test("D2: el bloqueo por el libro nombra al libro y no promete que se destrabe", () => {
  assert.equal(buildLedgerBlockMessage(0), null);
  assert.equal(buildLedgerBlockMessage(null), null);
  const msg = buildLedgerBlockMessage(3) ?? "";
  assert.match(msg, /asiento del libro contable/);
  assert.match(msg, /inmutable/);
  assert.match(msg, /Desactívalo/);
  assert.doesNotMatch(msg, /constraint|violates|foreign key/i);

  // Y la ruta lo usa ANTES de borrar documentos, como los otros conteos.
  const ruta = readFileSync(join(process.cwd(), "src/app/api/clients/[id]/delete/route.ts"), "utf8");
  const iLibro = ruta.indexOf("buildLedgerBlockMessage");
  const iDocs = ruta.indexOf("Delete documents from storage");
  assert.ok(iLibro > 0 && iDocs > 0 && iLibro < iDocs, "el conteo del libro va antes de borrar nada");

  // El proveedor tiene su propio mensaje, con el mismo criterio.
  const prov = readFileSync(join(process.cwd(), "src/lib/finanzas/api/suppliers.ts"), "utf8");
  assert.match(prov, /journal_entry_lines/);
  assert.match(prov, /línea\(s\) de asiento del libro contable/);
});
