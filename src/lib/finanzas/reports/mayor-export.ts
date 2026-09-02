/**
 * ARMADO DE LA EXPORTACIÓN del Libro Mayor y de la Antigüedad.
 *
 * Josuarth, 25/08/2026: *"si yo entro a la cuenta de gastos de combustible, yo
 * debo poder extraer eso en Excel y ese Excel debe venir con DV, nombre,
 * cantidad de gastos"*.
 *
 * Las columnas salen literal de ahí, más las que pidió Oliver: fecha, número de
 * documento, nombre del tercero, **RUC y DV en columnas separadas**, descripción
 * e importe.
 *
 * Módulo PURO: recibe el reporte ya armado y el mapa de terceros, y devuelve la
 * hoja. No lee la base y no sabe de HTTP — así se puede probar sin ninguna de
 * las dos cosas.
 *
 * 🔴 El RUC y el DV son dos columnas. Nunca se concatenan.
 */

import type { MayorDeCuenta } from "@/lib/finanzas/reports/libro-mayor";
import type { Antiguedad, Tramo } from "@/lib/finanzas/reports/antiguedad";
import { TRAMOS, TRAMO_LABEL, tramoDe } from "@/lib/finanzas/reports/antiguedad";
import {
  SIN_TERCERO,
  type TerceroFiscal,
} from "@/lib/finanzas/reports/tercero-fiscal";
import {
  entero,
  fecha,
  numero,
  texto,
  type Celda,
  type HojaExport,
} from "@/lib/finanzas/reports/exportar-xlsx";

/** Metadatos que van en el encabezado de la hoja, antes de la tabla. */
export interface ContextoExport {
  bufete: string;
  generadoEl: string;
  /** Rango aplicado, si lo hay. */
  desde?: string | null;
  hasta?: string | null;
}

// ---------------------------------------------------------------------------
// LIBRO MAYOR
// ---------------------------------------------------------------------------

const COLUMNAS_MAYOR = [
  { titulo: "Fecha", ancho: 12 },
  { titulo: "Tipo de transacción", ancho: 20 },
  { titulo: "Número de documento", ancho: 22 },
  { titulo: "Nombre", ancho: 34 },
  // Las dos columnas por las que existe todo esto.
  { titulo: "RUC", ancho: 20 },
  { titulo: "DV", ancho: 6 },
  { titulo: "Descripción", ancho: 46 },
  { titulo: "Contrapartida", ancho: 30 },
  { titulo: "Importe", ancho: 14 },
  { titulo: "Saldo", ancho: 14 },
];

/**
 * Arma la hoja del mayor de una cuenta.
 *
 * La fila "Saldo inicial" entra como una fila más, con las columnas de tercero
 * vacías: es parte del reporte y quien exporta espera encontrarla. El saldo
 * corrido no se recalcula — se copia el que ya muestra la pantalla, para que el
 * Excel no pueda diferir de lo que el contador vio.
 */
export function hojaDelMayor(
  mayor: MayorDeCuenta,
  terceros: Map<string, TerceroFiscal>,
  ctx: ContextoExport
): HojaExport {
  const encabezado: string[][] = [
    [ctx.bufete],
    ["Libro Mayor"],
    ["Cuenta", `${mayor.cuenta.code} — ${mayor.cuenta.name}`],
    ["Generado", ctx.generadoEl],
  ];
  if (ctx.desde || ctx.hasta) {
    encabezado.push(["Período", `${ctx.desde || "inicio"} a ${ctx.hasta || "hoy"}`]);
  }
  encabezado.push(["Movimientos", String(mayor.cantidadMovimientos)]);

  const filas: Celda[][] = mayor.filas.map((f) => {
    // Sin asiento no hay tercero: la fila de saldo inicial es el caso típico.
    const t = f.entryId ? terceros.get(f.entryId) ?? SIN_TERCERO : SIN_TERCERO;

    return [
      fecha(f.fecha),
      texto(f.kind === "saldo-inicial" ? "Saldo inicial" : f.tipoTransaccion),
      texto(f.numero),
      // El nombre de la ficha manda sobre el texto del ledger: es el que está
      // al lado del RUC en el formulario de la DGI. Si no hay ficha, queda el
      // que muestra la pantalla.
      texto(t.nombre || f.nombre),
      texto(t.ruc),
      texto(t.dv),
      texto(f.descripcion),
      texto(f.contrapartida),
      f.kind === "saldo-inicial" ? texto("") : numero(f.importe),
      numero(f.saldo),
    ];
  });

  return {
    nombre: `Mayor ${mayor.cuenta.code}`,
    encabezado,
    columnas: COLUMNAS_MAYOR,
    filas,
  };
}

// ---------------------------------------------------------------------------
// ANTIGÜEDAD
// ---------------------------------------------------------------------------
// Usa el MISMO motor y las mismas columnas de tercero. Lo que cambia son las
// cinco columnas de tramo, que son propias de este reporte.

function columnasAntiguedad() {
  return [
    { titulo: "Tercero", ancho: 34 },
    { titulo: "RUC", ancho: 20 },
    { titulo: "DV", ancho: 6 },
    { titulo: "Documento", ancho: 26 },
    { titulo: "Vence", ancho: 12 },
    { titulo: "Días vencido", ancho: 13 },
    { titulo: "Tramo", ancho: 12 },
    ...TRAMOS.map((t: Tramo) => ({ titulo: TRAMO_LABEL[t], ancho: 13 })),
    { titulo: "Total", ancho: 14 },
  ];
}

/**
 * Arma la hoja de la antigüedad, DETALLADA POR DOCUMENTO.
 *
 * Una fila por documento, con su tercero repetido: es lo que hace que la tabla
 * se pueda filtrar y sumar en Excel. Un listado agrupado se ve mejor en pantalla
 * y es inútil dentro de una planilla.
 */
export function hojaDeAntiguedad(
  antiguedad: Antiguedad,
  tipo: "cobrar" | "pagar",
  terceros: Map<string, TerceroFiscal>,
  ctx: ContextoExport
): HojaExport {
  const encabezado: string[][] = [
    [ctx.bufete],
    [tipo === "cobrar" ? "Antigüedad de Cuentas por Cobrar" : "Antigüedad de Cuentas por Pagar"],
    ["Generado", ctx.generadoEl],
    ["Total del auxiliar", antiguedad.control.totalAuxiliar.toFixed(2)],
    [
      `Cuenta control ${antiguedad.control.cuentaCodigo}`,
      antiguedad.control.saldoCuentaControl.toFixed(2),
    ],
    ["Diferencia", antiguedad.control.diferencia.toFixed(2)],
  ];

  const filas: Celda[][] = [];
  for (const fila of antiguedad.filas) {
    for (const doc of fila.documentos) {
      // La clave del mapa acá es el id del DOCUMENTO, no el del asiento: la
      // antigüedad parte de facturas y gastos, no del ledger.
      const t = terceros.get(doc.id) ?? SIN_TERCERO;
      // El mismo `tramoDe()` que usa la pantalla: si el corte cambiara, el
      // Excel y el reporte no podrían quedar diciendo cosas distintas.
      const tramo = tramoDe(doc.diasVencido);

      filas.push([
        texto(t.nombre || fila.tercero),
        texto(t.ruc),
        texto(t.dv),
        texto(doc.numero),
        fecha(doc.fechaReferencia),
        entero(doc.diasVencido),
        texto(TRAMO_LABEL[tramo]),
        ...TRAMOS.map((x) => (tramo === x ? numero(doc.saldo) : texto(""))),
        numero(doc.saldo),
      ]);
    }
  }

  return {
    nombre: tipo === "cobrar" ? "Antiguedad CxC" : "Antiguedad CxP",
    encabezado,
    columnas: columnasAntiguedad(),
    filas,
  };
}
