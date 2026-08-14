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
 * Filas de ejemplo de la plantilla. Cubren a propósito los tres casos que más
 * confunden: una cuenta de balance sin subcategoría inferible, un COSTO y un
 * GASTO (que comparten account_type='expense' y solo se distinguen por la
 * subcategoría), y un saldo negativo.
 */
const TEMPLATE_EXAMPLES: Array<[string, string, string, string, number]> = [
  ["100001", "Caja general", "Activo", SUBCATEGORIA_LABEL_ES.activo_corriente, 2500],
  ["300001", "Capital pagado", "Patrimonio", SUBCATEGORIA_LABEL_ES.patrimonio, -15000],
  ["400001", "Derecho Corporativo", "Ingreso", SUBCATEGORIA_LABEL_ES.ingreso, 0],
  ["500001", "Honorarios de abogados externos", "Costo", "", 0],
  ["600001", "Alquiler de oficina", "Gasto", "", 0],
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

  const subcategorias = (Object.keys(SUBCATEGORIA_LABEL_ES) as Subcategoria[]).map((k) => [
    SUBCATEGORIA_LABEL_ES[k],
    k,
  ]);
  const help = XLSX.utils.aoa_to_sheet([
    ["Cómo llenar esta plantilla"],
    [],
    ["Columna", "Obligatoria", "Detalle"],
    ["Código", "Sí", "Único. Letras, dígitos, guion o punto. No se puede cambiar después."],
    ["Nombre", "Sí", "Entre 2 y 120 caracteres."],
    ["Tipo", "Sí", "Activo, Pasivo, Patrimonio, Ingreso, Costo o Gasto."],
    [
      "Subcategoría",
      "No",
      "Si se deja vacía: Costo asume 'Costo' y Gasto asume 'Gasto operativo'. El resto queda sin clasificar.",
    ],
    ["Saldo inicial", "No", "Vacío = 0. Admite negativos y separadores de miles."],
    [],
    ["Si un código ya existe, la fila ACTUALIZA esa cuenta (nombre, tipo, subcategoría y saldo)."],
    [],
    ["Subcategorías válidas", "Valor interno"],
    ...subcategorias,
  ]);
  help["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 80 }];
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
      "No se pudo leer el archivo. Verificá que sea un .xlsx, .xls o .csv válido."
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
        "(también se aceptan “Número”/“Cuenta” y “Nombre de cuenta”). Descargá la plantilla de ejemplo."
    );
  }

  return parsed;
}
