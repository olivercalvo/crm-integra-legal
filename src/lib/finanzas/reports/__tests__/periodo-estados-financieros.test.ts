/**
 * FILTRO DE PERÍODO en los tres estados financieros.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ PROTEGE ESTE ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────────
 * El modo de falla de este cambio no es que el código explote: es que un reporte
 * devuelva un número plausible y equivocado. Un contador no lo detecta leyendo
 * la pantalla; lo detecta cuando el Balance no cuadra, o peor, no lo detecta.
 *
 * Por eso las pruebas son sobre INVARIANTES contables, no sobre la forma de la
 * salida:
 *
 *   1. Sin filtro, los cuatro totales no se movieron un centavo.
 *   2. Σ saldo inicial = 0,00 en CUALQUIER corte. Un ledger cuadrado sigue
 *      cuadrado en cualquier fecha; si un corte lo rompe, el corte está mal.
 *   3. Σ débitos = Σ créditos dentro del rango.
 *   4. Con filtro activo, Activo = Pasivo + Patrimonio al centavo. Es el modo de
 *      falla que este bloque puede introducir y que ninguno de los otros tres
 *      cubre: el Balance toma su renglón de patrimonio de un cálculo de
 *      resultado, y si ese cálculo cambia de alcance con el filtro, el estado
 *      deja de cuadrar.
 *   5. Los tres números de resultado coinciden: el del builder clásico, el de
 *      NIIF 18 y el que el Balance lleva al patrimonio.
 *
 * El rango elegido para (4) corta ENTRE dos asientos, así que lo anterior al
 * corte NO netea a cero cuenta por cuenta. Esa precaución no es teórica: al
 * verificar el Libro Mayor contra staging, el primer rango probado tenía los
 * movimientos previos cancelándose (+1.070 +150 −1.070 −150) y el resultado se
 * veía idéntico a no ajustar nada. Un rango así habría dado por buena una
 * implementación rota.
 *
 * Ejecución:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { loadReportAccounts } from "@/lib/finanzas/reports/accounting-source";
import { buildAccountingReports } from "@/lib/finanzas/reports/accounting-reports";
import { buildEstadoResultadoNiif18 } from "@/lib/finanzas/reports/estado-resultado-niif18";
import { buildBalanceComprobacion } from "@/lib/finanzas/reports/balance-comprobacion";
import { JOSUAR_ACCOUNTS } from "./josuar-accounts.fixture";

const EPSILON = 0.005;
const TENANT = "tenant-de-prueba";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function assertMoney(actual: number, esperado: number, mensaje: string): void {
  assert.ok(
    Math.abs(actual - esperado) < EPSILON,
    `${mensaje}: esperado ${esperado.toFixed(2)}, obtenido ${actual.toFixed(2)}`
  );
}

// ---------------------------------------------------------------------------
// El ledger de prueba: DOS asientos, cada uno cuadrado, en fechas distintas
// ---------------------------------------------------------------------------
// Sumados dan exactamente los movimientos que hay sembrados en staging, así que
// SIN FILTRO el reporte tiene que dar los mismos totales que la app real. Están
// partidos en dos fechas para que exista un corte con movimientos previos que no
// se cancelan entre sí.

/** Asiento del 15/04. Cuadra: 2895 − 2500 − 315 − 80 = 0. */
const ASIENTO_ABRIL: Record<string, number> = {
  "100004": 2895.0,
  "400001": -2500.0,
  "200003": -315.0,
  "130003": -80.0,
};

/** Asiento del 15/06. Cuadra por construcción: es el resto del total. */
const ASIENTO_JUNIO: Record<string, number> = {
  "100001": 2070.0,
  "130003": -70.0,
  "200001": -3594.25,
  "400006": -2000.0,
  "500003": 325.5,
  "500005": 320.0,
  "610001": 1850.0,
  "610002": 700.0,
  "610008": 152.35,
  "610009": 246.4,
};

const FECHA_ABRIL = "2026-04-15";
const FECHA_JUNIO = "2026-06-15";

interface LineaFalsa {
  account_id: string;
  debit: number;
  credit: number;
  fecha: string;
}

function lineasDe(asiento: Record<string, number>, fecha: string): LineaFalsa[] {
  return Object.entries(asiento).map(([code, neto]) => ({
    account_id: code, // el fixture no tiene ids: el código hace de id
    debit: neto > 0 ? neto : 0,
    credit: neto < 0 ? -neto : 0,
    fecha,
  }));
}

const LINEAS: LineaFalsa[] = [
  ...lineasDe(ASIENTO_ABRIL, FECHA_ABRIL),
  ...lineasDe(ASIENTO_JUNIO, FECHA_JUNIO),
];

// ---------------------------------------------------------------------------
// Doble de Supabase: lo mínimo que `loadReportAccounts` usa
// ---------------------------------------------------------------------------
// Se prueba el LOADER y no una reimplementación de su aritmética, porque el
// corte de fechas vive ahí: filtrar en el test lo que el código debería filtrar
// sería probar el test contra sí mismo.

type Filtro = { op: "gte" | "lte" | "lt"; valor: string };

function db(): unknown {
  function consulta(tabla: string) {
    const filtros: Filtro[] = [];
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      gte: (_c: string, v: string) => (filtros.push({ op: "gte", valor: v }), q),
      lte: (_c: string, v: string) => (filtros.push({ op: "lte", valor: v }), q),
      lt: (_c: string, v: string) => (filtros.push({ op: "lt", valor: v }), q),
      then: (resolve: (r: { data: unknown; error: null }) => void) => {
        if (tabla === "chart_of_accounts") {
          return resolve({
            data: JOSUAR_ACCOUNTS.map((a) => ({
              id: a.code,
              code: a.code,
              name: a.name,
              account_type: a.account_type,
              subcategoria: a.subcategoria,
              saldo_inicial: a.saldo,
              active: true,
            })),
            error: null,
          });
        }
        const filas = LINEAS.filter((l) =>
          filtros.every((f) =>
            f.op === "gte" ? l.fecha >= f.valor : f.op === "lte" ? l.fecha <= f.valor : l.fecha < f.valor
          )
        ).map((l) => ({ account_id: l.account_id, debit: l.debit, credit: l.credit }));
        return resolve({ data: filas, error: null });
      },
    };
    return q;
  }
  return { from: (t: string) => consulta(t) };
}

const CUENTAS_DE_RESULTADO = ["income", "cost", "expense"];

// ---------------------------------------------------------------------------
// 1. SIN FILTRO, NADA SE MUEVE
// ---------------------------------------------------------------------------

test("sin filtro: los cuatro totales son exactamente los de antes del cambio", async () => {
  // Medidos contra staging el 02/09/2026, antes de tocar nada. Si este test
  // falla, el filtro cambió el caso por defecto — que es justo lo que no puede
  // pasar: la mayoría de las veces el contador entra sin filtrar.
  const cuentas = await loadReportAccounts(db() as never, TENANT);
  const { balanceGeneral: bg } = buildAccountingReports(cuentas);

  assertMoney(bg.activos.total, 262717.46, "Activo");
  assertMoney(bg.pasivos.total, -17334.8, "Pasivo");
  assertMoney(bg.patrimonio.total, -245382.66, "Patrimonio");
  assertMoney(bg.descuadre, 0, "descuadre");
  assert.equal(bg.cuadra, true);
});

test("sin filtro: `saldoInicial` sigue siendo la apertura y no hay movimiento anterior", async () => {
  const cuentas = await loadReportAccounts(db() as never, TENANT);
  for (const c of cuentas) {
    assert.equal(c.movimientoAnterior ?? 0, 0, `${c.code} no debería tener anterior`);
    assertMoney(c.saldoInicial ?? 0, c.saldoApertura ?? 0, `${c.code} saldoInicial`);
  }
});

// ---------------------------------------------------------------------------
// 2 y 3. INVARIANTES QUE VALEN EN CUALQUIER CORTE
// ---------------------------------------------------------------------------

const CORTES: { nombre: string; desde?: string; hasta?: string }[] = [
  { nombre: "sin filtro" },
  { nombre: "solo hasta, antes de todo", hasta: "2026-01-31" },
  { nombre: "solo hasta, entre los dos asientos", hasta: "2026-05-01" },
  { nombre: "solo hasta, después de todo", hasta: "2026-12-31" },
  { nombre: "rango que parte los dos asientos", desde: "2026-05-01", hasta: "2026-12-31" },
  { nombre: "rango que deja los dos afuera", desde: "2026-07-01", hasta: "2026-12-31" },
  { nombre: "rango que toma solo abril", desde: "2026-04-01", hasta: "2026-04-30" },
];

for (const corte of CORTES) {
  test(`Σ saldo inicial = 0,00 — ${corte.nombre}`, async () => {
    // Un ledger de partida doble está cuadrado en cualquier fecha: la suma de
    // los saldos al inicio del período tiene que dar cero. Si un corte lo
    // rompe, el corte está mal calculado. Es la alarma más barata del bloque.
    const cuentas = await loadReportAccounts(db() as never, TENANT, {
      rango: { desde: corte.desde, hasta: corte.hasta },
    });
    const suma = round2(cuentas.reduce((a, c) => a + (c.saldoInicial ?? 0), 0));
    assertMoney(suma, 0, `Σ saldo inicial (${corte.nombre})`);
  });

  test(`Σ débitos = Σ créditos — ${corte.nombre}`, async () => {
    const cuentas = await loadReportAccounts(db() as never, TENANT, {
      rango: { desde: corte.desde, hasta: corte.hasta },
    });
    const debitos = round2(cuentas.reduce((a, c) => a + (c.debitos ?? 0), 0));
    const creditos = round2(cuentas.reduce((a, c) => a + (c.creditos ?? 0), 0));
    assertMoney(debitos, creditos, `débitos vs créditos (${corte.nombre})`);
  });

  test(`el Balance cuadra — ${corte.nombre}`, async () => {
    const cuentas = await loadReportAccounts(db() as never, TENANT, {
      rango: { desde: corte.desde, hasta: corte.hasta },
    });
    const { balanceGeneral: bg } = buildAccountingReports(cuentas);
    assertMoney(bg.descuadre, 0, `descuadre (${corte.nombre})`);
    assertMoney(
      bg.activos.total + bg.totalPasivoPatrimonio,
      0,
      `Activo vs Pasivo+Patrimonio (${corte.nombre})`
    );
  });
}

// ---------------------------------------------------------------------------
// 4. EL TEST QUE IMPORTA: filtro activo, movimientos previos que NO se cancelan
// ---------------------------------------------------------------------------

test("con filtro desde 2026-05-01: lo anterior NO netea a cero cuenta por cuenta", async () => {
  // Precondición del test siguiente. Si el asiento de abril llegara a
  // cancelarse solo, el corte no probaría nada y el test de cuadre pasaría
  // aunque el ajuste estuviera roto.
  const cuentas = await loadReportAccounts(db() as never, TENANT, {
    rango: { desde: "2026-05-01" },
  });
  const conAnterior = cuentas.filter((c) => Math.abs(c.movimientoAnterior ?? 0) >= EPSILON);
  assert.equal(
    conAnterior.length,
    Object.keys(ASIENTO_ABRIL).length,
    "el corte tiene que dejar movimientos previos en las 4 cuentas de abril"
  );
  // Y el ajuste tiene que ser el del asiento de abril, cuenta por cuenta.
  for (const [code, neto] of Object.entries(ASIENTO_ABRIL)) {
    const c = cuentas.find((x) => x.code === code);
    assert.ok(c, `falta ${code}`);
    assertMoney(c!.movimientoAnterior ?? 0, neto, `movimiento anterior de ${code}`);
    assertMoney(c!.saldoInicial ?? 0, round2((c!.saldoApertura ?? 0) + neto), `saldo inicial de ${code}`);
  }
});

test("con filtro desde 2026-05-01: Activo = Pasivo + Patrimonio al centavo", async () => {
  const cuentas = await loadReportAccounts(db() as never, TENANT, {
    rango: { desde: "2026-05-01", hasta: "2026-12-31" },
  });
  const { balanceGeneral: bg } = buildAccountingReports(cuentas);

  assertMoney(bg.descuadre, 0, "descuadre con filtro");
  assert.equal(bg.cuadra, true);
  // Y el saldo final no depende del corte: los mismos totales que sin filtro,
  // porque el rango cubre todo el ledger arrancando después de abril.
  assertMoney(bg.activos.total, 262717.46, "Activo con filtro");
  assertMoney(bg.pasivos.total, -17334.8, "Pasivo con filtro");
});

// ---------------------------------------------------------------------------
// 5. LOS TRES NÚMEROS DE RESULTADO SON EL MISMO
// ---------------------------------------------------------------------------

test("clásico, NIIF 18 y el renglón del Balance dan el mismo resultado", async () => {
  // Hoy coinciden en −245.382,66, pero nada lo protegía: son DOS builders
  // distintos alimentados por la misma fuente, y el Balance toma el del clásico
  // mientras el contador lee el de NIIF 18 en /pyl. Si se separan, la pantalla y
  // el patrimonio dirían números distintos sin que nadie se entere.
  const cuentas = await loadReportAccounts(db() as never, TENANT);
  const { estadoResultado: clasico, balanceGeneral: bg } = buildAccountingReports(cuentas);
  const niif = buildEstadoResultadoNiif18(cuentas);

  assertMoney(
    clasico.utilidadOperativa,
    niif.totales.utilidadAntesImpuesto,
    "clásico vs NIIF 18"
  );
  assertMoney(
    bg.utilidadDelEjercicio,
    clasico.utilidadOperativa,
    "el Balance lleva al patrimonio el resultado del clásico"
  );
});

// ---------------------------------------------------------------------------
// 6. LA APERTURA DE RESULTADO SE EXCLUYE SOLO CUANDO SE PIDE
// ---------------------------------------------------------------------------

test('aperturaDeResultado "excluir": las cuentas de resultado arrancan en cero', async () => {
  const cuentas = await loadReportAccounts(db() as never, TENANT, {
    rango: { desde: "2026-01-01", hasta: "2026-12-31" },
    aperturaDeResultado: "excluir",
  });

  for (const c of cuentas) {
    if (CUENTAS_DE_RESULTADO.includes(c.account_type)) {
      assertMoney(c.saldoInicial ?? 0, 0, `${c.code} debería arrancar en 0`);
      assertMoney(c.aperturaExcluida ?? 0, c.saldoApertura ?? 0, `${c.code} apertura excluida`);
    } else {
      // Las de balance NO se tocan: su apertura es patrimonio real, no
      // resultado de un ejercicio anterior.
      assertMoney(c.aperturaExcluida ?? 0, 0, `${c.code} no debería excluir nada`);
      assertMoney(c.saldoInicial ?? 0, c.saldoApertura ?? 0, `${c.code} saldo inicial`);
    }
  }
});

test('aperturaDeResultado "excluir" NO se aplica sin pedirlo', async () => {
  const cuentas = await loadReportAccounts(db() as never, TENANT, {
    rango: { desde: "2026-01-01", hasta: "2026-12-31" },
  });
  const excluido = round2(cuentas.reduce((a, c) => a + (c.aperturaExcluida ?? 0), 0));
  assertMoney(excluido, 0, "sin pedirlo no se excluye nada");
});

test("el número que la pantalla informa es la suma de lo excluido", async () => {
  // La nota del Estado de Resultado tiene que decir CUÁNTO se dejó afuera, no
  // solo que se dejó algo. El número sale de sumar el campo, no de un cálculo
  // paralelo que podría desincronizarse del reporte.
  const cuentas = await loadReportAccounts(db() as never, TENANT, {
    rango: { desde: "2026-01-01" },
    aperturaDeResultado: "excluir",
  });
  const excluido = round2(cuentas.reduce((a, c) => a + (c.aperturaExcluida ?? 0), 0));
  const aperturaDeResultado = round2(
    JOSUAR_ACCOUNTS.filter((a) => CUENTAS_DE_RESULTADO.includes(a.account_type)).reduce(
      (a, c) => a + c.saldo,
      0
    )
  );
  assertMoney(excluido, aperturaDeResultado, "lo excluido es la apertura de resultado");
});

// ---------------------------------------------------------------------------
// 7. LA COMPROBACIÓN SIGUE CUADRANDO CON CORTE
// ---------------------------------------------------------------------------

test("Balance de Comprobación: cuadra en cualquier corte", async () => {
  for (const corte of CORTES) {
    const cuentas = await loadReportAccounts(db() as never, TENANT, {
      rango: { desde: corte.desde, hasta: corte.hasta },
    });
    const comp = buildBalanceComprobacion(cuentas);
    assertMoney(comp.totales.saldoInicial, 0, `saldo inicial (${corte.nombre})`);
    assertMoney(comp.totales.debitos, comp.totales.creditos, `sumas (${corte.nombre})`);
    assertMoney(comp.totales.saldoFinal, 0, `saldo final (${corte.nombre})`);
    assert.equal(comp.totales.cuadra, true, `cuadra (${corte.nombre})`);
  }
});
