/**
 * FUENTE DE DATOS de los reportes contables (Balance General y Estado de
 * Resultado).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONVERGENCIA — 02/09/2026
 * ─────────────────────────────────────────────────────────────────────────────
 * Hasta hoy el saldo de cada cuenta ERA su `saldo_inicial` a secas, y el Libro
 * Mayor sí leía el ledger. Con diez asientos sembrados en staging, eso daba dos
 * números distintos para la misma cuenta: el Balance mostraba Cuentas por Cobrar
 * en 191.947,55 y el mayor cerraba en 194.842,55.
 *
 * Comparar el balance contra el mayor de una cuenta de control es lo primero que
 * hace un contador. Dos números distintos para la misma cuenta no se leen como
 * "falta una fase": se leen como que el sistema no es confiable.
 *
 * Ahora:  saldo = saldo_inicial + Σ (débitos − créditos) del ledger
 *
 * El saldo inicial SIGUE viviendo en `chart_of_accounts`. No se convirtió en
 * asiento de apertura, y no hace falta para converger: el asiento de apertura
 * depende de la fecha de corte, que está pendiente de confirmación del contador.
 *
 * ⚠️ NO HAY FILTRO DE PERÍODO. Se suman TODOS los movimientos registrados. El
 * corte por fecha es una decisión contable pendiente, y el aviso en pantalla lo
 * dice con esas palabras en vez de dejar creer que hay un corte.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportAccount } from "@/lib/finanzas/reports/accounting-reports";

type DB = SupabaseClient;

/** Columnas que hacen falta para reportar. `id` se usa para cruzar el ledger. */
const SELECT_COLS = "id, code, name, account_type, subcategoria, saldo_inicial, active";

interface FilaCuenta {
  id: string;
  code: string;
  name: string;
  account_type: ReportAccount["account_type"];
  subcategoria: ReportAccount["subcategoria"];
  saldo_inicial: number | string | null;
  active: boolean;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Lo que el ledger le suma a una cuenta, con el débito y el crédito aparte. */
export interface MovimientoDeCuenta {
  /** Σ de la columna débito. */
  debitos: number;
  /** Σ de la columna crédito. */
  creditos: number;
  /** `debitos − creditos`, en convención de balanza. */
  neto: number;
}

/**
 * Movimientos por cuenta del ledger, en convención de balanza — la misma que
 * usan `saldo_inicial` y los reportes.
 *
 * Débitos y créditos van SEPARADOS además del neto porque el Balance de
 * Comprobación los muestra en columnas propias. Que salgan de esta única lectura
 * es lo que hace que ese reporte no pueda divergir del Balance General: no es
 * que coincidan, es que es el mismo número.
 *
 * Se traen las líneas y se suman acá porque PostgREST no agrega. Son las líneas
 * de asiento del tenant: decenas hoy, miles cuando el sistema lleve un año. Si
 * algún día pesa, esto se convierte en una vista o un RPC — pero no antes de que
 * pese, y el cambio queda contenido en esta función.
 */
async function movimientosPorCuenta(
  db: DB,
  tenantId: string
): Promise<Map<string, MovimientoDeCuenta>> {
  const { data, error } = await db
    .from("journal_entry_lines")
    .select("account_id, debit, credit")
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[finanzas/reports] movimientosPorCuenta failed", error);
    // Devolver un mapa vacío mostraría los saldos de apertura como si fueran los
    // definitivos: exactamente la incoherencia que este módulo vino a cerrar.
    throw new Error("No se pudieron leer los movimientos del libro mayor");
  }

  const mapa = new Map<string, MovimientoDeCuenta>();
  for (const fila of (data ?? []) as {
    account_id: string;
    debit: number | string;
    credit: number | string;
  }[]) {
    const previo = mapa.get(fila.account_id) ?? { debitos: 0, creditos: 0, neto: 0 };
    previo.debitos += Number(fila.debit);
    previo.creditos += Number(fila.credit);
    mapa.set(fila.account_id, previo);
  }
  // El neto se calcula al final para no arrastrar error de redondeo por línea.
  for (const [id, m] of Array.from(mapa.entries())) {
    mapa.set(id, {
      debitos: round2(m.debitos),
      creditos: round2(m.creditos),
      neto: round2(m.debitos - m.creditos),
    });
  }
  return mapa;
}

/**
 * Trae las cuentas del tenant con su saldo REAL para reportar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ YA NO SE FILTRA POR `active = true`
 * ─────────────────────────────────────────────────────────────────────────────
 * El filtro existía por una razón buena: las 34 cuentas viejas de QuickBooks
 * quedaron desactivadas al cargar el plan de Josuar, y traerlas ensuciaba los
 * reportes con renglones en 0 que él no reconoce.
 *
 * Pero al sumar el ledger se vuelve peligroso: una cuenta DESACTIVADA CON
 * MOVIMIENTOS desaparecería del Balance llevándose su saldo, y el estado
 * quedaría descuadrado sin decir por qué. Desactivar una cuenta es una decisión
 * de catálogo; los asientos que ya tiene son un hecho contable y no se van a
 * ningún lado.
 *
 * La regla nueva: entran las activas, MÁS las inactivas que tengan movimiento.
 * Una inactiva sin movimiento sigue fuera — es lo que el filtro protegía.
 *
 * Las que entran por tener movimiento vienen marcadas con `inactivaConMovimiento`
 * para que la pantalla lo diga: un renglón que el contador no reconoce necesita
 * explicación, no silencio.
 */
export async function loadReportAccounts(
  db: DB,
  tenantId: string
): Promise<ReportAccount[]> {
  const [{ data, error }, movimientos] = await Promise.all([
    db.from("chart_of_accounts").select(SELECT_COLS).eq("tenant_id", tenantId).order("code"),
    movimientosPorCuenta(db, tenantId),
  ]);

  if (error) {
    console.error("[finanzas/reports] loadReportAccounts failed", error);
    throw new Error("No se pudieron leer las cuentas del plan contable");
  }

  const filas = (data ?? []) as unknown as FilaCuenta[];

  return filas
    .filter((r) => r.active || movimientos.has(r.id))
    .map((r) => {
      const m = movimientos.get(r.id) ?? { debitos: 0, creditos: 0, neto: 0 };
      const inicial = round2(Number(r.saldo_inicial ?? 0));
      return {
        code: r.code,
        name: r.name,
        account_type: r.account_type,
        subcategoria: r.subcategoria,
        saldo: round2(inicial + m.neto),
        saldoInicial: inicial,
        movimientoLedger: m.neto,
        // Débito y crédito POR SEPARADO: el Balance de Comprobación los muestra
        // en columnas distintas. Salen de la MISMA lectura que el neto, y por eso
        // los dos reportes no pueden divergir — no es que coincidan, es que es el
        // mismo número.
        debitos: m.debitos,
        creditos: m.creditos,
        inactivaConMovimiento: !r.active,
      };
    });
}
