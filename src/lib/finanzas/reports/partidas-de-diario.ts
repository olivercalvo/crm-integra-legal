/**
 * PARTIDAS DE DIARIO Y DE APERTURA en la antigüedad (E9, punto 10). Módulo PURO.
 *
 * Desde la 071 toda línea contra 100004 / 200001 lleva su tercero, también en
 * un asiento manual o de apertura. Entonces esas líneas ya no son "una
 * diferencia que se explica": son saldo de ese cliente o proveedor, y entran a
 * la tabla como una partida más, por `transaction_date` (no tienen vencimiento).
 *
 * Lo que queda SIN tercero (lo viejo, anterior a la 071) sigue yendo a la
 * explicación de la diferencia, como hasta hoy. Así una línea cuenta en un
 * lado o en el otro, nunca en los dos.
 *
 * Un asiento REVERSADO no entra en ninguno de los dos lados: su reversión
 * (`source_type = 'reversion'`) también movió la cuenta control, y en el mayor
 * los dos suman cero. Contar sólo el original inventaría un saldo.
 */

import type { ConteoConTerceros, DocumentoPendiente } from "@/lib/finanzas/reports/antiguedad";

export type TipoPartida = "cobrar" | "pagar";

/** Los `source_type` cuyas líneas contra la cuenta control son partidas propias. */
export const SOURCE_TYPES_DE_PARTIDA = ["manual", "apertura"] as const;

export interface LineaDeControl {
  entryId: string;
  entryNumber: number;
  sourceType: string;
  /** `journal_entries.transaction_date` (la fecha de registro). */
  fecha: string;
  /** `journal_entries.reference`: el `AD-…` del motor, o null en lo viejo. */
  referencia: string | null;
  debit: number;
  credit: number;
  clientId: string | null;
  supplierId: string | null;
  /** Nombre del tercero de la línea, ya resuelto (cliente o proveedor). */
  terceroNombre: string | null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function diasEntre(fecha: string, hoy: Date): number {
  const h = new Date(hoy);
  h.setHours(0, 0, 0, 0);
  const d = new Date(`${fecha}T00:00:00`);
  return Math.round((h.getTime() - d.getTime()) / 86_400_000);
}

/** El tercero de la línea que corresponde a este auxiliar (cliente en cobrar, proveedor en pagar). */
function terceroDelAuxiliar(l: LineaDeControl, tipo: TipoPartida): string | null {
  return tipo === "cobrar" ? l.clientId : l.supplierId;
}

/**
 * Saldo que la línea le suma al auxiliar: en cobrar el débito sube la cuenta
 * por cobrar; en pagar la sube el crédito.
 */
function efecto(l: LineaDeControl, tipo: TipoPartida): number {
  return tipo === "cobrar" ? l.debit - l.credit : l.credit - l.debit;
}

/**
 * Las líneas CON tercero del auxiliar, agrupadas por asiento y tercero: una
 * partida por cada par. Una partida que neta cero no se lista.
 */
export function partidasDeDiario(
  lineas: LineaDeControl[],
  tipo: TipoPartida,
  reversados: Set<string>,
  hoy: Date = new Date()
): DocumentoPendiente[] {
  const porClave = new Map<string, { linea: LineaDeControl; terceroId: string; saldo: number }>();
  for (const l of lineas) {
    if (reversados.has(l.entryId)) continue;
    const terceroId = terceroDelAuxiliar(l, tipo);
    if (!terceroId) continue;
    const clave = `${l.entryId}:${terceroId}`;
    const actual = porClave.get(clave);
    if (actual) actual.saldo += efecto(l, tipo);
    else porClave.set(clave, { linea: l, terceroId, saldo: efecto(l, tipo) });
  }

  const partidas: DocumentoPendiente[] = [];
  for (const [clave, { linea, terceroId, saldo }] of Array.from(porClave.entries())) {
    const s = round2(saldo);
    if (Math.abs(s) < 0.005) continue;
    const esApertura = linea.sourceType === "apertura";
    const numero = linea.referencia?.trim() || `Asiento N.º ${linea.entryNumber}`;
    partidas.push({
      id: clave,
      numero: esApertura ? `${numero} (apertura)` : numero,
      tercero: linea.terceroNombre ?? "(sin nombre)",
      terceroId,
      fechaReferencia: linea.fecha,
      diasVencido: diasEntre(linea.fecha, hoy),
      saldo: s,
      sourceType: linea.sourceType,
      entryId: linea.entryId,
    });
  }
  return partidas;
}

/**
 * Lo que queda para la EXPLICACIÓN de la diferencia: líneas de asientos
 * manuales SIN el tercero del auxiliar (lo anterior a la 071), de asientos no
 * reversados. Mismo signo que `manualesContraControl` usó siempre: el efecto
 * sobre el mayor tal como se compara contra el auxiliar.
 */
export function manualesSinTercero(
  lineas: LineaDeControl[],
  tipo: TipoPartida,
  reversados: Set<string>
): ConteoConTerceros {
  const asientos = new Set<string>();
  const terceros = new Set<string>();
  let monto = 0;
  for (const l of lineas) {
    if (l.sourceType !== "manual") continue;
    if (reversados.has(l.entryId)) continue;
    if (terceroDelAuxiliar(l, tipo)) continue;
    asientos.add(l.entryId);
    monto += efecto(l, tipo);
    if (l.terceroNombre) terceros.add(l.terceroNombre);
  }
  return {
    cantidad: asientos.size,
    monto: round2(monto),
    terceros: Array.from(terceros).sort((a, b) => a.localeCompare(b, "es")),
  };
}
