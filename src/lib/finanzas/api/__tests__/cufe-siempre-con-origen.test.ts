/**
 * 🔒 TODA ESCRITURA DE `invoices.dgi_cufe` ESCRIBE TAMBIÉN `dgi_cufe_origen`.
 *
 *   npm test
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE TEST EXISTE (25/09/2026)
 * ─────────────────────────────────────────────────────────────────────────────
 * La `061` agregó `dgi_cufe_origen` para distinguir un CUFE que devolvió el PAC
 * (`'crm'`) de uno copiado a mano del portal (`'portal_050'`). Su CHECK decía
 *
 *     dgi_cufe IS NOT NULL AND dgi_cufe_origen IN ('crm', 'portal_050')
 *
 * y eso **deja pasar un origen NULL**: `NULL IN (…)` es NULL, y un CHECK que
 * da NULL se acepta. La base no atajó nada, y `persistAuthorized` nunca
 * escribía el origen. En staging, FAC-HON-000003 y FAC-HON-000017 —emitidas
 * por el CRM el 24/09, después de la `061`— quedaron con CUFE y sin origen:
 * exactamente las filas indistinguibles que la `061` venía a impedir.
 *
 * La `064` corrige el CHECK. Este test cubre el otro lado: si un camino de
 * código escribe el CUFE sin el origen, con el CHECK bueno ese UPDATE falla
 * **después** de que el PAC autorizó — una factura viva ante la DGI y sin su
 * CUFE en nuestra base. Es una regla sobre cómo se escribe el código, así que
 * se lee el código.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { origenDelCufeManual } from "../invoices";

const RAIZ = path.resolve(__dirname, "../../../../..");

function archivosDe(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const p = path.join(dir, nombre);
    if (statSync(p).isDirectory()) {
      if (nombre === "__tests__" || nombre === "node_modules") continue;
      out.push(...archivosDe(p));
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) {
      out.push(p);
    }
  }
  return out;
}

const UPDATE_DE_INVOICES = /\.from\(\s*["']invoices["']\s*\)\s*\.update\(\s*\{([^}]*)\}/g;

test("🔒 cada `.from('invoices').update({ dgi_cufe })` escribe también dgi_cufe_origen", () => {
  let encontrados = 0;
  const faltan: string[] = [];
  for (const archivo of archivosDe(path.join(RAIZ, "src"))) {
    const src = readFileSync(archivo, "utf8");
    for (const m of Array.from(src.matchAll(UPDATE_DE_INVOICES))) {
      const cuerpo = m[1];
      if (!/\bdgi_cufe\s*:/.test(cuerpo)) continue;
      encontrados++;
      if (!/\bdgi_cufe_origen\s*:/.test(cuerpo)) {
        faltan.push(path.relative(RAIZ, archivo));
      }
    }
  }
  // Tres caminos escriben el CUFE hoy: el PAC al autorizar, la carga del
  // caso B y la tarjeta legacy. Si el regex deja de verlos, el test no prueba
  // nada: que falle también en ese caso.
  assert.ok(encontrados >= 3, `se esperaban al menos 3 escrituras de dgi_cufe, se vieron ${encontrados}`);
  assert.deepEqual(faltan, [], `escriben dgi_cufe sin dgi_cufe_origen: ${faltan.join(", ")}`);
});

test("🔒 la 064 cierra el agujero del NULL: el CHECK exige el origen NO nulo", () => {
  const sql = readFileSync(path.join(RAIZ, "sql/pending/064_cufe_origen_no_nulo.sql"), "utf8");
  assert.match(sql, /dgi_cufe IS NOT NULL\s+AND dgi_cufe_origen IS NOT NULL\s+AND dgi_cufe_origen IN/);
});

test("origenDelCufeManual: copiado a mano es portal_050; reguardar el del PAC no lo cambia", () => {
  const delPac = { dgi_cufe: "FE01-X", dgi_cufe_origen: "crm" };
  assert.equal(origenDelCufeManual(delPac, "FE01-X"), "crm");
  assert.equal(origenDelCufeManual(delPac, "FE01-OTRO"), "portal_050");
  assert.equal(origenDelCufeManual(delPac, null), null);
  assert.equal(origenDelCufeManual({ dgi_cufe: null, dgi_cufe_origen: null }, "FE01-Y"), "portal_050");
});
