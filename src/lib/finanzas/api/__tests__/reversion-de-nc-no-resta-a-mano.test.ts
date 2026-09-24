/**
 * 🔒 LA REVERSIÓN DE UNA NOTA DE CRÉDITO NO SUMA NI RESTA NADA.
 *
 *   npm test
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE TEST EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 * `invoices.credited_total` es DERIVADA desde la `051`: el trigger
 * `trg_recalc_invoice_credited` hace `SUM(grand_total) WHERE status =
 * 'emitida'` y en cascada rehace `balance_due` y el `status` (T7a). La
 * reversión, entonces, no tiene que calcular nada: cambia un estado
 * (`credit_notes.status = 'anulada'`) y los tres números se recalculan solos.
 *
 * El atajo tentador es restar `grand_total` y listo. Funciona la primera vez y
 * crea una SEGUNDA fórmula que algún día discrepa de la primera — y cuando
 * discrepa, el síntoma es el saldo equivocado de una factura, no un error.
 * Peor todavía con dos NC parciales sobre la misma factura, donde restar el
 * total deja el saldo mal sin que nada falle.
 *
 * Esto no lo puede sostener un tipo de TypeScript: es una regla sobre CÓMO se
 * escribe el código. Así que se lee el código, igual que en
 * `ruc-dv-separados.test.ts`.
 *
 * Lo comprobado con datos reales está en
 * `sql/tests/verificacion-060-reversion-nota-de-credito.sql`, que monta dos NC
 * parciales sobre una factura parcialmente pagada, reversa una y verifica que
 * el acreditado quede en la OTRA (3.00 → 1.00) y no en cero.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../../../..");

const leer = (rel: string) => readFileSync(path.resolve(RAIZ, rel), "utf8");

const API = leer("src/lib/finanzas/api/credit-notes.ts");
const MIGRACION = leer("sql/pending/060_reversion_de_nota_de_credito.sql");

/** El cuerpo de `reverseCreditNote`, desde su firma hasta el cierre del archivo. */
function cuerpoDeReverseCreditNote(): string {
  const i = API.indexOf("export async function reverseCreditNote");
  assert.ok(i > 0, "no se encontró reverseCreditNote: ¿se renombró?");
  return API.slice(i);
}

test("🔒 `reverseCreditNote` no escribe credited_total, balance_due ni el status de la factura", () => {
  const cuerpo = cuerpoDeReverseCreditNote();
  for (const campo of ["credited_total", "balance_due"]) {
    // Leerlos del resultado del RPC está bien; escribirlos, no.
    const escrituras = [
      new RegExp(`${campo}\\s*[:=]\\s*[^,)\\n]*[-+]`), // credited_total: algo - algo
      new RegExp(`update\\([^)]*${campo}`, "i"),
      new RegExp(`\\.update\\(\\s*\\{[^}]*${campo}`, "is"),
    ];
    for (const re of escrituras) {
      assert.ok(
        !re.test(cuerpo),
        `reverseCreditNote parece escribir o calcular \`${campo}\` (${re}). ` +
          "Lo deriva el trigger de la 051: la reversión sólo cambia el status de la NC."
      );
    }
  }
  assert.ok(
    !/from\(["']invoices["']\)[\s\S]{0,200}\.update\(/.test(cuerpo),
    "reverseCreditNote no debe hacer UPDATE sobre `invoices`: la factura se recalcula sola."
  );
});

test("🔒 el RPC de la migración tampoco los escribe", () => {
  const i = MIGRACION.indexOf("CREATE OR REPLACE FUNCTION public.reverse_credit_note");
  assert.ok(i > 0, "no se encontró el RPC en la 060");
  const rpc = MIGRACION.slice(i);
  // Un `UPDATE public.invoices SET ...` dentro del reversor sería la segunda
  // fórmula. El único UPDATE permitido es el de `credit_notes`.
  assert.ok(
    !/UPDATE\s+public\.invoices/i.test(rpc),
    "el RPC hace UPDATE sobre invoices: credited_total y balance_due deben quedar derivados"
  );
  assert.match(
    rpc,
    /UPDATE\s+public\.credit_notes[\s\S]*?status\s*=\s*'anulada'/i,
    "el RPC tiene que marcar la NC anulada: es lo único que dispara el recálculo"
  );
});

test("🔒 la migración se verifica a sí misma sobre esta regla", () => {
  // No alcanza con que el test lo mire: la migración aborta si el reversor
  // escribe los derivados, así que la regla viaja con el .sql a cualquier base.
  assert.match(
    MIGRACION,
    /position\('credited_total ='[\s\S]{0,200}RAISE EXCEPTION/,
    "el bloque de verificación de la 060 debe abortar si aparece una escritura directa"
  );
});

test("🔒 el espejo lo arma `construirAsientoDeReversion`, no una fórmula propia", () => {
  const cuerpo = cuerpoDeReverseCreditNote();
  assert.match(
    cuerpo,
    /construirAsientoDeReversion\(/,
    "la reversión de la NC tiene que usar la MISMA función que las otras cuatro y que la vista previa"
  );
  // La lección de `validarConsistenciaDeKind`: si acá se reimplementa el
  // espejo, algún día la vista previa del diálogo miente.
  assert.ok(
    !/debit:\s*[a-z_.]+\.credit/i.test(cuerpo),
    "reverseCreditNote parece dar vuelta las líneas por su cuenta en vez de delegar"
  );
});

test("🔒 una NC sin asiento propio se rechaza en los DOS lados", () => {
  const cuerpo = cuerpoDeReverseCreditNote();
  assert.match(
    cuerpo,
    /getAsientoDeNotaDeCredito\([\s\S]{0,200}if\s*\(!original\)/,
    "la app tiene que cortar antes de llamar al RPC"
  );
  assert.match(
    MIGRACION,
    /no tiene asiento propio/,
    "y el RPC tiene que cortarlo también, por si alguien lo llama directo"
  );
});
