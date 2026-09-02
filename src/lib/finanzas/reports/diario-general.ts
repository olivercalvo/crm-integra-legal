/**
 * DIARIO GENERAL — los asientos en orden cronológico, con sus líneas.
 *
 * El otro reporte obligatorio de la guía de RM. Donde el Libro Mayor mira UNA
 * cuenta a lo largo del tiempo, el Diario mira TODOS los asientos uno por uno:
 * es el registro tal como se escribió.
 *
 * Se lee con el mismo vocabulario que el mayor —"Factura", "Pago", "Asiento de
 * diario"— y enlaza al documento de respaldo con las mismas rutas, importadas de
 * `destino-documento.ts`. Tiene que sentirse el mismo sistema, no otro.
 *
 * Módulo PURO: la lectura vive en `diario-general-source.ts`.
 */

import { tipoTransaccionLabel } from "@/lib/finanzas/reports/libro-mayor";

const EPSILON = 0.005;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Una línea del asiento, tal como viene de la base. */
export interface LineaCruda {
  line_order: number;
  account_code: string;
  account_name: string;
  line_description: string | null;
  debit: number;
  credit: number;
}

/** Un asiento con sus líneas, tal como viene de la base. */
export interface AsientoCrudo {
  entry_id: string;
  entry_number: number;
  transaction_date: string;
  description: string;
  source_type: string;
  source_id: string | null;
  /** El tercero o el documento, si se pudo resolver. */
  documento: string | null;
  lineas: LineaCruda[];
}

export interface LineaDiario {
  code: string;
  name: string;
  descripcion: string;
  debit: number;
  credit: number;
}

export interface AsientoDiario {
  entryId: string;
  /** Correlativo sin huecos que asigna el ledger. */
  numero: number;
  fecha: string;
  /** "Factura", "Pago", "Asiento de diario"… el mismo texto que el mayor. */
  tipoTransaccion: string;
  /** El documento de respaldo (número de factura, proveedor, referencia). */
  documento: string;
  descripcion: string;
  lineas: LineaDiario[];
  totalDebito: number;
  totalCredito: number;
  /**
   * Un asiento SIEMPRE tiene que cuadrar: el RPC `post_journal_entry` rechaza
   * los que no, y los triggers de `023` impiden editarlos después. Si acá
   * apareciera uno descuadrado, no es un error de presentación: es que algo
   * escribió en el ledger sin pasar por el RPC. Por eso se muestra, no se
   * silencia.
   */
  cuadra: boolean;
  /** Para el enlace al documento. null cuando el asiento no tiene origen. */
  sourceType: string | null;
  sourceId: string | null;
}

export interface DiarioGeneral {
  asientos: AsientoDiario[];
  totalDebito: number;
  totalCredito: number;
  /** Cuántas líneas suman todos los asientos. */
  cantidadLineas: number;
  /** Asientos que no cuadran. Vacío es lo único normal. */
  descuadrados: number[];
}

/** Arma el Diario a partir de los asientos crudos, ya ordenados. */
export function buildDiarioGeneral(crudos: AsientoCrudo[]): DiarioGeneral {
  const asientos: AsientoDiario[] = crudos.map((a) => {
    const lineas: LineaDiario[] = [...a.lineas]
      .sort((x, y) => x.line_order - y.line_order)
      .map((l) => ({
        code: l.account_code,
        name: l.account_name,
        // Si la línea no trae glosa propia, la del asiento explica igual: un
        // renglón sin texto no le dice nada a quien audita.
        descripcion: l.line_description?.trim() || a.description,
        debit: round2(l.debit),
        credit: round2(l.credit),
      }));

    const totalDebito = round2(lineas.reduce((s, l) => s + l.debit, 0));
    const totalCredito = round2(lineas.reduce((s, l) => s + l.credit, 0));

    return {
      entryId: a.entry_id,
      numero: a.entry_number,
      fecha: a.transaction_date,
      tipoTransaccion: tipoTransaccionLabel(a.source_type),
      documento: a.documento ?? "",
      descripcion: a.description,
      lineas,
      totalDebito,
      totalCredito,
      cuadra: Math.abs(totalDebito - totalCredito) < EPSILON,
      sourceType: a.source_type,
      sourceId: a.source_id,
    };
  });

  return {
    asientos,
    totalDebito: round2(asientos.reduce((s, a) => s + a.totalDebito, 0)),
    totalCredito: round2(asientos.reduce((s, a) => s + a.totalCredito, 0)),
    cantidadLineas: asientos.reduce((s, a) => s + a.lineas.length, 0),
    descuadrados: asientos.filter((a) => !a.cuadra).map((a) => a.numero),
  };
}
