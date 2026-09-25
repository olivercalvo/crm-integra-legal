/**
 * La plantilla de importación de asientos y la lectura del archivo (7.5).
 * Sólo convierte entre el .xlsx y una matriz de celdas: la validación vive en
 * `asientos-import.ts`, que es pura.
 */

import * as XLSX from "xlsx";
import { ENCABEZADOS } from "@/lib/finanzas/import/asientos-import";

export class WorkbookDeAsientosError extends Error {}

/** La plantilla, con dos asientos de ejemplo, instrucciones y el plan activo. */
export function generarPlantillaDeAsientos(
  cuentas: { code: string; name: string; account_type: string }[]
): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ejemplo = [
    [...ENCABEZADOS],
    ["1", "25/09/2026", "Depreciación de mobiliario, septiembre", "DEP-09", "", "Depreciación del mes", 150, ""],
    ["1", "25/09/2026", "", "", "", "Depreciación acumulada", "", 150],
    ["2", "25/09/2026", "Provisión de servicios públicos", "", "", "", 80.5, ""],
    ["2", "25/09/2026", "", "", "", "", "", 80.5],
  ];
  const hoja = XLSX.utils.aoa_to_sheet(ejemplo);
  hoja["!cols"] = [{ wch: 9 }, { wch: 12 }, { wch: 40 }, { wch: 14 }, { wch: 10 }, { wch: 30 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, hoja, "Asientos");

  const ayuda = XLSX.utils.aoa_to_sheet([
    ["Cómo llenar la plantilla"],
    [],
    ["Columna", "Obligatoria", "Detalle"],
    ["Asiento", "Sí", "Un identificador (1, 2, DEP-SEP…). Las filas con el mismo valor forman UN asiento y tienen que estar juntas."],
    ["Fecha", "Sí", "DD/MM/AAAA o AAAA-MM-DD. La misma en todas las líneas del asiento. El mes tiene que estar abierto."],
    ["Descripción del asiento", "Sí", "Qué operación es (al menos 3 caracteres). Va en la primera línea del asiento."],
    ["Referencia", "No", "El documento que respalda el asiento."],
    ["Cuenta", "Sí", "El código del plan de cuentas (ver la hoja Cuentas). Tiene que existir y estar activa."],
    ["Descripción de la línea", "No", ""],
    ["Débito / Crédito", "Uno de los dos", "Positivo, con hasta dos decimales. Cada línea lleva débito O crédito, nunca los dos."],
    [],
    ["Cada asiento tiene que cuadrar: la suma de débitos igual a la de créditos."],
    ["Nada se registra hasta que confirmes la vista previa. Si hay un solo error, no se registra nada."],
    ["En el ejemplo la columna Cuenta está vacía: complétala con cuentas de tu plan antes de subir el archivo."],
  ]);
  ayuda["!cols"] = [{ wch: 26 }, { wch: 14 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, ayuda, "Instrucciones");

  const plan = XLSX.utils.aoa_to_sheet([
    ["Código", "Nombre", "Tipo"],
    ...cuentas.map((c) => [c.code, c.name, c.account_type]),
  ]);
  plan["!cols"] = [{ wch: 10 }, { wch: 40 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, plan, "Cuentas");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

/** La hoja "Asientos" (o la primera) como matriz de celdas. */
export function leerHojaDeAsientos(buffer: ArrayBuffer | Buffer): unknown[][] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  } catch {
    throw new WorkbookDeAsientosError("No se pudo leer el archivo. Tiene que ser un .xlsx, .xls o .csv válido.");
  }
  const nombre = wb.SheetNames.find((n) => n.trim().toLowerCase() === "asientos") ?? wb.SheetNames[0];
  if (!nombre) throw new WorkbookDeAsientosError("El archivo no tiene hojas.");
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nombre], { header: 1, raw: true, defval: null, blankrows: false });
}
