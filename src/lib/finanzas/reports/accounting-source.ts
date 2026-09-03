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
 * ─────────────────────────────────────────────────────────────────────────────
 * FILTRO DE PERÍODO — 02/09/2026
 * ─────────────────────────────────────────────────────────────────────────────
 * Antes se sumaban TODOS los movimientos, siempre. Josuarth lo pidió el 18/08:
 * "Balance y estado de resultados a cualquier fecha histórica, misma respuesta
 * siempre". Un Estado de Resultado sin corte de período no es un cierre mensual,
 * es un acumulado desde el origen.
 *
 * El rango se resuelve ACÁ y no en los builders, a propósito. Que el Balance
 * General, el Estado de Resultado y el Balance de Comprobación no puedan
 * divergir no es una coincidencia que haya que mantener a mano: es que los tres
 * leen esta función. Partir el cálculo en tres calculadoras destruiría
 * exactamente esa garantía. Los tres builders quedaron SIN TOCAR.
 *
 * Cada cuenta vuelve con el desglose completo:
 *
 *   saldoApertura       chart_of_accounts.saldo_inicial
 *   movimientoAnterior  neto de las líneas ANTERIORES a `desde` (0 si no hay)
 *   debitos / creditos  sumas de columna DENTRO del rango
 *   saldoInicial        = saldoApertura + movimientoAnterior
 *   saldo               = saldoInicial + debitos − creditos
 *
 * SIN RANGO NO CAMBIA NADA: `movimientoAnterior` es 0, `saldoInicial` es la
 * apertura, y la consulta de líneas sale sin ningún filtro de fecha — la misma
 * de siempre, no una equivalente. Hay un test que fija los cuatro totales.
 *
 * ⚠️ `aperturaDeResultado: "excluir"` es SOLO para el Estado de Resultado por
 * período. El acumulado histórico de una cuenta de resultado no es resultado del
 * trimestre. El Balance General NUNCA usa ese modo: necesita el acumulado a la
 * fecha para que su renglón de patrimonio cuadre con sus propios activos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportAccount } from "@/lib/finanzas/reports/accounting-reports";

type DB = SupabaseClient;

/** Corte de fechas del reporte. Ambos extremos inclusive, ISO `YYYY-MM-DD`. */
export interface RangoReporte {
  /** Inicio del período. Sin esto, `saldoInicial` es la apertura de la cuenta. */
  desde?: string | null;
  /** Fecha de corte. El Balance General usa SOLO este extremo. */
  hasta?: string | null;
}

/**
 * Qué hacer con el `saldo_inicial` de las cuentas de resultado.
 *
 * `"incluir"` (default) — el saldo de apertura suma, como siempre.
 * `"excluir"` — se trata como 0 en income/cost/expense. Es lo correcto para un
 *   Estado de Resultado de un período: lo acumulado de ejercicios anteriores no
 *   es resultado de este.
 */
export type AperturaDeResultado = "incluir" | "excluir";

export interface OpcionesReporte {
  rango?: RangoReporte;
  aperturaDeResultado?: AperturaDeResultado;
}

/** Los tipos de cuenta que forman el Estado de Resultado. */
const TIPOS_DE_RESULTADO = ["income", "cost", "expense"];

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
  tenantId: string,
  rango: RangoReporte = {}
): Promise<Map<string, MovimientoDeCuenta>> {
  const acotado = Boolean(rango.desde || rango.hasta);

  // SIN RANGO se usa la consulta de siempre, sin el join. No es una
  // optimización: es que el caso "sin filtro" tiene que seguir siendo
  // literalmente la misma consulta de antes, no una equivalente.
  let q = acotado
    ? db
        .from("journal_entry_lines")
        .select("account_id, debit, credit, journal_entries!inner(transaction_date)")
        .eq("tenant_id", tenantId)
    : db.from("journal_entry_lines").select("account_id, debit, credit").eq("tenant_id", tenantId);

  if (rango.desde) q = q.gte("journal_entries.transaction_date", rango.desde);
  if (rango.hasta) q = q.lte("journal_entries.transaction_date", rango.hasta);

  const { data, error } = await q;

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
 * Neto (débitos − créditos) ANTERIOR a `desde`, por cuenta.
 *
 * Es el mismo concepto que `sumaMovimientosAnteriores()` del Libro Mayor, con
 * una diferencia de costo que justifica que sean dos: aquella resuelve UNA
 * cuenta (el mayor muestra una sola) y esta resuelve TODAS de una consulta,
 * porque un Balance de Comprobación las lista todas. Unificarlas es una
 * simplificación posterior, con su propio commit — el Mayor hoy funciona y está
 * verificado contra datos reales, y no se toca en este bloque.
 */
async function movimientosAnteriores(
  db: DB,
  tenantId: string,
  desde: string
): Promise<Map<string, number>> {
  const { data, error } = await db
    .from("journal_entry_lines")
    .select("account_id, debit, credit, journal_entries!inner(transaction_date)")
    .eq("tenant_id", tenantId)
    .lt("journal_entries.transaction_date", desde);

  if (error) {
    console.error("[finanzas/reports] movimientosAnteriores failed", error);
    // Devolver un mapa vacío mostraría la apertura de la cuenta como si fuera el
    // saldo al inicio del período: el saldo corrido arrancaría de un número que
    // no es, y el reporte mentiría sin avisar.
    throw new Error("No se pudo calcular el saldo anterior al período");
  }

  const mapa = new Map<string, number>();
  for (const fila of (data ?? []) as {
    account_id: string;
    debit: number | string;
    credit: number | string;
  }[]) {
    const previo = mapa.get(fila.account_id) ?? 0;
    mapa.set(fila.account_id, previo + Number(fila.debit) - Number(fila.credit));
  }
  for (const [id, v] of Array.from(mapa.entries())) mapa.set(id, round2(v));
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
  tenantId: string,
  opciones: OpcionesReporte = {}
): Promise<ReportAccount[]> {
  const rango = opciones.rango ?? {};
  const excluirApertura = opciones.aperturaDeResultado === "excluir";

  const [{ data, error }, movimientos, anteriores] = await Promise.all([
    db.from("chart_of_accounts").select(SELECT_COLS).eq("tenant_id", tenantId).order("code"),
    movimientosPorCuenta(db, tenantId, rango),
    rango.desde
      ? movimientosAnteriores(db, tenantId, rango.desde)
      : Promise.resolve(new Map<string, number>()),
  ]);

  if (error) {
    console.error("[finanzas/reports] loadReportAccounts failed", error);
    throw new Error("No se pudieron leer las cuentas del plan contable");
  }

  const filas = (data ?? []) as unknown as FilaCuenta[];

  return filas
    .filter((r) => {
      if (r.active) return true;
      // Una inactiva entra si tiene algo que aportar al reporte. Con rango eso
      // incluye lo anterior al corte y su propia apertura: si una cuenta
      // desactivada con saldo se cayera del Balance por culpa del filtro, el
      // estado quedaría descuadrado sin decir por qué.
      if (movimientos.has(r.id) || anteriores.has(r.id)) return true;
      return Math.abs(Number(r.saldo_inicial ?? 0)) >= 0.005;
    })
    .map((r) => {
      const m = movimientos.get(r.id) ?? { debitos: 0, creditos: 0, neto: 0 };
      const esDeResultado = TIPOS_DE_RESULTADO.includes(r.account_type);
      // `saldoApertura` guarda SIEMPRE la apertura real, aunque se excluya del
      // cálculo. Es lo que le permite a la pantalla decir CUÁNTO se dejó afuera:
      // un aviso con el número es un dato que el contador puede verificar; sin
      // el número es una disculpa.
      const saldoApertura = round2(Number(r.saldo_inicial ?? 0));
      const excluida = excluirApertura && esDeResultado;
      const apertura = excluida ? 0 : saldoApertura;
      const anterior = anteriores.get(r.id) ?? 0;
      // Lo que la Comprobación muestra como "saldo inicial": no es la apertura
      // de la cuenta cuando hay corte, es el saldo al arrancar el período.
      const inicial = round2(apertura + anterior);
      return {
        code: r.code,
        name: r.name,
        account_type: r.account_type,
        subcategoria: r.subcategoria,
        saldo: round2(inicial + m.neto),
        saldoInicial: inicial,
        saldoApertura,
        aperturaExcluida: excluida ? saldoApertura : 0,
        movimientoAnterior: anterior,
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
