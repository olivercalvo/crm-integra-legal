/**
 * Tests de UNICIDAD DE RUC en la importación masiva de clientes.
 *
 * Regla: una fila cuyo RUC ya está registrado en un cliente ACTIVO de la BD
 * (contra `ruc` OR `tax_id`) NO se importa y se reporta con mensaje accionable
 * ("RUC ya registrado en CLI-XXX"). Además, dos filas con el mismo RUC dentro
 * del mismo archivo → error (la 2da no se importa). Un cliente INACTIVO libera
 * el RUC.
 *
 * Ejecución:
 *   npx tsx --test src/lib/utils/__tests__/import-ruc-unique.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import { parseImportFile, validateImport } from "@/lib/utils/import-parser";

function clientsWorkbook(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, sheet, "Clientes");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

const HEADERS = ["Nombre", "RUC/Cédula", "Tipo Fiscal", "Email"];

const EXISTING = [
  { id: "c104", name: "INMOBILIARIA CAMAY, S.A.", ruc: "155-104-2020", tax_id: null, client_status: "active", client_number: "CLI-104" },
  { id: "c050", name: "Cliente En TaxId", ruc: null, tax_id: "8-777-999", client_status: "active", client_number: "CLI-050" },
  { id: "c009", name: "Cliente Inactivo", ruc: "9-9-9", tax_id: null, client_status: "inactive", client_number: "CLI-009" },
];

test("importar fila con RUC ya registrado en un cliente ACTIVO → fuera de validClients + error accionable", () => {
  const buf = clientsWorkbook([
    HEADERS,
    ["Nueva Camay", "155-104-2020", "Jurídica", ""],
  ]);
  const { clientRows } = parseImportFile(buf);
  const preview = validateImport(clientRows, [], EXISTING);

  assert.equal(preview.clients.length, 0, "la fila con RUC repetido no debe quedar como válida");
  const rucErr = preview.errors.find((e) => e.field === "ruc");
  assert.ok(rucErr, "debe haber un error de RUC");
  assert.match(rucErr!.message, /CLI-104/);
  assert.match(rucErr!.message, /ya registrado/i);
});

test("importar fila cuyo RUC coincide con el tax_id de un activo → bloqueada", () => {
  const buf = clientsWorkbook([
    HEADERS,
    ["Otro Con Ese RUC", "8-777-999", "Natural", ""],
  ]);
  const { clientRows } = parseImportFile(buf);
  const preview = validateImport(clientRows, [], EXISTING);

  assert.equal(preview.clients.length, 0);
  assert.match(preview.errors.find((e) => e.field === "ruc")!.message, /CLI-050/);
});

test("importar fila con RUC de un cliente INACTIVO → permitida (el inactivo libera el RUC)", () => {
  const buf = clientsWorkbook([
    HEADERS,
    ["Reuso RUC De Inactivo", "9-9-9", "Jurídica", ""],
  ]);
  const { clientRows } = parseImportFile(buf);
  const preview = validateImport(clientRows, [], EXISTING);

  assert.equal(preview.clients.length, 1, "el RUC de un inactivo no debe bloquear");
  assert.equal(preview.errors.filter((e) => e.field === "ruc").length, 0);
});

test("importar fila con RUC NUEVO → permitida", () => {
  const buf = clientsWorkbook([
    HEADERS,
    ["Cliente Fresco", "111-222-333", "Natural", ""],
  ]);
  const { clientRows } = parseImportFile(buf);
  const preview = validateImport(clientRows, [], EXISTING);

  assert.equal(preview.clients.length, 1);
  assert.equal(preview.errors.length, 0);
});

test("dos filas con el MISMO RUC en el archivo → 2da fila con error, fuera de validClients", () => {
  const buf = clientsWorkbook([
    HEADERS,
    ["Primero", "500-500-500", "Jurídica", ""],
    ["Segundo (mismo RUC)", "500-500-500", "Jurídica", ""],
  ]);
  const { clientRows } = parseImportFile(buf);
  const preview = validateImport(clientRows, [], []); // sin existentes en BD

  // La primera se conserva, la segunda cae por RUC duplicado en archivo.
  assert.equal(preview.clients.length, 1);
  assert.equal(preview.clients[0].name, "Primero");
  const dupErr = preview.errors.find((e) => e.field === "ruc");
  assert.ok(dupErr, "debe reportar el duplicado dentro del archivo");
  assert.match(dupErr!.message, /duplicado en el archivo/i);
  assert.match(dupErr!.message, /fila 2/); // apunta a la 1ra ocurrencia (fila 2 del sheet)
});
