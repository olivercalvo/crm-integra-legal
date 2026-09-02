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

/**
 * Neto por cuenta del ledger: `Σ débitos − Σ créditos`, en convención de
 * balanza, que es la misma que usan `saldo_inicial` y los dos reportes.
 *
 * Se traen las líneas y se suman acá porque PostgREST no agrega. Son las líneas
 * de asiento del tenant: decenas hoy, miles cuando el sistema lleve un año. Si
 * algún día pesa, esto se convierte en una vista o un RPC — pero no antes de que
 * pese, y el cambio queda contenido en esta función.
 */
async function netoPorCuenta(db: DB, tenantId: string): Promise<Map<string, number>> {
  const { data, error } = await db
    .from("journal_entry_lines")
    .select("account_id, debit, credit")
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[finanzas/reports] netoPorCuenta failed", error);
    // Devolver un mapa vacío mostraría los saldos de apertura como si fueran los
    // definitivos: exactamente la incoherencia que este módulo vino a cerrar.
    throw new Error("No se pudieron leer los movimientos del libro mayor");
  }

  const neto = new Map<string, number>();
  for (const fila of (data ?? []) as {
    account_id: string;
    debit: number | string;
    credit: number | string;
  }[]) {
    const previo = neto.get(fila.account_id) ?? 0;
    neto.set(fila.account_id, previo + Number(fila.debit) - Number(fila.credit));
  }
  return neto;
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
  const [{ data, error }, neto] = await Promise.all([
    db.from("chart_of_accounts").select(SELECT_COLS).eq("tenant_id", tenantId).order("code"),
    netoPorCuenta(db, tenantId),
  ]);

  if (error) {
    console.error("[finanzas/reports] loadReportAccounts failed", error);
    throw new Error("No se pudieron leer las cuentas del plan contable");
  }

  const filas = (data ?? []) as unknown as FilaCuenta[];

  return filas
    .filter((r) => r.active || neto.has(r.id))
    .map((r) => {
      const movimiento = round2(neto.get(r.id) ?? 0);
      return {
        code: r.code,
        name: r.name,
        account_type: r.account_type,
        subcategoria: r.subcategoria,
        saldo: round2(Number(r.saldo_inicial ?? 0) + movimiento),
        saldoInicial: round2(Number(r.saldo_inicial ?? 0)),
        movimientoLedger: movimiento,
        inactivaConMovimiento: !r.active,
      };
    });
}
