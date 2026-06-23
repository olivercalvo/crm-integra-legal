/**
 * Unit tests de validateUpdateQuote (hotfix XOR cliente, Sprint actual).
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/api/__tests__/validate-update-quote.test.ts
 *
 * Cubre los 6 casos del XOR cliente_id / new_prospect en update:
 *   1. solo new_prospect válido → ok + normaliza trims.
 *   2. solo client_id válido    → ok.
 *   3. ambos presentes          → error XOR.
 *   4. ninguno presente         → ok (no cambia el cliente).
 *   5. new_prospect.email inválido → error prefijado new_prospect.email.
 *   6. client_id UUID mal formado → error "Cliente inválido".
 *
 * Patrón consistente con map-invoice.test.ts: node:test + assert/strict,
 * sin frameworks externos. Path alias @/ resuelve vía tsconfig.paths con tsx.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validateUpdateQuote } from "@/lib/finanzas/api/quotes";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("1. solo new_prospect válido → ok + normaliza trims", () => {
  const result = validateUpdateQuote({
    new_prospect: {
      name: "  ROLANDO MCLEAN  ",
      email: "  mclean21@hotmail.com  ",
      client_type: "persona_natural",
    },
  });

  assert.equal(result.ok, true, `esperaba ok=true, errors: ${JSON.stringify(result.errors)}`);
  if (!result.ok) return; // type guard para TS
  assert.equal(result.data.client_id, undefined, "client_id debe quedar undefined");
  assert.ok(result.data.new_prospect, "new_prospect debe estar presente");
  assert.equal(result.data.new_prospect!.name, "ROLANDO MCLEAN", "name trimmed");
  assert.equal(
    result.data.new_prospect!.email,
    "mclean21@hotmail.com",
    "email trimmed"
  );
  assert.equal(
    result.data.new_prospect!.client_type,
    "persona_natural",
    "client_type preservado"
  );
});

test("2. solo client_id válido → ok", () => {
  const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
  const result = validateUpdateQuote({ client_id: VALID_UUID });

  assert.equal(result.ok, true, `esperaba ok=true, errors: ${JSON.stringify(result.errors)}`);
  if (!result.ok) return;
  assert.equal(result.data.client_id, VALID_UUID);
  assert.equal(result.data.new_prospect, undefined, "new_prospect debe quedar undefined");
});

test("3. ambos (client_id + new_prospect) → error XOR", () => {
  const result = validateUpdateQuote({
    client_id: "550e8400-e29b-41d4-a716-446655440000",
    new_prospect: {
      name: "Cliente Nuevo",
      email: "nuevo@ejemplo.com",
      client_type: "persona_natural",
    },
  });

  assert.equal(result.ok, false, "esperaba ok=false por XOR violado");
  if (result.ok) return;
  assert.ok(
    result.errors.client_id,
    `esperaba errors.client_id, recibido: ${JSON.stringify(result.errors)}`
  );
  assert.match(
    result.errors.client_id,
    /cliente existente.*o.*cliente nuevo/i,
    `mensaje XOR no coincide, recibido: '${result.errors.client_id}'`
  );
});

test("4. ninguno (objeto vacío) → ok, no cambia cliente", () => {
  const result = validateUpdateQuote({});

  assert.equal(result.ok, true, `esperaba ok=true, errors: ${JSON.stringify(result.errors)}`);
  if (!result.ok) return;
  assert.equal(result.data.client_id, undefined);
  assert.equal(result.data.new_prospect, undefined);
});

test("5. new_prospect con email inválido → error new_prospect.email", () => {
  const result = validateUpdateQuote({
    new_prospect: {
      name: "TEST",
      email: "no-es-email",
      client_type: "persona_natural",
    },
  });

  assert.equal(result.ok, false, "esperaba ok=false por email inválido");
  if (result.ok) return;
  assert.equal(
    result.errors["new_prospect.email"],
    "Email inválido",
    `esperaba 'Email inválido' en errors["new_prospect.email"], recibido: ${JSON.stringify(result.errors)}`
  );
});

test("6. client_id mal formado → error 'Cliente inválido'", () => {
  const result = validateUpdateQuote({ client_id: "no-es-uuid" });

  assert.equal(result.ok, false, "esperaba ok=false por UUID mal formado");
  if (result.ok) return;
  assert.equal(
    result.errors.client_id,
    "Cliente inválido",
    `esperaba 'Cliente inválido', recibido: '${result.errors.client_id}'`
  );
});
