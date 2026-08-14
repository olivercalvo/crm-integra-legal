/**
 * Tests del mapeo/parseo PURO de la carga masiva del Plan de Cuentas (Paso 1b).
 *
 * No usan XLSX ni mocks: alimentan `parseSheetRows` con la misma matriz de
 * celdas que produce SheetJS, así que corren sin fixtures binarios.
 *
 * Ejecución:
 *   npx tsx --test src/lib/finanzas/import/__tests__/chart-of-accounts-mapping.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeHeaderKey,
  mapHeaderRow,
  findHeaderRow,
  mapAccountType,
  parseSaldoInicial,
  parseSheetRows,
  classifyRows,
  type ExistingAccountInfo,
} from "@/lib/finanzas/import/chart-of-accounts-mapping";

// ---------------------------------------------------------------------------
// normalizeHeaderKey
// ---------------------------------------------------------------------------

test("normalizeHeaderKey: quita acentos, mayúsculas y puntuación de borde", () => {
  assert.equal(normalizeHeaderKey("Código"), "codigo");
  assert.equal(normalizeHeaderKey("  NOMBRE DE CUENTA : "), "nombre de cuenta");
  assert.equal(normalizeHeaderKey("Subcategoría"), "subcategoria");
  assert.equal(normalizeHeaderKey("Tipo  de   Cuenta"), "tipo de cuenta");
  assert.equal(normalizeHeaderKey(null), "");
});

// ---------------------------------------------------------------------------
// Encabezados
// ---------------------------------------------------------------------------

test("mapHeaderRow: reconoce la plantilla propia", () => {
  const cols = mapHeaderRow(["Código", "Nombre", "Tipo", "Subcategoría", "Saldo inicial"]);
  assert.deepEqual(cols, { code: 0, name: 1, type: 2, subcategoria: 3, saldo: 4 });
});

test("mapHeaderRow: reconoce el balance de comprobación e ignora columnas extra", () => {
  const cols = mapHeaderRow([
    "Código",
    "Nombre de cuenta",
    "Tipo de Cuenta",
    "Balance Inicial",
    "Débito",
    "Crédito",
    "Saldo final",
  ]);
  assert.equal(cols.code, 0);
  assert.equal(cols.name, 1);
  assert.equal(cols.type, 2);
  assert.equal(cols.saldo, 3, "Balance Inicial es el saldo inicial");
  assert.equal(cols.subcategoria, -1, "ese formato no trae subcategoría");
});

test('mapHeaderRow: "Saldo final" NO se confunde con "Saldo inicial"', () => {
  const cols = mapHeaderRow(["Cuenta", "Nombre", "Saldo final"]);
  assert.equal(cols.saldo, -1);
});

test("findHeaderRow: saltea las filas de título de arriba", () => {
  const rows: unknown[][] = [
    ["INTEGRA LEGAL, S.A."],
    ["Balance de comprobación"],
    ["Al 31 de diciembre de 2025"],
    [],
    ["Código", "Nombre de cuenta", "Tipo de Cuenta", "Balance Inicial"],
    ["100001", "Caja", "Activo", 100],
  ];
  const header = findHeaderRow(rows);
  assert.ok(header);
  assert.equal(header.index, 4);
  assert.equal(header.columns.code, 0);
});

test("findHeaderRow: sin encabezados reconocibles → null", () => {
  const header = findHeaderRow([["a", "b"], ["c", "d"]]);
  assert.equal(header, null);
});

// ---------------------------------------------------------------------------
// mapAccountType
// ---------------------------------------------------------------------------

test("mapAccountType: los 4 tipos de balance/resultado sin subcategoría default", () => {
  assert.deepEqual(mapAccountType("Activo"), {
    account_type: "asset",
    subcategoriaDefault: null,
  });
  assert.deepEqual(mapAccountType("Pasivos"), {
    account_type: "liability",
    subcategoriaDefault: null,
  });
  assert.deepEqual(mapAccountType("PATRIMONIO"), {
    account_type: "equity",
    subcategoriaDefault: null,
  });
  assert.deepEqual(mapAccountType("Ingresos"), {
    account_type: "income",
    subcategoriaDefault: null,
  });
});

test("mapAccountType: Costo y Gasto colapsan a expense pero con subcategoría distinta", () => {
  assert.deepEqual(mapAccountType("Costo"), {
    account_type: "expense",
    subcategoriaDefault: "costo",
  });
  assert.deepEqual(mapAccountType("costos"), {
    account_type: "expense",
    subcategoriaDefault: "costo",
  });
  assert.deepEqual(mapAccountType("Gasto"), {
    account_type: "expense",
    subcategoriaDefault: "gasto_operativo",
  });
  assert.deepEqual(mapAccountType("GASTOS"), {
    account_type: "expense",
    subcategoriaDefault: "gasto_operativo",
  });
});

test("mapAccountType: acepta los valores crudos en inglés", () => {
  assert.equal(mapAccountType("asset")?.account_type, "asset");
  assert.equal(mapAccountType("expense")?.account_type, "expense");
});

test("mapAccountType: desconocido o vacío → null", () => {
  assert.equal(mapAccountType("Cuenta de orden"), null);
  assert.equal(mapAccountType(""), null);
  assert.equal(mapAccountType(null), null);
});

// ---------------------------------------------------------------------------
// parseSaldoInicial
// ---------------------------------------------------------------------------

test("parseSaldoInicial: vacío / null / guion → 0", () => {
  for (const v of ["", "   ", null, undefined, "-"]) {
    const r = parseSaldoInicial(v);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, 0, `entrada: ${JSON.stringify(v)}`);
  }
});

test("parseSaldoInicial: número real de celda XLSX", () => {
  const r = parseSaldoInicial(12500.756);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 12500.76, "redondea a 2 decimales");
});

test("parseSaldoInicial: negativos con signo y con paréntesis contables", () => {
  const signo = parseSaldoInicial("-8400.25");
  assert.equal(signo.ok, true);
  if (signo.ok) assert.equal(signo.value, -8400.25);

  const parens = parseSaldoInicial("(1,234.00)");
  assert.equal(parens.ok, true);
  if (parens.ok) assert.equal(parens.value, -1234);
});

test("parseSaldoInicial: separadores de miles formato US", () => {
  const r = parseSaldoInicial("1,234,567.89");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 1234567.89);
});

test("parseSaldoInicial: separadores formato europeo (el último separador es el decimal)", () => {
  const r = parseSaldoInicial("1.234,56");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 1234.56);
});

test("parseSaldoInicial: coma sola con 3 dígitos = miles; con 1-2 = decimal", () => {
  const miles = parseSaldoInicial("1,234");
  assert.equal(miles.ok, true);
  if (miles.ok) assert.equal(miles.value, 1234);

  const decimal = parseSaldoInicial("1,5");
  assert.equal(decimal.ok, true);
  if (decimal.ok) assert.equal(decimal.value, 1.5);
});

test("parseSaldoInicial: varios puntos = miles", () => {
  const r = parseSaldoInicial("1.234.567");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 1234567);
});

test("parseSaldoInicial: símbolo de moneda B/. y $", () => {
  const balboa = parseSaldoInicial("B/. 2,500.00");
  assert.equal(balboa.ok, true);
  if (balboa.ok) assert.equal(balboa.value, 2500);

  const dolar = parseSaldoInicial("$1200");
  assert.equal(dolar.ok, true);
  if (dolar.ok) assert.equal(dolar.value, 1200);
});

test("parseSaldoInicial: texto no numérico → error", () => {
  const r = parseSaldoInicial("mil quinientos");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /Saldo inicial inválido/);
});

test("parseSaldoInicial: fuera de numeric(14,2) → error", () => {
  const r = parseSaldoInicial(1e13);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /fuera de rango/);
});

// ---------------------------------------------------------------------------
// parseSheetRows
// ---------------------------------------------------------------------------

const TEMPLATE_HEADER = ["Código", "Nombre", "Tipo", "Subcategoría", "Saldo inicial"];

test("parseSheetRows: plantilla completa con costo y gasto", () => {
  const result = parseSheetRows([
    TEMPLATE_HEADER,
    ["100001", "Caja general", "Activo", "Activo corriente", 2500],
    ["500001", "Honorarios externos", "Costo", "", 0],
    ["600001", "Alquiler de oficina", "Gasto", "", ""],
  ]);
  assert.ok(result);
  assert.equal(result.rows.length, 3);

  assert.equal(result.rows[0].account_type, "asset");
  assert.equal(result.rows[0].subcategoria, "activo_corriente");
  assert.equal(result.rows[0].saldo_inicial, 2500);

  assert.equal(result.rows[1].account_type, "expense");
  assert.equal(result.rows[1].subcategoria, "costo", "Costo sin subcategoría → default costo");

  assert.equal(result.rows[2].account_type, "expense");
  assert.equal(
    result.rows[2].subcategoria,
    "gasto_operativo",
    "Gasto sin subcategoría → default gasto_operativo"
  );
  assert.equal(result.rows[2].saldo_inicial, 0, "saldo vacío → 0");

  for (const r of result.rows) assert.deepEqual(r.errors, []);
});

test("parseSheetRows: la subcategoría EXPLÍCITA gana sobre el default del tipo", () => {
  const result = parseSheetRows([
    TEMPLATE_HEADER,
    // Tipo Gasto (default gasto_operativo) pero el archivo dice Costo.
    ["500002", "Servicios subcontratados", "Gasto", "Costo", 0],
  ]);
  assert.ok(result);
  assert.equal(result.rows[0].account_type, "expense");
  assert.equal(result.rows[0].subcategoria, "costo");
});

test("parseSheetRows: acepta la subcategoría en snake_case o como label español", () => {
  const result = parseSheetRows([
    TEMPLATE_HEADER,
    ["100002", "Banco", "Activo", "activo_corriente", 0],
    ["120001", "Edificio", "Activo", "Propiedad, planta y equipo", 0],
  ]);
  assert.ok(result);
  assert.equal(result.rows[0].subcategoria, "activo_corriente");
  assert.equal(result.rows[1].subcategoria, "propiedad_planta_equipo");
});

test("parseSheetRows: subcategoría inventada → fila con error", () => {
  const result = parseSheetRows([
    TEMPLATE_HEADER,
    ["100003", "Caja", "Activo", "Plata en el cajón", 0],
  ]);
  assert.ok(result);
  assert.equal(result.rows.length, 1);
  assert.match(result.rows[0].errors.join(" "), /Subcategoría no reconocida/);
});

test("parseSheetRows: descarta EN SILENCIO títulos, totales y filas vacías", () => {
  const result = parseSheetRows([
    ["INTEGRA LEGAL, S.A."],
    ["Balance de comprobación"],
    ["Código", "Nombre de cuenta", "Tipo de Cuenta", "Balance Inicial"],
    ["100001", "Caja", "Activo", 500],
    [],
    [null, "TOTAL ACTIVOS", null, 500],
    ["", "", "", ""],
    ["ACTIVOS CORRIENTES"],
    ["100002", "Banco", "Activo", 1500],
  ]);
  assert.ok(result);
  assert.equal(result.rows.length, 2, "solo las 2 filas con código válido");
  assert.equal(result.skippedRows, 4, "títulos/totales/vacías se cuentan como ignoradas");
  assert.deepEqual(
    result.rows.map((r) => r.code),
    ["100001", "100002"]
  );
});

test("parseSheetRows: fila CON código pero tipo inválido → error (no se descarta)", () => {
  const result = parseSheetRows([
    TEMPLATE_HEADER,
    ["700001", "Cuenta rara", "Cuenta de orden", "", 0],
  ]);
  assert.ok(result);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].account_type, null);
  assert.match(result.rows[0].errors.join(" "), /Tipo de cuenta no reconocido/);
});

test("parseSheetRows: fila con código pero sin nombre → error", () => {
  const result = parseSheetRows([TEMPLATE_HEADER, ["100004", "", "Activo", "", 0]]);
  assert.ok(result);
  assert.match(result.rows[0].errors.join(" "), /Falta el nombre/);
});

test("parseSheetRows: rowNumber es la fila real de Excel (1-based)", () => {
  const result = parseSheetRows([
    ["Título"],
    TEMPLATE_HEADER, // fila 2
    ["100001", "Caja", "Activo", "", 0], // fila 3
  ]);
  assert.ok(result);
  assert.equal(result.headerRowIndex, 1);
  assert.equal(result.rows[0].rowNumber, 3);
});

test("parseSheetRows: sin encabezados → null", () => {
  assert.equal(parseSheetRows([["foo", "bar"], ["1", "2"]]), null);
});

test("parseSheetRows: código numérico de celda XLSX (number) se acepta", () => {
  const result = parseSheetRows([TEMPLATE_HEADER, [100001, "Caja", "Activo", "", 0]]);
  assert.ok(result);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].code, "100001");
});

// ---------------------------------------------------------------------------
// classifyRows
// ---------------------------------------------------------------------------

function existingMap(
  entries: Array<[string, Partial<ExistingAccountInfo>]>
): Map<string, ExistingAccountInfo> {
  const m = new Map<string, ExistingAccountInfo>();
  for (const [code, info] of entries) {
    m.set(code, {
      id: info.id ?? `id-${code}`,
      description: info.description ?? null,
      active: info.active ?? true,
      is_system: info.is_system ?? false,
    });
  }
  return m;
}

test("classifyRows: código que YA existe → update; el nuevo → create", () => {
  const parsed = parseSheetRows([
    TEMPLATE_HEADER,
    ["100001", "Caja general", "Activo", "Activo corriente", 100],
    ["999999", "Cuenta nueva", "Gasto", "", 0],
  ]);
  assert.ok(parsed);

  const { rows, counts } = classifyRows(parsed.rows, existingMap([["100001", { id: "acc-1" }]]));

  assert.equal(counts.update, 1);
  assert.equal(counts.create, 1);
  assert.equal(counts.error, 0);
  assert.equal(rows[0].action, "update");
  assert.equal(rows[0].existingId, "acc-1");
  assert.equal(rows[1].action, "create");
  assert.equal(rows[1].existingId, undefined);
});

test("classifyRows: código repetido DENTRO del archivo → la 2da queda en error", () => {
  const parsed = parseSheetRows([
    TEMPLATE_HEADER,
    ["100001", "Caja", "Activo", "", 100],
    ["100001", "Caja duplicada", "Activo", "", 200],
  ]);
  assert.ok(parsed);

  const { rows, counts } = classifyRows(parsed.rows, existingMap([]));
  assert.equal(counts.create, 1);
  assert.equal(counts.error, 1);
  assert.equal(rows[0].action, "create");
  assert.equal(rows[1].action, "error");
  assert.match(rows[1].errors.join(" "), /repetido en el archivo/);
});

test("classifyRows: una fila con error de parseo nunca se marca create/update", () => {
  const parsed = parseSheetRows([
    TEMPLATE_HEADER,
    ["100001", "Caja", "Tipo inexistente", "", 0],
  ]);
  assert.ok(parsed);
  const { rows, counts } = classifyRows(parsed.rows, existingMap([["100001", {}]]));
  assert.equal(rows[0].action, "error", "existe en BD pero igual es error, no update");
  assert.equal(counts.update, 0);
  assert.equal(counts.error, 1);
});

test("classifyRows: marca isSystem en el preview de una cuenta del sistema", () => {
  const parsed = parseSheetRows([TEMPLATE_HEADER, ["4101", "Honorarios", "Ingreso", "", 0]]);
  assert.ok(parsed);
  const { rows } = classifyRows(parsed.rows, existingMap([["4101", { is_system: true }]]));
  assert.equal(rows[0].action, "update");
  assert.equal(rows[0].isSystem, true);
});
