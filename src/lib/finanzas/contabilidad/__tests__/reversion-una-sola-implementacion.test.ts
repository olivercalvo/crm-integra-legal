/**
 * UNA SOLA IMPLEMENTACIÓN DEL ESPEJO: la pantalla y el servidor usan la misma.
 *
 * Es la lección de `validarConsistenciaDeKind` (17/09/2026), aplicada al
 * asiento de reversión: si el diálogo reimplementa el cálculo para dibujar la
 * vista previa, algún día la vista previa miente sobre lo que se postea — y un
 * asiento no se borra. Este test lee los dos archivos y falla si:
 *
 *   · el diálogo deja de importar `construirAsientoDeReversion` de
 *     `contabilidad/reversion`, o
 *   · el diálogo o el helper del servidor intercambian débito y crédito por su
 *     cuenta (la firma de una reimplementación), o
 *   · el helper del servidor deja de usar la misma función.
 *
 * Y del lado de la base: el RPC `reverse_payment` NO puede recalcular el
 * espejo, solo verificarlo. Se comprueba que la migración no construya líneas
 * (`jsonb_build_object` con `debit`/`credit`) para postearlas.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const leer = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const DIALOGO = "src/app/finanzas/facturas/_components/reverse-payment-dialog.tsx";
const HELPER = "src/lib/finanzas/api/payments.ts";
const RUTA = "src/app/api/finanzas/payments/[id]/reverse/route.ts";
const MIGRACION = "sql/pending/046_reversion_de_cobro.sql";

/** La firma de una reimplementación: asignar el débito desde el crédito o al revés. */
const REIMPLEMENTACION = /\b(debit|debe)\s*:\s*[\w.]*\b(credit|haber)\b|\b(credit|haber)\s*:\s*[\w.]*\b(debit|debe)\b/;

test("el diálogo dibuja la vista previa con construirAsientoDeReversion, importada del módulo puro", () => {
  const src = leer(DIALOGO);
  assert.match(
    src,
    /import\s*\{[^}]*\bconstruirAsientoDeReversion\b[^}]*\}\s*from\s*"@\/lib\/finanzas\/contabilidad\/reversion"/,
    "el diálogo tiene que importar construirAsientoDeReversion de contabilidad/reversion"
  );
  assert.match(src, /construirAsientoDeReversion\(/, "y llamarla");
  assert.doesNotMatch(
    src,
    REIMPLEMENTACION,
    "el diálogo NO intercambia débito y crédito por su cuenta: eso lo hace la función pura"
  );
});

test("el helper del servidor postea lo que devuelve la misma función", () => {
  const src = leer(HELPER);
  assert.match(
    src,
    /import\s*\{[^}]*\bconstruirAsientoDeReversion\b[^}]*\}\s*from\s*"@\/lib\/finanzas\/contabilidad\/reversion"/
  );
  // Lo que va al RPC sale de `armado.asiento`, no de un cálculo propio.
  assert.match(src, /p_lines:\s*armado\.asiento\.lines/);
  assert.match(src, /p_description:\s*armado\.asiento\.description/);
  assert.match(src, /p_transaction_date:\s*armado\.asiento\.transaction_date/);
  assert.doesNotMatch(src, REIMPLEMENTACION);
});

test("la ruta no arma líneas: delega en reversePayment y saca el tenant del contexto", () => {
  const src = leer(RUTA);
  assert.match(src, /reversePayment\(/);
  assert.match(src, /ctx\.tenantId/);
  assert.doesNotMatch(src, /tenant_id/, "el tenant nunca sale del body: la ruta ni lo nombra");
  assert.doesNotMatch(src, REIMPLEMENTACION);
});

test("el RPC verifica el espejo, no lo construye", () => {
  const sql = leer(MIGRACION);
  // Solo en el cuerpo de la función, no en el encabezado de comentarios.
  const cuerpo = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.reverse_payment"));
  assert.match(cuerpo, /EXCEPT ALL/, "compara lo recibido contra el original en los dos sentidos");
  assert.doesNotMatch(
    cuerpo,
    /jsonb_build_object\([^)]*'debit'/,
    "la función NO arma líneas: lo que postea es p_lines, tal como llegó"
  );
  assert.match(cuerpo, /post_journal_entry\(\s*p_tenant_id,\s*p_transaction_date,\s*p_description,\s*'reversion',\s*p_lines/);
});
