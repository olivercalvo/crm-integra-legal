/**
 * El Excel del «Cuadre al corte» (100): por tercero y por documento, la apertura
 * contra lo que el CRM conoce a la fecha de la apertura. Para el contador.
 */

import { generarXlsx, texto, numero, VACIA, type Celda, type HojaExport } from "@/lib/finanzas/reports/exportar-xlsx";
import { fechaCorta } from "@/lib/finanzas/contabilidad/inicio-contable";
import { ETIQUETA_DEL_ESTADO, type CuadreAlCorte } from "@/lib/finanzas/contabilidad/apertura";

const LADO = { cliente: "Cliente (100004)", proveedor: "Proveedor (200001)" } as const;

export function hojasDelCuadre(fecha: string, cuadre: CuadreAlCorte, conApertura: boolean, generadoEl: string): HojaExport[] {
  const leame: Celda[][] = [
    [texto(`Cuadre al corte: ${fechaCorta(fecha)}`)],
    [VACIA],
    [texto("Por cada cliente (cuenta por cobrar 100004) y cada proveedor (cuenta por pagar 200001), compara el saldo de la apertura con el de los documentos del CRM con fecha hasta el corte (facturas menos cobros y notas de crédito; compras y gastos de trámite menos pagos y notas de crédito).")],
    [texto("La apertura sale de los libros del contador (QuickBooks). Una diferencia no es un error en sí: el CRM sólo conoce lo que se cargó en él. Sirve para revisar cada saldo.")],
    [texto(conApertura ? "Lado apertura: la apertura vigente." : "Todavía no hay apertura: el lado apertura está en cero.")],
    [VACIA],
    [texto("Total clientes, según la apertura"), numero(cuadre.totales.cliente.segunApertura)],
    [texto("Total clientes, según el CRM"), numero(cuadre.totales.cliente.segunCrm)],
    [texto("Diferencia clientes"), numero(cuadre.totales.cliente.diferencia)],
    [texto("Total proveedores, según la apertura"), numero(cuadre.totales.proveedor.segunApertura)],
    [texto("Total proveedores, según el CRM"), numero(cuadre.totales.proveedor.segunCrm)],
    [texto("Diferencia proveedores"), numero(cuadre.totales.proveedor.diferencia)],
    [VACIA],
    [texto(`Generado el ${generadoEl}`)],
  ];
  const porTercero: Celda[][] = cuadre.filas.map((f) => [
    texto(LADO[f.lado]), texto(f.terceroCodigo), texto(f.terceroNombre), numero(f.segunApertura), numero(f.segunCrm),
    numero(f.diferencia), texto(ETIQUETA_DEL_ESTADO[f.estado]),
  ]);
  const porDocumento: Celda[][] = [];
  for (const f of cuadre.filas) {
    for (const d of f.documentos) {
      porDocumento.push([texto(LADO[f.lado]), texto(f.terceroCodigo), texto(f.terceroNombre), texto(d.documento),
        numero(d.segunApertura), numero(d.segunCrm), numero(d.diferencia)]);
    }
  }
  return [
    { nombre: "Léame", columnas: [{ titulo: "", ancho: 60 }, { titulo: "", ancho: 18 }], filas: leame },
    {
      nombre: "Por tercero",
      columnas: [{ titulo: "Cuenta", ancho: 20 }, { titulo: "Código", ancho: 12 }, { titulo: "Cliente o proveedor", ancho: 40 },
        { titulo: "Según la apertura", ancho: 18 }, { titulo: "Según el CRM", ancho: 18 }, { titulo: "Diferencia", ancho: 14 },
        { titulo: "Estado", ancho: 20 }],
      filas: porTercero,
    },
    {
      nombre: "Por documento",
      columnas: [{ titulo: "Cuenta", ancho: 20 }, { titulo: "Código", ancho: 12 }, { titulo: "Cliente o proveedor", ancho: 40 },
        { titulo: "Documento", ancho: 24 }, { titulo: "Según la apertura", ancho: 18 }, { titulo: "Según el CRM", ancho: 18 },
        { titulo: "Diferencia", ancho: 14 }],
      filas: porDocumento,
    },
  ];
}

export function excelDelCuadre(fecha: string, cuadre: CuadreAlCorte, conApertura: boolean, generadoEl: string): Buffer {
  return generarXlsx(hojasDelCuadre(fecha, cuadre, conApertura, generadoEl));
}
