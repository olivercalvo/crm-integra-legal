/**
 * EL CIERRE ANUAL DEL EJERCICIO (Bloque 1, E11, decisión 15; migración `080`).
 * Módulo PURO.
 *
 * Un asiento `source_type = 'cierre'`, módulo CA, con fecha 31/12 del año, que
 * lleva a CERO cada cuenta de resultado (ingreso, costo y gasto) contra la
 * cuenta de resultados acumulados `300002`:
 *
 *   por cada cuenta con saldo del año:   su saldo EN CONTRA
 *   300002:                              la diferencia (utilidad al haber,
 *                                        pérdida al debe)
 *
 * El saldo del año lo calcula la BASE (`finanzas_saldos_de_resultado`, 080),
 * con la misma regla con la que después verifica el asiento: la app arma las
 * líneas con esta función (que también dibuja la vista previa) y el RPC
 * `close_fiscal_year` las compara contra las suyas. Es el patrón de la reversión
 * (`reversion.ts`): una sola implementación del armado, verificada por la base.
 *
 * 🔴 El Estado de Resultado EXCLUYE los asientos de cierre (y sus reversiones):
 *    si no, el año cerrado daría 0. El Balance los incluye: por eso, después del
 *    cierre, la «Utilidad neta» del Balance es la del año siguiente y la del año
 *    cerrado ya vive en 300002.
 */

export const SOURCE_TYPE_CIERRE = "cierre" as const;

/**
 * Los `source_type` que se reversan desde el detalle del asiento
 * (`reverse_journal_entry`). Desde la 080, el cierre anual además del manual:
 * ninguno de los dos tiene un documento con estado que actualizar. 🔒 Un test
 * cruza esta lista con el parche de la 080.
 */
export const SOURCE_TYPES_REVERSABLES_DESDE_EL_ASIENTO: readonly string[] = ["manual", SOURCE_TYPE_CIERRE];

/** La cuenta de resultados acumulados (P-11a: Josuarth la confirma y quizá la renombra). */
export const CUENTA_RESULTADOS_ACUMULADOS = "300002";

/** Saldo del año de una cuenta de resultado, en convención de balanza (débito − crédito). */
export interface SaldoDeResultado {
  account_code: string;
  account_name: string;
  account_type: "income" | "cost" | "expense";
  saldo: number;
}

export interface LineaDeCierre {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  description: string;
}

export type ResultadoCierre =
  | {
      ok: true;
      fecha: string;
      descripcion: string;
      lineas: LineaDeCierre[];
      /** Utilidad del año (positiva) o pérdida (negativa), como se lee en el reporte. */
      utilidad: number;
    }
  | { ok: false; mensaje: string };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function fechaDeCierre(anio: number): string {
  return `${anio}-12-31`;
}

export function construirAsientoDeCierre(
  anio: number,
  saldos: readonly SaldoDeResultado[],
  cuentaResultados: { code: string; name: string } = {
    code: CUENTA_RESULTADOS_ACUMULADOS,
    name: "Resultados acumulados",
  }
): ResultadoCierre {
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    return { ok: false, mensaje: "El año del cierre no es válido." };
  }
  const descripcion = `Cierre del ejercicio ${anio}`;
  const lineas: LineaDeCierre[] = [];
  let neto = 0;

  // Orden por código: es el orden en que el contador lee el plan.
  const ordenados = [...saldos].sort((a, b) =>
    a.account_code.localeCompare(b.account_code, "en", { numeric: true })
  );
  for (const s of ordenados) {
    const saldo = round2(s.saldo);
    if (Math.abs(saldo) < 0.005) continue;
    neto = round2(neto + saldo);
    lineas.push({
      account_code: s.account_code,
      account_name: s.account_name,
      // Saldo deudor (gasto) → se acredita; saldo acreedor (ingreso) → se debita.
      debit: saldo < 0 ? -saldo : 0,
      credit: saldo > 0 ? saldo : 0,
      description: descripcion,
    });
  }

  if (lineas.length === 0) {
    return { ok: false, mensaje: `Las cuentas de resultado no tienen saldo en ${anio}: no hay nada que cerrar.` };
  }

  // La contrapartida: lo que las líneas de arriba dejaron descuadrado. Utilidad
  // (neto < 0 en balanza) va al HABER de 300002; pérdida, al DEBE.
  if (Math.abs(neto) >= 0.005) {
    lineas.push({
      account_code: cuentaResultados.code,
      account_name: cuentaResultados.name,
      debit: neto > 0 ? neto : 0,
      credit: neto < 0 ? -neto : 0,
      description: descripcion,
    });
  }

  return { ok: true, fecha: fechaDeCierre(anio), descripcion, lineas, utilidad: round2(-neto) };
}
