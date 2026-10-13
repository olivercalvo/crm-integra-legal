/**
 * DIARIO GENERAL — los asientos en orden cronológico, con sus líneas.
 *
 * El otro reporte obligatorio de la guía de RM. Donde el Libro Mayor mira UNA
 * cuenta a lo largo del tiempo, el Diario mira TODOS los asientos uno por uno:
 * es el registro tal como se escribió.
 *
 * Se lee con el mismo vocabulario que el mayor —"Factura", "Cobro", "Asiento de
 * diario"— y enlaza al documento de respaldo con las mismas rutas, importadas de
 * `destino-documento.ts`. Tiene que sentirse el mismo sistema, no otro.
 *
 * Módulo PURO: la lectura vive en `diario-general-source.ts`.
 */

import { tipoTransaccionLabel } from "@/lib/finanzas/reports/libro-mayor";
import {
  entraEnElFiltro,
  etiquetaDeModulo,
  moduloDelAsiento,
  type Modulo,
} from "@/lib/finanzas/contabilidad/modulo-del-asiento";

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
  /** 054: nombre de la ficha del tercero de la línea, si lo tiene. */
  tercero_nombre?: string | null;
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
  /** E3: el `source_type` del asiento que revierte, para el módulo de una reversión. */
  reverses_source_type?: string | null;
  /** E3: el número propio del documento (`reference`). */
  reference?: string | null;
  /** E3 (071): referencia externa. */
  referencia_externa?: string | null;
}

export interface LineaDiario {
  code: string;
  name: string;
  descripcion: string;
  /**
   * 054: el tercero de la línea, ya resuelto a nombre. Vacío cuando la línea no
   * nombra a nadie —que es el caso de todo lo anterior al Bloque 7 y de casi
   * todos los asientos automáticos, donde el tercero sale del documento.
   */
  tercero: string;
  debit: number;
  credit: number;
}

export interface AsientoDiario {
  entryId: string;
  /** Correlativo sin huecos que asigna el ledger. */
  numero: number;
  fecha: string;
  /** "Factura", "Cobro", "Pago a proveedor", "Asiento de diario"… el mismo texto que el mayor. */
  tipoTransaccion: string;
  /** E3: el módulo (FAC-ING, CO, AD…), el mismo que el Mayor. */
  modulo: string;
  /** E3: N.º de documento (FAC-HON-000026, CO-000011, AD-000001). */
  numeroDocumento: string;
  /** E3 (071): referencia externa (cheque, factura del proveedor). */
  referenciaExterna: string;
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

/**
 * E9: los asientos de los módulos elegidos (ninguno = todos). En el Diario no
 * hay saldo corrido que cuidar, así que se filtra ANTES de armar: los totales
 * del pie son los de lo que se ve, y cada asiento sigue cuadrando solo.
 */
export function filtrarAsientosPorModulos<T extends Pick<AsientoCrudo, "source_type" | "reverses_source_type">>(
  crudos: T[],
  elegidos: readonly Modulo[]
): T[] {
  if (elegidos.length === 0) return crudos;
  return crudos.filter((a) => entraEnElFiltro(moduloDelAsiento(a.source_type, a.reverses_source_type), elegidos));
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
        tercero: l.tercero_nombre?.trim() || "",
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
      modulo: etiquetaDeModulo(moduloDelAsiento(a.source_type, a.reverses_source_type)),
      numeroDocumento: a.reference?.trim() || "",
      referenciaExterna: a.referencia_externa?.trim() || "",
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
