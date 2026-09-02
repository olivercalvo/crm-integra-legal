/**
 * ANTIGÜEDAD DE SALDOS — por cobrar y por pagar, DETALLADA POR DOCUMENTO.
 *
 * Es lo más específico que pidió Josuarth en la reunión del 25/08: dijo que vio
 * versiones que solo dan el resumen por cliente y que prefiere la que abre y
 * muestra qué facturas componen ese saldo y en qué tramo cae cada una.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE LA GUÍA MARCA COMO NO NEGOCIABLE, Y POR QUÉ HOY NO SE CUMPLE
 * ─────────────────────────────────────────────────────────────────────────────
 * "La suma del auxiliar debe cuadrar con su cuenta control". Hoy no cuadra, y no
 * por un error de cálculo: **el saldo de apertura vino de QuickBooks sin detalle
 * de documentos**. Cuentas por Cobrar cierra en 194.842,55, de los cuales
 * 191.947,55 son apertura sin una sola factura detrás.
 *
 * Este módulo NO esconde esa diferencia: la calcula, la expone en
 * `ControlAuxiliar` y la pantalla la muestra con las tres cifras. Un contador que
 * ve la diferencia declarada entiende el estado del sistema; uno que la descubre
 * solo deja de confiar en el reporte.
 *
 * Módulo PURO: sin I/O.
 */

const EPSILON = 0.005;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Los tramos que nombró Josuarth, que son los términos de pago con los que
 * trabajan. `corriente` es lo que todavía no venció.
 */
export const TRAMOS = ["corriente", "d1_30", "d31_60", "d61_90", "d91_mas"] as const;
export type Tramo = (typeof TRAMOS)[number];

export const TRAMO_LABEL: Record<Tramo, string> = {
  corriente: "Corriente",
  d1_30: "1 a 30",
  d31_60: "31 a 60",
  d61_90: "61 a 90",
  d91_mas: "Más de 91",
};

/**
 * En qué tramo cae un documento según los días vencidos.
 *
 * `diasVencido <= 0` es corriente: todavía no venció. El día 1 de atraso ya cae
 * en "1 a 30", y el 91 en "más de 91" — los bordes se toman así porque es como
 * se leen los términos de pago, no en intervalos abiertos.
 */
export function tramoDe(diasVencido: number): Tramo {
  if (diasVencido <= 0) return "corriente";
  if (diasVencido <= 30) return "d1_30";
  if (diasVencido <= 60) return "d31_60";
  if (diasVencido <= 90) return "d61_90";
  return "d91_mas";
}

/** Un documento pendiente: una factura por cobrar o un gasto por pagar. */
export interface DocumentoPendiente {
  /** Id del documento, para el enlace. */
  id: string;
  /** Número de factura, o la descripción del gasto. */
  numero: string;
  /** Cliente o proveedor. En CxP es texto libre (ver el encabezado del source). */
  tercero: string;
  /** Id del tercero. null en CxP: el proveedor todavía no es una entidad. */
  terceroId: string | null;
  /** La fecha desde la que se cuenta la antigüedad. */
  fechaReferencia: string;
  /** Días transcurridos. Negativo o 0 = todavía no vence. */
  diasVencido: number;
  /** Lo que falta cobrar o pagar. Siempre positivo. */
  saldo: number;
  /** `source_type` del ledger, para armar el enlace al documento. */
  sourceType: string;
}

export interface FilaTercero {
  tercero: string;
  terceroId: string | null;
  /** Saldo repartido por tramo. */
  porTramo: Record<Tramo, number>;
  total: number;
  /** Los documentos que componen ese saldo. Es lo que pidió Josuarth. */
  documentos: DocumentoPendiente[];
}

/**
 * Las tres cifras que la pantalla tiene que mostrar juntas.
 *
 * La diferencia NO se corrige ni se esconde: se declara y se explica.
 */
export interface ControlAuxiliar {
  /** Σ de los documentos pendientes que el sistema conoce. */
  totalAuxiliar: number;
  /** Saldo de la cuenta control en el Balance (apertura + ledger). */
  saldoCuentaControl: number;
  /** `saldoCuentaControl − totalAuxiliar`. */
  diferencia: number;
  /** El saldo de apertura de esa cuenta, que es el grueso de la diferencia. */
  saldoApertura: number;
  cuadra: boolean;
  /** Código y nombre de la cuenta control, para nombrarla en pantalla. */
  cuentaCodigo: string;
  cuentaNombre: string;
}

export interface Antiguedad {
  filas: FilaTercero[];
  /** Totales por tramo, de todos los terceros. */
  totalesPorTramo: Record<Tramo, number>;
  total: number;
  control: ControlAuxiliar;
  /** Tramos que no tienen ningún documento. La pantalla los muestra igual. */
  tramosVacios: Tramo[];
}

function tramosEnCero(): Record<Tramo, number> {
  return { corriente: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_mas: 0 };
}

/**
 * Agrupa los documentos por tercero y los reparte en tramos.
 *
 * El orden de las filas es por saldo descendente: al contador le interesa
 * primero quién debe más, no el orden alfabético.
 */
export function buildAntiguedad(
  documentos: DocumentoPendiente[],
  control: Omit<ControlAuxiliar, "totalAuxiliar" | "diferencia" | "cuadra">
): Antiguedad {
  const porTercero = new Map<string, FilaTercero>();

  for (const doc of documentos) {
    const clave = doc.terceroId ?? doc.tercero;
    const fila =
      porTercero.get(clave) ??
      ({
        tercero: doc.tercero,
        terceroId: doc.terceroId,
        porTramo: tramosEnCero(),
        total: 0,
        documentos: [],
      } satisfies FilaTercero);

    const tramo = tramoDe(doc.diasVencido);
    fila.porTramo[tramo] = round2(fila.porTramo[tramo] + doc.saldo);
    fila.total = round2(fila.total + doc.saldo);
    fila.documentos.push(doc);
    porTercero.set(clave, fila);
  }

  const filas = Array.from(porTercero.values()).sort((a, b) => b.total - a.total);
  // Dentro de cada tercero, del más vencido al menos: es el orden en que se
  // reclama.
  for (const f of filas) f.documentos.sort((a, b) => b.diasVencido - a.diasVencido);

  const totalesPorTramo = tramosEnCero();
  for (const f of filas) {
    for (const t of TRAMOS) totalesPorTramo[t] = round2(totalesPorTramo[t] + f.porTramo[t]);
  }
  const total = round2(TRAMOS.reduce((s, t) => s + totalesPorTramo[t], 0));

  const diferencia = round2(control.saldoCuentaControl - total);

  return {
    filas,
    totalesPorTramo,
    total,
    control: {
      ...control,
      totalAuxiliar: total,
      diferencia,
      cuadra: Math.abs(diferencia) < EPSILON,
    },
    tramosVacios: TRAMOS.filter((t) => Math.abs(totalesPorTramo[t]) < EPSILON),
  };
}
