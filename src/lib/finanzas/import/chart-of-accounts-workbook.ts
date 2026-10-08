/**
 * Capa XLSX/CSV de la carga masiva del Plan de Cuentas.
 *
 * Responsabilidad ÚNICA: convertir el archivo a una matriz de celdas y
 * delegar toda la interpretación en `chart-of-accounts-mapping.ts` (puro).
 * Acá no hay reglas de negocio — así el mapeo se testea sin fixtures binarios.
 *
 * También genera la plantilla de ejemplo descargable.
 */

import * as XLSX from "xlsx";
import {
  parseSheetRows,
  type ParseSheetResult,
} from "@/lib/finanzas/import/chart-of-accounts-mapping";
import {
  SUBCATEGORIA_LABEL_ES,
  SUBCATEGORIAS_POR_TIPO,
  type Subcategoria,
} from "@/lib/finanzas/types/chart-of-account";

/** Encabezados de la plantilla oficial. */
export const TEMPLATE_HEADERS = [
  "Código",
  "Nombre",
  "Tipo",
  "Subcategoría",
  "Saldo inicial",
] as const;

/**
 * Filas de ejemplo de la plantilla. Cubren a propósito los casos que más
 * confunden: un saldo negativo, y las tres cuentas de RESULTADO —ingreso, costo
 * y gasto— que desde NIIF 18 son tres account_type DISTINTOS y llevan
 * subcategoría OBLIGATORIA.
 *
 * Las tres de resultado van con la subcategoría escrita, no en blanco: dejarla
 * vacía ahora es un error de validación, así que la plantilla tiene que enseñar
 * el formato correcto en vez de modelar la fila que va a ser rechazada.
 */
const TEMPLATE_EXAMPLES: Array<[string, string, string, string, number]> = [
  ["100001", "Caja general", "Activo", SUBCATEGORIA_LABEL_ES.activo_corriente, 2500],
  ["300001", "Capital pagado", "Patrimonio", SUBCATEGORIA_LABEL_ES.capital_social, -15000],
  ["400001", "Derecho Corporativo", "Ingreso", SUBCATEGORIA_LABEL_ES.ingresos_operativos, 0],
  [
    "500001",
    "Honorarios de abogados externos",
    "Costo",
    SUBCATEGORIA_LABEL_ES.costos_operativos,
    0,
  ],
  ["600001", "Alquiler de oficina", "Gasto", SUBCATEGORIA_LABEL_ES.gastos_operativos, 0],
];

/**
 * Genera la plantilla .xlsx de ejemplo. Incluye una segunda hoja "Instrucciones"
 * con los valores aceptados: es el lugar donde el contador va a mirar cuando no
 * se acuerde cómo se escribe una subcategoría.
 */
export function generateChartAccountsTemplate(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const sheet = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_HEADERS],
    ...TEMPLATE_EXAMPLES,
  ]);
  sheet["!cols"] = [{ wch: 12 }, { wch: 40 }, { wch: 14 }, { wch: 26 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, sheet, "Cuentas");

  // Requerimiento 3 (07/10/2026): la hoja decía que la subcategoría era
  // opcional. Desde la 079 es OBLIGATORIA en los seis tipos (CHECK
  // coa_subcategoria_por_tipo): si la celda viene vacía se asigna la de por
  // defecto del tipo (`subcategoriaPorDefecto`, la misma regla de la base) y se
  // corrige después en el Plan de Cuentas. Las válidas van por tipo.
  const TIPO_ES: Record<string, string> = {
    asset: "Activo", liability: "Pasivo", equity: "Patrimonio", income: "Ingreso", cost: "Costo", expense: "Gasto",
  };
  const porTipo = (Object.keys(SUBCATEGORIAS_POR_TIPO) as (keyof typeof SUBCATEGORIAS_POR_TIPO)[]).flatMap((t) =>
    SUBCATEGORIAS_POR_TIPO[t].map((k: Subcategoria) => [TIPO_ES[t] ?? t, SUBCATEGORIA_LABEL_ES[k], k])
  );
  const help = XLSX.utils.aoa_to_sheet([
    ["Cómo llenar esta plantilla"],
    [],
    ["Columna", "Obligatoria", "Detalle"],
    ["Código", "Sí", "Único. Letras, dígitos, guion o punto (el plan del bufete usa 6 dígitos). No se puede cambiar después."],
    ["Nombre", "Sí", "Entre 2 y 120 caracteres."],
    ["Tipo", "Sí", "Activo, Pasivo, Patrimonio, Ingreso, Costo o Gasto."],
    [
      "Subcategoría",
      "Sí",
      "Toda cuenta lleva una, de las válidas para su tipo (tabla de abajo). Si la celda queda vacía, el sistema pone la de " +
        "por defecto del tipo (por ejemplo, Gasto → Gastos operativos; Activo → Activo corriente) y se corrige después en el Plan de Cuentas.",
    ],
    [
      "Saldo inicial",
      "No",
      "Vacío = 0. Admite negativos y separadores de miles. Se usa sólo mientras el bufete no tenga asiento de apertura: " +
        "con la apertura cargada (Asientos de Diario › Apertura) el saldo inicial ya no cuenta ni se puede cambiar.",
    ],
    [],
    ["Si un código ya existe, la fila ACTUALIZA esa cuenta (nombre, tipo, subcategoría y saldo)."],
    [],
    ["Tipo", "Subcategoría válida", "Valor interno"],
    ...porTipo,
  ]);
  help["!cols"] = [{ wch: 22 }, { wch: 32 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, help, "Instrucciones");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

/** Error de lectura del archivo, con mensaje ya listo para mostrar. */
export class WorkbookParseError extends Error {}

/**
 * Lee el archivo (xlsx/xls/csv) y devuelve las filas interpretadas.
 *
 * Usa `raw: true` para que las celdas numéricas lleguen como number (el camino
 * limpio para los saldos) y `defval: null` para que las celdas vacías no
 * corran las posiciones de las columnas.
 *
 * Toma la PRIMERA hoja. Es deliberado: la plantilla tiene "Cuentas" primero, y
 * el balance de comprobación de Josuar es de una sola hoja. Elegir hoja sería
 * una perilla más para equivocarse.
 */
export function parseChartAccountsFile(buffer: ArrayBuffer | Buffer): ParseSheetResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  } catch {
    throw new WorkbookParseError(
      "No se pudo leer el archivo. El archivo debe ser un .xlsx, .xls o .csv válido."
    );
  }

  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    throw new WorkbookParseError("El archivo no tiene hojas.");
  }

  const sheet = wb.Sheets[firstSheetName];
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  const parsed = parseSheetRows(matrix);
  if (!parsed) {
    throw new WorkbookParseError(
      'No se encontraron los encabezados. El archivo debe tener una fila con al menos "Código" y "Nombre" ' +
        "(también se aceptan “Número”/“Cuenta” y “Nombre de cuenta”). Descargue la plantilla de ejemplo."
    );
  }

  return parsed;
}
