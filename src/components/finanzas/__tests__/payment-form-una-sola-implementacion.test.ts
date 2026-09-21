/**
 * UNA SOLA IMPLEMENTACIÓN DEL FORMULARIO DE COBRO.
 *
 * Desde el Bloque 2 (21/09/2026) un cobro se registra desde dos puertas —el
 * diálogo del detalle de la factura y el alta de `/finanzas/cobros/nuevo`— y
 * las dos pegan a la misma ruta y a la misma `createPayment`. Si cada pantalla
 * tuviera sus propios campos y su propia validación, divergirían el día que
 * alguien arregle una (la lección de `validarConsistenciaDeKind`).
 *
 * Este test lee los archivos y falla si alguna puerta:
 *   · deja de importar `PaymentFormFields` + `validatePaymentForm` +
 *     `toPaymentPayload` del módulo compartido, o
 *   · vuelve a declarar su propio `<input id="amount"` / `id="payment_account_code"`, o
 *   · arma el body a mano (`payment_account_code:` dentro de un JSON.stringify propio).
 *
 * La lista de PUERTAS es explícita: cuando se agregue una pantalla que registre
 * cobros, se suma acá. Un archivo que no está en la lista no está vigilado.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const leer = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const COMPARTIDO = "src/components/finanzas/cobros/payment-form-fields.tsx";

/** Toda pantalla que registra un cobro. */
const PUERTAS = [
  "src/app/finanzas/facturas/_components/register-payment-dialog.tsx",
  // El alta de /finanzas/cobros/nuevo se suma en el commit 5 del Bloque 2.
  "src/app/finanzas/cobros/nuevo/_components/nuevo-cobro-form.tsx",
].filter((rel) => existsSync(join(ROOT, rel)));

const IMPORT_COMPARTIDO =
  /import\s*\{[^}]*\}\s*from\s*"@\/components\/finanzas\/cobros\/payment-form-fields"/;

test("hay al menos una puerta vigilada (el diálogo del detalle de factura existe)", () => {
  assert.ok(
    PUERTAS.includes("src/app/finanzas/facturas/_components/register-payment-dialog.tsx"),
    "el diálogo se movió: actualizar la lista PUERTAS"
  );
});

for (const rel of PUERTAS) {
  test(`${rel}: usa PaymentFormFields, validatePaymentForm y toPaymentPayload del módulo compartido`, () => {
    const src = leer(rel);
    assert.match(src, IMPORT_COMPARTIDO, "tiene que importar del módulo compartido");
    for (const nombre of ["PaymentFormFields", "validatePaymentForm", "toPaymentPayload"]) {
      assert.match(
        src,
        new RegExp(`import\\s*\\{[^}]*\\b${nombre}\\b[^}]*\\}\\s*from\\s*"@\\/components\\/finanzas\\/cobros\\/payment-form-fields"`),
        `importa ${nombre}`
      );
      assert.match(src, new RegExp(`\\b${nombre}\\b[\\s(<]`), `y lo usa`);
    }
  });

  test(`${rel}: NO declara sus propios campos ni arma el body a mano`, () => {
    const src = leer(rel);
    assert.doesNotMatch(src, /id=["']amount["']/, "el campo monto vive en PaymentFormFields");
    assert.doesNotMatch(
      src,
      /id=["']payment_account_code["']/,
      "el selector de banco vive en PaymentFormFields"
    );
    assert.doesNotMatch(src, /PAYMENT_METHODS\.map/, "el selector de método vive en PaymentFormFields");
    assert.doesNotMatch(
      src,
      /payment_account_code\s*:\s*\w/,
      "el body lo arma toPaymentPayload, no la pantalla"
    );
    assert.doesNotMatch(
      src,
      /function\s+validate\s*\(/,
      "la validación de cliente es validatePaymentForm"
    );
  });
}

test("el módulo compartido replica la regla del servidor: banco obligatorio y cap por saldo", () => {
  const src = leer(COMPARTIDO);
  assert.match(src, /payment_account_code\s*=\s*"Elija la cuenta bancaria/);
  assert.match(src, /amountNum\s*>\s*balanceDue\s*\+\s*0\.001/);
  // Sin default de banco, a propósito (Rose, 25/08).
  assert.match(src, /payment_account_code:\s*""/);
});
