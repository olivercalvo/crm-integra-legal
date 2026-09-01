/**
 * Tests del candado que impide que salga correo real fuera de producción.
 *
 * POR QUÉ EXISTE
 *   `EMAIL_FROM` es un dominio real y verificado del bufete. Un correo mandado
 *   desde staging llega indistinguible de uno auténtico. Antes del 01/09/2026 la
 *   única defensa era que `RESEND_API_KEY` no estuviera cargada — y en Vercel
 *   está en *All Environments*, así que los deploys de Preview sí la tienen.
 *
 *   Este test fija el comportamiento antes de darle acceso a staging a alguien
 *   de afuera del equipo.
 *
 * Ejecución:
 *   npx tsx --test src/lib/email/__tests__/candado-ambiente.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { assertRealEmailAllowed, EMAIL_FROM } from "@/lib/email/resend";

/** Corre `fn` con unas env vars puestas y deja el proceso como estaba. */
function conEntorno(vars: Record<string, string | undefined>, fn: () => void): void {
  const previo: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previo[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(previo)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("el remitente sigue siendo una dirección REAL del bufete", () => {
  // Si esto cambiara a un dominio de pruebas, el candado dejaría de ser
  // necesario — y este test tendría que reescribirse a propósito, no caerse.
  assert.match(EMAIL_FROM, /@integra-panama\.com/);
});

test("en staging NO se envía", () => {
  conEntorno({ NEXT_PUBLIC_APP_ENV: "staging", ALLOW_REAL_EMAILS: undefined }, () => {
    assert.throws(() => assertRealEmailAllowed(), /desactivado en el ambiente de pruebas/i);
  });
});

test("en local NO se envía", () => {
  conEntorno({ NEXT_PUBLIC_APP_ENV: "local", ALLOW_REAL_EMAILS: undefined }, () => {
    assert.throws(() => assertRealEmailAllowed(), /desactivado en el ambiente de pruebas/i);
  });
});

test("con el entorno SIN DEFINIR tampoco se envía (ante la duda, no sale)", () => {
  conEntorno(
    {
      NEXT_PUBLIC_APP_ENV: undefined,
      NEXT_PUBLIC_SUPABASE_URL: "https://xtyenhakplrkyifbcaow.supabase.co",
      ALLOW_REAL_EMAILS: undefined,
    },
    () => {
      assert.throws(() => assertRealEmailAllowed());
    }
  );
});

test("el mensaje explica que lo demás SÍ funcionó, para que nadie lo lea como una falla", () => {
  conEntorno({ NEXT_PUBLIC_APP_ENV: "staging", ALLOW_REAL_EMAILS: undefined }, () => {
    try {
      assertRealEmailAllowed();
      assert.fail("tenía que tirar");
    } catch (err) {
      const msg = (err as Error).message;
      assert.match(msg, /enlace público/i, "el usuario tiene que saber que el enlace sirve igual");
      assert.match(msg, /a propósito/i, "tiene que quedar claro que no es un error del sistema");
    }
  });
});

test("en producción se envía", () => {
  conEntorno({ NEXT_PUBLIC_APP_ENV: "production" }, () => {
    assert.doesNotThrow(() => assertRealEmailAllowed());
  });
});

test("la válvula ALLOW_REAL_EMAILS=1 abre el paso en staging", () => {
  conEntorno({ NEXT_PUBLIC_APP_ENV: "staging", ALLOW_REAL_EMAILS: "1" }, () => {
    assert.doesNotThrow(() => assertRealEmailAllowed());
  });
});

test("la válvula solo abre con el valor exacto '1', no con cualquier cosa", () => {
  for (const valor of ["true", "yes", "0", "", "si"]) {
    conEntorno({ NEXT_PUBLIC_APP_ENV: "staging", ALLOW_REAL_EMAILS: valor }, () => {
      assert.throws(
        () => assertRealEmailAllowed(),
        `ALLOW_REAL_EMAILS="${valor}" no debería abrir el candado`
      );
    });
  }
});
