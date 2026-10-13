/**
 * La plantilla Excel del asiento de apertura (100) y su lectura.
 *
 * Hojas: Léame (de dónde salen los saldos y cómo se llena), Apertura (la que se
 * sube: encabezados en la fila 1), Cuentas, Clientes y Proveedores (los códigos
 * válidos). La hoja Apertura viene precargada con lo que el CRM conoce al corte
 * (ayuda, no fuente) o vacía.
 */

import * as XLSX from "xlsx";
import { AVISO_FUENTE_DE_LA_APERTURA, ENCABEZADOS_APERTURA, esCierreDelAnio } from "@/lib/finanzas/contabilidad/apertura";

export class WorkbookDeAperturaError extends Error {}

export interface FilaPrecargada {
  cuenta: string;
  tercero: string;
  documento: string;
  fecha: string | null;
  vencimiento: string | null;
  debito: number;
  credito: number;
}

const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const comoFecha = (f: string | null) => (f ? new Date(`${f}T12:00:00Z`) : "");

export function generarPlantillaDeApertura(p: {
  fechaApertura: string;
  inicioContable: string;
  cuentas: { code: string; name: string; account_type: string; cuenta_control: string | null }[];
  clientes: { codigo: string; nombre: string }[];
  proveedores: { codigo: string; nombre: string }[];
  precarga: FilaPrecargada[];
}): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const cierre = esCierreDelAnio(p.fechaApertura);

  const leame = XLSX.utils.aoa_to_sheet([
    [`Asiento de apertura al ${fechaCorta(p.fechaApertura)}`],
    [],
    ["De dónde salen los saldos"],
    [AVISO_FUENTE_DE_LA_APERTURA],
    [
      p.precarga.length > 0
        ? `Esta plantilla trae precargadas ${p.precarga.length} fila(s): los documentos del CRM con saldo al ${fechaCorta(p.fechaApertura)}. ` +
          "Sólo cubren lo que el CRM conoce. La cuenta por cobrar y por pagar completa, y el resto de las cuentas, salen de QuickBooks."
        : "Esta plantilla viene vacía: todos los saldos se cargan desde los libros del contador (QuickBooks).",
    ],
    [],
    ["Qué es"],
    [`Un solo asiento con los saldos de cada cuenta al ${fechaCorta(p.fechaApertura)}, el día del corte. El inicio contable del CRM es el ${fechaCorta(p.inicioContable)}: desde ahí los documentos se registran solos.`],
    [cierre
      ? "La apertura es al cierre del año: lleva sólo cuentas de balance (activo, pasivo y patrimonio). El resultado del año va en resultados acumulados."
      : "La apertura es a mitad de año: las cuentas de resultado llevan lo acumulado del año hasta el corte."],
    [],
    ["Columna", "Obligatoria", "Detalle"],
    ["Cuenta", "Sí", "El código del plan de cuentas (hoja Cuentas). Tiene que existir y estar activa."],
    ["Tercero", "En 100004 y 200001", "El código del cliente (CLI-…, hoja Clientes) en 100004, o del proveedor (PRV-…, hoja Proveedores) en 200001. Opcional en las demás."],
    ["Documento externo", "En 100004 y 200001", "El número de la factura o el documento pendiente al corte. Una fila por documento."],
    ["Fecha del documento", "En 100004 y 200001", "MM/DD/AAAA o DD/MM/AAAA según elijas al subir el archivo (por defecto MM/DD/AAAA). Una celda con formato de fecha también vale. No posterior a la apertura. Con ella se calcula la antigüedad."],
    ["Vencimiento", "No", "Mismo formato que la fecha del documento. Si está vacía, la antigüedad cuenta desde la fecha del documento."],
    ["Débito / Crédito", "Uno de los dos", "Positivo, con hasta dos decimales. Cada fila lleva débito o crédito, nunca los dos."],
    [],
    ["Débitos y créditos tienen que ser iguales. Nada se registra hasta revisar la vista previa en la pantalla y confirmar."],
    ["Se registra una sola vez. Si después hay que corregirla, se reversa (con la misma fecha, con el mes abierto) y se carga otra."],
  ]);
  leame["!cols"] = [{ wch: 22 }, { wch: 20 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, leame, "Léame");

  const filas: unknown[][] = [[...ENCABEZADOS_APERTURA]];
  for (const f of p.precarga) {
    filas.push([f.cuenta, f.tercero, f.documento, comoFecha(f.fecha), comoFecha(f.vencimiento),
      f.debito > 0 ? f.debito : "", f.credito > 0 ? f.credito : ""]);
  }
  const hoja = XLSX.utils.aoa_to_sheet(filas, { cellDates: true, dateNF: "dd/mm/yyyy" });
  hoja["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, hoja, "Apertura");

  const plan = XLSX.utils.aoa_to_sheet([
    ["Código", "Nombre", "Tipo", "Lleva tercero"],
    ...p.cuentas.map((c) => [c.code, c.name, c.account_type,
      c.cuenta_control === "clientes" ? "Cliente" : c.cuenta_control === "proveedores" ? "Proveedor" : ""]),
  ]);
  plan["!cols"] = [{ wch: 10 }, { wch: 40 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, plan, "Cuentas");

  const cli = XLSX.utils.aoa_to_sheet([["Código", "Cliente"], ...p.clientes.map((c) => [c.codigo, c.nombre])]);
  cli["!cols"] = [{ wch: 14 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, cli, "Clientes");
  const prv = XLSX.utils.aoa_to_sheet([["Código", "Proveedor"], ...p.proveedores.map((c) => [c.codigo, c.nombre])]);
  prv["!cols"] = [{ wch: 14 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, prv, "Proveedores");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

/** La hoja «Apertura» (o la primera que no sea Léame) como matriz de celdas. */
export function leerHojaDeApertura(buffer: ArrayBuffer | Buffer): unknown[][] {
  let wb: XLSX.WorkBook;
  try {
    // `raw`: en un CSV la librería convertía «03/04/2026» en fecha por su cuenta
    // (mes primero, sin mirar el formato elegido). Así queda texto y lo lee `parsearFecha`.
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });
  } catch {
    throw new WorkbookDeAperturaError("No se pudo leer el archivo. Tiene que ser un .xlsx válido (la plantilla de apertura).");
  }
  const nombre =
    wb.SheetNames.find((n) => n.trim().toLowerCase() === "apertura") ??
    wb.SheetNames.find((n) => n.trim().toLowerCase() !== "léame");
  if (!nombre) throw new WorkbookDeAperturaError("El archivo no tiene la hoja Apertura.");
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nombre], { header: 1, raw: true, defval: null, blankrows: false });
}
