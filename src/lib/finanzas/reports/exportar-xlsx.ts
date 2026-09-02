/**
 * MOTOR DE EXPORTACIÓN A EXCEL de los reportes contables.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ XLSX Y NO CSV
 * ═════════════════════════════════════════════════════════════════════════════
 * La razón que decide no es el encoding —un CSV con BOM abre bien— sino esta:
 *
 *   🔴 **UN CSV DESTRUYE EL DV.** El dígito verificador `05` es texto, pero
 *      Excel lo lee como número y lo abre como `5`. Justo la columna por la que
 *      Josuarth pidió todo esto quedaría mal en la mitad de los casos, y de una
 *      forma silenciosa: el archivo se ve bien hasta que alguien compara contra
 *      el formulario de la DGI.
 *
 * Los demás motivos, en orden:
 *
 *   · **El separador.** Excel en español usa `;` según la configuración regional
 *     de la máquina, no del archivo. Un CSV con comas se abre en una sola
 *     columna en la compu de Josuarth, o al revés en la de otro. La línea
 *     `sep=;` lo arregla en Excel y rompe en todo lo demás.
 *   · **Un RUC como `1554821-1-741203`** entra en el terreno donde Excel adivina
 *     formatos. Como texto explícito, no adivina.
 *   · **Las tildes.** "ESTACIÓN DELTA VÍA ESPAÑA" no depende de que nadie
 *     acierte el encoding: xlsx es UTF-8 por definición.
 *   · **"Sin pasos intermedios"** era el requisito. Un xlsx se abre con doble
 *     clic; un CSV, en el mejor caso también, pero con las tres apuestas de
 *     arriba encima.
 *   · **No suma una dependencia:** `xlsx` ya está en el repo y ya lo usa el
 *     export del VAT Summary. Un formato nuevo sería una segunda forma de hacer
 *     lo mismo.
 *
 * Costo asumido: un xlsx no se puede leer con `cat`. Vale la pena.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * LA REGLA DE LAS CELDAS VACÍAS
 * ═════════════════════════════════════════════════════════════════════════════
 * Un movimiento sin tercero —un asiento de diario, por ejemplo— deja las
 * columnas Nombre, RUC y DV **vacías**. No "—", no "N/A", no "Sin proveedor".
 * Excel tiene que poder filtrar por "vacías", y cualquier texto de relleno
 * rompe ese filtro y además ensucia un ordenamiento.
 */

import * as XLSX from "xlsx";

/** Tipos de celda que este motor sabe escribir. */
export type Celda =
  | { tipo: "texto"; valor: string }
  | { tipo: "numero"; valor: number }
  | { tipo: "entero"; valor: number }
  | { tipo: "fecha"; valor: string }
  | { tipo: "vacia" };

export const VACIA: Celda = { tipo: "vacia" };

/**
 * Texto que Excel NO debe interpretar. Es lo que salva al DV `05` y al RUC.
 *
 * Una cadena vacía se convierte en celda vacía: escribir `""` como texto deja
 * una celda que parece vacía pero no lo es, y el filtro "vacías" no la agarra.
 */
export function texto(v: string | null | undefined): Celda {
  const s = (v ?? "").trim();
  return s === "" ? VACIA : { tipo: "texto", valor: s };
}

/** Número de verdad, para que Excel pueda sumar la columna. */
export function numero(v: number | null | undefined): Celda {
  if (v === null || v === undefined || !Number.isFinite(v)) return VACIA;
  return { tipo: "numero", valor: Math.round(v * 100) / 100 };
}

/** Fecha YYYY-MM-DD como fecha real de Excel, no como texto. */
export function fecha(v: string | null | undefined): Celda {
  const s = (v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { tipo: "fecha", valor: s } : VACIA;
}

/**
 * Cantidad entera: días vencidos, cantidad de documentos.
 *
 * Va aparte de `numero()` porque un contador que ve "183.00 días" tiene que
 * frenar a entender si son días o dinero. El formato de moneda es para dinero.
 */
export function entero(v: number | null | undefined): Celda {
  if (v === null || v === undefined || !Number.isFinite(v)) return VACIA;
  return { tipo: "entero", valor: Math.round(v) };
}

export interface ColumnaExport {
  titulo: string;
  /** Ancho en caracteres. */
  ancho: number;
}

export interface HojaExport {
  /** Máximo 31 caracteres y sin : \ / ? * [ ] — lo exige Excel. */
  nombre: string;
  /** Líneas sueltas antes de la tabla (título, período, cuenta…). */
  encabezado?: string[][];
  columnas: ColumnaExport[];
  filas: Celda[][];
}

/** Excel rechaza nombres de hoja de más de 31 caracteres o con estos signos. */
export function nombreDeHojaValido(nombre: string): string {
  const limpio = nombre.replace(/[:\\/?*[\]]/g, " ").trim();
  return limpio.slice(0, 31) || "Hoja1";
}

const FORMATO_MONEDA = "#,##0.00";
const FORMATO_FECHA = "dd/mm/yyyy";

/**
 * Convierte una fecha ISO al serial de Excel.
 *
 * Se calcula en UTC a propósito: una fecha contable no tiene hora, y usar la
 * hora local de quien genera el archivo desplaza el día en medio mundo.
 */
function serialDeExcel(iso: string): number {
  const ms = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  );
  // 25569 = días entre 1899-12-30 (época de Excel) y 1970-01-01.
  return ms / 86_400_000 + 25569;
}

function escribirHoja(hoja: HojaExport): XLSX.WorkSheet {
  const aoa: unknown[][] = [];
  for (const linea of hoja.encabezado ?? []) aoa.push(linea);
  if ((hoja.encabezado ?? []).length > 0) aoa.push([]);

  const filaTitulos = aoa.length;
  aoa.push(hoja.columnas.map((c) => c.titulo));

  const primeraFilaDatos = aoa.length;
  for (const fila of hoja.filas) {
    aoa.push(fila.map((c) => (c.tipo === "vacia" ? null : c.valor)));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Tipos y formatos celda por celda. `aoa_to_sheet` adivina, y adivinar es
  // exactamente lo que no queremos con el RUC y el DV.
  hoja.filas.forEach((fila, i) => {
    fila.forEach((celda, j) => {
      const ref = XLSX.utils.encode_cell({ r: primeraFilaDatos + i, c: j });
      if (celda.tipo === "vacia") {
        // Que no quede ni una celda con cadena vacía: rompería el filtro
        // "vacías" de Excel, que es como el contador aísla lo que le falta.
        delete ws[ref];
        return;
      }
      const cell = ws[ref];
      if (!cell) return;
      if (celda.tipo === "texto") {
        cell.t = "s";
        cell.v = celda.valor;
      } else if (celda.tipo === "numero") {
        cell.t = "n";
        cell.v = celda.valor;
        cell.z = FORMATO_MONEDA;
      } else if (celda.tipo === "entero") {
        cell.t = "n";
        cell.v = celda.valor;
        cell.z = "0";
      } else {
        cell.t = "n";
        cell.v = serialDeExcel(celda.valor);
        cell.z = FORMATO_FECHA;
      }
    });
  });

  ws["!cols"] = hoja.columnas.map((c) => ({ wch: c.ancho }));
  // Fila de títulos congelada: un mayor de 300 líneas se lee scrolleando.
  ws["!freeze"] = { xSplit: 0, ySplit: filaTitulos + 1 };
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: filaTitulos, c: 0 },
      { r: filaTitulos + hoja.filas.length, c: hoja.columnas.length - 1 }
    ),
  };

  return ws;
}

/** Arma el workbook y devuelve el Buffer listo para responder. */
export function generarXlsx(hojas: HojaExport[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const hoja of hojas) {
    XLSX.utils.book_append_sheet(wb, escribirHoja(hoja), nombreDeHojaValido(hoja.nombre));
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

/**
 * Nombre de archivo seguro: sin acentos ni signos que compliquen la descarga.
 *
 * El CONTENIDO conserva las tildes; solo se limpia el nombre del archivo, que
 * viaja por una cabecera HTTP.
 */
export function nombreDeArchivo(partes: (string | null | undefined)[]): string {
  return (
    partes
      .filter((p): p is string => !!p && p.trim() !== "")
      .join("_")
      .normalize("NFD")
      // Los diacríticos, escritos con su código: el rango literal es invisible
      // en un diff y se pierde en cualquier copiado.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "reporte"
  );
}
