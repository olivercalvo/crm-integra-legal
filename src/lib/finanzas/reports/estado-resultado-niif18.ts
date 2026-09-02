/**
 * Estado de Resultado con la estructura de NIIF 18 — Fase 1, Tareas 3 y 4.
 *
 * Arma el modelo EXACTO que mandó Josuar:
 *
 *   ACTIVIDAD DE OPERACIÓN
 *     Ingresos operativos ................. (subtotal)
 *     Costos operativos ................... (subtotal)
 *     ► Utilidad Bruta operativa
 *     Gastos operativos ................... (subtotal)
 *     ► Utilidad Operativa
 *   ACTIVIDAD DE INVERSIÓN          (solo si hay cuentas)
 *   ACTIVIDAD DE FINANCIAMIENTO     (solo si hay cuentas)
 *   ► Utilidad antes de impuesto sobre la renta
 *     Impuesto sobre la renta
 *   ► Utilidad Neta
 *   DISTRIBUCIÓN A SOCIAS           (sociedad civil, Tarea 4)
 *   ► Resultado del ejercicio = 0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LAS DOS CONVENCIONES DE SIGNO — leer antes de tocar nada
 * ─────────────────────────────────────────────────────────────────────────────
 * Este reporte usa una convención DISTINTA de la del resto del módulo, y es a
 * propósito:
 *
 *   - BALANZA de comprobación (lo que hace `accounting-reports.ts`): los saldos
 *     van tal cual, débito positivo y crédito negativo. Los ingresos salen
 *     NEGATIVOS y una ganancia también.
 *
 *   - REPORTE (lo que pide Josuar acá): los ingresos se leen en positivo y los
 *     costos y gastos van ENTRE PARÉNTESIS, porque restan.
 *
 * El vuelco vive SOLO en esta capa de presentación. El motor de
 * `accounting-reports.ts` se queda en balanza, y por eso los 22 tests que
 * comparan contra el Excel de Josuar siguen sirviendo de red de regresión. Si
 * alguna vez se invierte el motor, el Balance General deja de cuadrar (su cuadre
 * es `Activo + (Pasivo + Patrimonio) = 0`, que solo se cumple en balanza).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA REGLA DE PRESENTACIÓN, COMPLETA, EN UNA LÍNEA
 * ─────────────────────────────────────────────────────────────────────────────
 *     monto = |balanza|     y     va entre paréntesis  ⟺  balanza > 0
 *
 * Sirve para TODOS los renglones —ingresos, costos, gastos, utilidades e
 * impuesto— sin casos especiales, porque en balanza un saldo positivo (débito)
 * siempre es algo que reduce el resultado y uno negativo (crédito) siempre es
 * algo que lo aumenta. Verificado contra los números reales de Josuar:
 *
 *     Derecho Corporativo    -289,800.31  →   289,800.31     (crédito, suma)
 *     Descuentos otorgados        +663.25  →      (663.25)    (débito, resta)
 *     Total de Costos           +9,878.38  →    (9,878.38)
 *     Utilidad Operativa      -244,476.91  →   244,476.91
 *
 * Módulo PURO: sin I/O, sin React.
 */

import {
  ACTIVIDADES,
  ACTIVIDAD_LABEL_ES,
  categoriaNiif18De,
  subcategoriaDe,
  type Actividad,
  type Subcategoria,
} from "@/lib/finanzas/types/chart-of-account";
import type { IsrLine, ReportAccount } from "@/lib/finanzas/reports/accounting-reports";
import { DEFAULT_ISR_RATE } from "@/lib/finanzas/reports/accounting-reports";

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

/** Un monto listo para imprimir, con su saldo original a mano. */
export interface MontoPresentado {
  /** Saldo en convención de BALANZA. Es el que usan la matemática y los tests. */
  balanza: number;
  /** Valor absoluto, que es lo que se imprime. */
  monto: number;
  /** true → se imprime entre paréntesis porque RESTA del resultado. */
  entreParentesis: boolean;
}

/** Aplica la regla de presentación (ver el encabezado del archivo). */
export function presentar(balanza: number): MontoPresentado {
  const n = round2(balanza);
  return { balanza: n, monto: Math.abs(n), entreParentesis: n > 0 };
}

/** Redondeo a 2 decimales, igual que en accounting-reports.ts. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function sumar(accounts: ReportAccount[]): number {
  return round2(accounts.reduce((acc, a) => acc + a.saldo, 0));
}

// ---------------------------------------------------------------------------
// Filas del reporte
// ---------------------------------------------------------------------------

/**
 * El reporte se expone como una LISTA PLANA de filas ya ordenadas.
 *
 * Es deliberado: el Estado de Resultado no es un árbol, es una secuencia que se
 * lee de arriba abajo intercalando grupos, cuentas y subtotales. Con una lista
 * plana, "los bloques vacíos no se muestran" es simplemente no emitir filas, y
 * la UI no tiene que decidir nada.
 */
export type FilaER =
  /** Encabezado de bloque de actividad ("ACTIVIDAD DE OPERACIÓN"). */
  | { kind: "bloque"; label: string; actividad: Actividad }
  /** Encabezado de grupo dentro del bloque ("Ingresos operativos"). */
  | { kind: "grupo"; label: string; subcategoria: Subcategoria }
  /**
   * Una cuenta. `estructural` marca los renglones que NO vienen del plan de
   * cuentas sino de la estructura del reporte (hoy: la distribución a socias).
   * El filtro "solo cuentas con saldo" NO los esconde aunque den 0: sin el
   * renglón de distribución, la sección quedaría con encabezado y nada debajo.
   */
  | {
      kind: "cuenta";
      code: string;
      name: string;
      valor: MontoPresentado;
      estructural?: boolean;
    }
  /** Subtotal de un grupo ("Total ingresos operativos"). */
  | { kind: "subtotal"; label: string; valor: MontoPresentado }
  /** Renglón de resultado destacado (los ► del modelo de Josuar). */
  | { kind: "resultado"; label: string; valor: MontoPresentado }
  /** El impuesto, que lleva nota aclaratoria. */
  | { kind: "impuesto"; label: string; nota: string; valor: MontoPresentado };

export interface TotalesER {
  ingresosOperativos: number;
  costosOperativos: number;
  utilidadBrutaOperativa: number;
  gastosOperativos: number;
  utilidadOperativa: number;
  resultadoInversion: number;
  resultadoFinanciamiento: number;
  utilidadAntesImpuesto: number;
  impuesto: number;
  utilidadNeta: number;
  distribucionSocias: number;
  resultadoDelEjercicio: number;
}

export interface EstadoResultadoNiif18 {
  filas: FilaER[];
  /** Todos en convención de BALANZA. */
  totales: TotalesER;
  isr: IsrLine;
  /** true si se aplicó la sección de distribución a socias. */
  distribucionAplicada: boolean;
  /**
   * Cuentas de resultado que no se pudieron ubicar en ninguna actividad
   * (subcategoría NULL o de balance). El CHECK de BD lo impide en cuentas
   * activas, pero si alguna se cuela NO se pierde: va en su propio bloque y
   * suma a los totales.
   */
  sinClasificar: ReportAccount[];
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/**
 * Código de la cuenta de distribución a socias.
 *
 * PROVISIONAL: Oliver se lo confirma a Josuar por correo. Puede que además
 * quiera un pasivo "Por pagar a socias" para cuando la distribución no se paga
 * de inmediato. Es un parámetro justamente para que cambiarlo no obligue a
 * perseguir el código por medio repositorio.
 */
export const CUENTA_DISTRIBUCION_SOCIAS = "300004";
export const NOMBRE_DISTRIBUCION_SOCIAS = "Distribución a Socias";

export interface EstadoResultadoNiif18Options {
  /** Tasa de ISR como fracción. Default `DEFAULT_ISR_RATE` (0 para Integra). */
  isrRate?: number;
  /**
   * Sociedad civil: el resultado se reparte a las socias y el ejercicio cierra
   * en CERO. Default true (Integra). En una sociedad anónima va false: ahí el
   * resultado queda en el patrimonio y sí paga impuesto a nivel de empresa.
   */
  distribucionASocias?: boolean;
  /** Código de la cuenta de distribución. Default CUENTA_DISTRIBUCION_SOCIAS. */
  cuentaDistribucion?: string;
  /** Nombre de la cuenta de distribución. */
  nombreDistribucion?: string;
}

// ---------------------------------------------------------------------------
// Etiquetas de grupo, en el orden de lectura de cada bloque
// ---------------------------------------------------------------------------

const GRUPOS_POR_BLOQUE = [
  { tipo: "income" as const, label: "Ingresos", totalLabel: "Total ingresos" },
  { tipo: "cost" as const, label: "Costos", totalLabel: "Total costos" },
  { tipo: "expense" as const, label: "Gastos", totalLabel: "Total gastos" },
];

const SUFIJO_ACTIVIDAD: Record<Actividad, string> = {
  operacion: "operativos",
  inversion: "de inversión",
  financiamiento: "por financiamiento",
};

const RESULTADO_BLOQUE_LABEL: Record<Actividad, string> = {
  operacion: "► Utilidad Operativa",
  inversion: "► Resultado de actividades de inversión",
  financiamiento: "► Resultado de actividades de financiamiento",
};

// ---------------------------------------------------------------------------
// Armado
// ---------------------------------------------------------------------------

export function buildEstadoResultadoNiif18(
  accounts: ReportAccount[],
  options: EstadoResultadoNiif18Options = {}
): EstadoResultadoNiif18 {
  const isrRate = options.isrRate ?? DEFAULT_ISR_RATE;
  const conDistribucion = options.distribucionASocias ?? true;
  const codigoDist = options.cuentaDistribucion ?? CUENTA_DISTRIBUCION_SOCIAS;
  const nombreDist = options.nombreDistribucion ?? NOMBRE_DISTRIBUCION_SOCIAS;

  const filas: FilaER[] = [];

  // Solo cuentas de resultado. Las de balance no entran acá.
  const resultado = accounts.filter(
    (a) => a.account_type === "income" || a.account_type === "cost" || a.account_type === "expense"
  );

  // Cuentas que no se pueden ubicar en una actividad. No deberían existir (el
  // CHECK las bloquea en cuentas activas), pero si aparecen NO se pierden.
  const sinClasificar = resultado.filter((a) => categoriaNiif18De(a) === null);

  const totalesPorActividad: Record<Actividad, number> = {
    operacion: 0,
    inversion: 0,
    financiamiento: 0,
  };
  let ingresosOperativos = 0;
  let costosOperativos = 0;
  let gastosOperativos = 0;
  let utilidadBrutaOperativa = 0;

  /**
   * Emite grupo + cuentas + subtotal. Un grupo SIN cuentas no se imprime: en el
   * modelo de Josuar no hay renglones "Total costos 0.00" colgando de un bloque
   * que no tiene costos.
   */
  function emitirGrupo(
    tipo: (typeof GRUPOS_POR_BLOQUE)[number],
    actividad: Actividad,
    cuentas: ReportAccount[],
    subtotal: number
  ): void {
    if (cuentas.length === 0) return;
    const sufijo = SUFIJO_ACTIVIDAD[actividad];
    filas.push({
      kind: "grupo",
      label: `${tipo.label} ${sufijo}`,
      subcategoria: subcategoriaDe(tipo.tipo, actividad) as Subcategoria,
    });
    for (const c of cuentas) {
      filas.push({ kind: "cuenta", code: c.code, name: c.name, valor: presentar(c.saldo) });
    }
    filas.push({
      kind: "subtotal",
      label: `${tipo.totalLabel} ${sufijo}`,
      valor: presentar(subtotal),
    });
  }

  const [GRUPO_INGRESOS, GRUPO_COSTOS, GRUPO_GASTOS] = GRUPOS_POR_BLOQUE;

  for (const actividad of ACTIVIDADES) {
    const delBloque = resultado.filter((a) => categoriaNiif18De(a) === actividad);

    // "Los bloques vacíos no se muestran."
    if (delBloque.length === 0) continue;

    filas.push({ kind: "bloque", label: ACTIVIDAD_LABEL_ES[actividad], actividad });

    const ingresos = ordenar(delBloque.filter((a) => a.account_type === "income"));
    const costos = ordenar(delBloque.filter((a) => a.account_type === "cost"));
    const gastos = ordenar(delBloque.filter((a) => a.account_type === "expense"));

    const tIngresos = sumar(ingresos);
    const tCostos = sumar(costos);
    const tGastos = sumar(gastos);

    emitirGrupo(GRUPO_INGRESOS, actividad, ingresos, tIngresos);
    emitirGrupo(GRUPO_COSTOS, actividad, costos, tCostos);

    // La Utilidad Bruta va DESPUÉS de costos y ANTES de gastos, y solo existe
    // en el bloque de operación. Se emite aunque no haya costos: es una línea
    // de la ESTRUCTURA del reporte, no el subtotal de un grupo de cuentas.
    if (actividad === "operacion") {
      utilidadBrutaOperativa = round2(tIngresos + tCostos);
      filas.push({
        kind: "resultado",
        label: "► Utilidad Bruta operativa",
        valor: presentar(utilidadBrutaOperativa),
      });
    }

    emitirGrupo(GRUPO_GASTOS, actividad, gastos, tGastos);

    const totalBloque = round2(tIngresos + tCostos + tGastos);
    totalesPorActividad[actividad] = totalBloque;

    if (actividad === "operacion") {
      ingresosOperativos = tIngresos;
      costosOperativos = tCostos;
      gastosOperativos = tGastos;
    }

    filas.push({
      kind: "resultado",
      label: RESULTADO_BLOQUE_LABEL[actividad],
      valor: presentar(totalBloque),
    });
  }

  // Bloque de descarte: solo si hay algo que descartar.
  if (sinClasificar.length > 0) {
    filas.push({
      kind: "bloque",
      label: "SIN CLASIFICAR",
      actividad: "operacion",
    });
    for (const c of ordenar(sinClasificar)) {
      filas.push({ kind: "cuenta", code: c.code, name: c.name, valor: presentar(c.saldo) });
    }
    filas.push({
      kind: "subtotal",
      label: "Total sin clasificar",
      valor: presentar(sumar(sinClasificar)),
    });
  }

  const utilidadOperativa = totalesPorActividad.operacion;
  const resultadoInversion = totalesPorActividad.inversion;
  const resultadoFinanciamiento = totalesPorActividad.financiamiento;

  const utilidadAntesImpuesto = round2(
    utilidadOperativa +
      resultadoInversion +
      resultadoFinanciamiento +
      sumar(sinClasificar)
  );

  filas.push({
    kind: "resultado",
    label: "► Utilidad antes de impuesto sobre la renta",
    valor: presentar(utilidadAntesImpuesto),
  });

  // Impuesto: en balanza, una ganancia es NEGATIVA. Solo se grava si la hubo.
  const hayUtilidad = utilidadAntesImpuesto < -0.005;
  const impuesto = hayUtilidad ? round2(-utilidadAntesImpuesto * isrRate) : 0;
  // `huboUtilidad` es exactamente eso y nada más. Antes acá decía
  // `applied: hayUtilidad && impuesto !== 0`, o sea el MISMO campo con otro
  // criterio que el ER clásico: un `false` significaba "no se cobró" en un
  // reporte y "no hubo ganancia" en el otro.
  const isr: IsrLine = { rate: isrRate, amount: impuesto, huboUtilidad: hayUtilidad };

  filas.push({
    kind: "impuesto",
    label: "Impuesto sobre la renta",
    nota: notaImpuesto(isrRate, hayUtilidad),
    valor: presentar(impuesto),
  });

  const utilidadNeta = round2(utilidadAntesImpuesto + impuesto);
  filas.push({
    kind: "resultado",
    label: "► Utilidad Neta",
    valor: presentar(utilidadNeta),
  });

  // ---------------------------------------------------------------------------
  // Tarea 4 — distribución a socias (sociedad civil)
  // ---------------------------------------------------------------------------
  // Integra es sociedad civil: no paga ISR a nivel de empresa, reparte todo a
  // las socias y cada una paga su renta personal. El ejercicio cierra en CERO.
  let distribucionSocias = 0;
  let resultadoDelEjercicio = utilidadNeta;

  if (conDistribucion) {
    // La distribución es exactamente el opuesto de la utilidad neta: por eso el
    // resultado del ejercicio da 0 por construcción, no por casualidad.
    distribucionSocias = round2(-utilidadNeta);
    resultadoDelEjercicio = round2(utilidadNeta + distribucionSocias);

    filas.push({ kind: "bloque", label: "DISTRIBUCIÓN A SOCIAS", actividad: "operacion" });
    filas.push({
      kind: "cuenta",
      code: codigoDist,
      name: nombreDist,
      valor: presentar(distribucionSocias),
      estructural: true,
    });
    filas.push({
      kind: "resultado",
      label: "► Resultado del ejercicio",
      valor: presentar(resultadoDelEjercicio),
    });
  }

  return {
    filas,
    totales: {
      ingresosOperativos,
      costosOperativos,
      utilidadBrutaOperativa,
      gastosOperativos,
      utilidadOperativa,
      resultadoInversion,
      resultadoFinanciamiento,
      utilidadAntesImpuesto,
      impuesto,
      utilidadNeta,
      distribucionSocias,
      resultadoDelEjercicio,
    },
    isr,
    distribucionAplicada: conDistribucion,
    sinClasificar,
  };
}

/** Ordena por código, numérico ("100002" antes que "100010"). */
function ordenar(accounts: ReportAccount[]): ReportAccount[] {
  return [...accounts].sort((a, b) =>
    a.code.localeCompare(b.code, "en", { numeric: true })
  );
}

function notaImpuesto(rate: number, hayUtilidad: boolean): string {
  if (rate === 0) {
    return "sociedad civil: no paga a nivel de empresa — cada socia paga su renta personal";
  }
  if (!hayUtilidad) return "no aplica: el período no cerró con utilidad";
  const pct = (rate * 100).toLocaleString("es-PA", { maximumFractionDigits: 2 });
  return `tasa ${pct}% — a confirmar con el contador`;
}
