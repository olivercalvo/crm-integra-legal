/**
 * Tests del manejo de client_type en la importación masiva de clientes.
 *
 * client_type es OBLIGATORIO para emitir FE. La importación lo deriva de la
 * columna "Tipo Fiscal" y, en su defecto, de la legacy "Tipo" (Natural/Jurídica).
 * "Retainer" NO es tipo de persona → debe fallar con mensaje accionable.
 *
 * Ejecución:
 *   npx tsx --test src/lib/utils/__tests__/import-client-type.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import { parseImportFile, validateImport } from "@/lib/utils/import-parser";

/** Arma un .xlsx en memoria con una hoja "Clientes" (aoa: headers + filas). */
function clientsWorkbook(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, sheet, "Clientes");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

const HEADERS = ["Nombre", "RUC/Cédula", "Tipo", "Tipo Fiscal", "Teléfono", "Email"];

test("parse: deriva client_type desde la columna 'Tipo Fiscal'", () => {
  const buf = clientsWorkbook([
    HEADERS,
    ["Empresa ABC, S.A.", "123-1-1", "Retainer", "Jurídica", "", ""],
  ]);
  const { clientRows } = parseImportFile(buf);
  assert.equal(clientRows.length, 1);
  assert.equal(clientRows[0].client_type, "persona_juridica");
  assert.equal(clientRows[0].type, "Retainer"); // legacy intacto
});

test("parse: fallback a la columna legacy 'Tipo' (Natural)", () => {
  const buf = clientsWorkbook([
    HEADERS,
    ["Juan Pérez", "8-888-8", "Natural", "", "", ""],
  ]);
  const { clientRows } = parseImportFile(buf);
  assert.equal(clientRows[0].client_type, "persona_natural");
});

test("validateImport: fila sin tipo reconocible → error accionable, no entra en validClients", () => {
  const buf = clientsWorkbook([
    HEADERS,
    ["Cliente Sin Tipo", "9-9-9", "Retainer", "", "", ""], // Retainer no es persona
    ["Cliente Vacío", "1-1-1", "", "", "", ""], // nada
  ]);
  const { clientRows } = parseImportFile(buf);
  const preview = validateImport(clientRows, [], []);

  const tipoErrors = preview.errors.filter((e) => e.field === "tipo fiscal");
  assert.equal(tipoErrors.length, 2, "ambas filas deben marcar error de tipo");
  assert.match(tipoErrors[0].message, /Natural.*Jurídica|tipo de persona requerido/i);
  assert.equal(preview.clients.length, 0, "ninguna fila inválida debe quedar como válida");
});

test("validateImport: fila válida (Jurídica) → sin error y con client_type", () => {
  const buf = clientsWorkbook([
    HEADERS,
    ["MEI TOWER 2B, S.A", "155-2-2025", "", "Jurídica", "", "mei@x.com"],
  ]);
  const { clientRows } = parseImportFile(buf);
  const preview = validateImport(clientRows, [], []);
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.clients.length, 1);
  assert.equal(preview.clients[0].client_type, "persona_juridica");
});
