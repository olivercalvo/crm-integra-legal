/**
 * PERÍODOS CONTABLES — estado y presentación.
 *
 * La tabla `accounting_periods` existe desde la migración `023` y el motor ya la
 * hace cumplir: `post_journal_entry` aborta si el período de la fecha está
 * `cerrado` (paso 6, migración `030`). Lo que faltaba —y es lo único que agrega
 * este bloque— era **poder cerrarlo y reabrirlo desde la aplicación**: hasta hoy
 * se hacía con un `UPDATE` a mano en el SQL Editor.
 *
 * ⚠️ Este módulo NO valida fechas de asientos ni decide si un asiento entra. Eso
 * lo hace el RPC, en la base, y duplicarlo acá crearía dos verdades. Acá solo se
 * lee el estado y se decide cómo mostrarlo.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * SON TRES ESTADOS VISIBLES, NO DOS
 * ═════════════════════════════════════════════════════════════════════════════
 * La columna `status` tiene dos valores (`abierto` / `cerrado`), pero para quien
 * mira la pantalla hay **tres situaciones distintas**, y la tercera importa:
 *
 *   · **abierto**   — nunca se cerró. `closed_at IS NULL`.
 *   · **cerrado**   — cerrado y certificado.
 *   · **reabierto** — `status = 'abierto'` PERO `closed_at IS NOT NULL`: alguien
 *     lo cerró y después lo volvió a abrir.
 *
 * El tercero no es un detalle cosmético. Un período reabierto es un ejercicio que
 * el contador **ya dio por cerrado ante la DGI** y que hoy vuelve a admitir
 * asientos. Mostrarlo igual que uno que nunca se cerró esconde exactamente el
 * hecho que hay que ver.
 *
 * Es lo que hace útil conservar `closed_at` al reabrir en vez de limpiarlo — ver
 * la ruta `PATCH /api/finanzas/periodos`.
 *
 * Módulo PURO: sin I/O, sin React, sin Supabase.
 */

export type EstadoPeriodo = "abierto" | "cerrado" | "reabierto";

/** Una fila de `accounting_periods` tal como la lee la app. */
export interface PeriodoRow {
  id: string;
  year: number;
  month: number;
  /** El valor crudo de la columna: solo `abierto` o `cerrado`. */
  status: "abierto" | "cerrado";
  closed_at: string | null;
  closed_by: string | null;
  /** Nombre de quien lo cerró, resuelto contra `users`. */
  closed_by_name?: string | null;
  /** Asientos ya posteados en el período. */
  asientos: number;
}

/** Las acciones que admite la ruta. */
export type AccionPeriodo = "cerrar" | "reabrir";

export const ACCIONES: AccionPeriodo[] = ["cerrar", "reabrir"];

export function esAccionPeriodo(v: unknown): v is AccionPeriodo {
  return typeof v === "string" && (ACCIONES as string[]).includes(v);
}

/**
 * El estado VISIBLE de un período — los tres, no los dos de la columna.
 *
 * `reabierto` se deduce de la combinación `status='abierto'` + `closed_at`
 * presente. No hay una columna que lo diga porque no hace falta: la información
 * ya está, y agregar una tercera opción al CHECK obligaría a una migración del
 * esquema que este bloque no necesita.
 */
export function estadoDe(p: Pick<PeriodoRow, "status" | "closed_at">): EstadoPeriodo {
  if (p.status === "cerrado") return "cerrado";
  return p.closed_at ? "reabierto" : "abierto";
}

export const ESTADO_LABEL: Record<EstadoPeriodo, string> = {
  abierto: "Abierto",
  cerrado: "Cerrado",
  reabierto: "Reabierto",
};

/** Los doce meses, en español, para el rótulo del período. */
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "marzo 2026". Devuelve el número si el mes está fuera de rango. */
export function etiquetaPeriodo(year: number, month: number): string {
  const nombre = MESES[month - 1];
  return nombre ? `${nombre} ${year}` : `${month}/${year}`;
}

/** "2026-03", que es como lo nombran los mensajes del RPC. */
export function codigoPeriodo(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * ¿La acción pedida cambia algo?
 *
 * Cerrar un período ya cerrado, o reabrir uno abierto, no es un error: es un
 * doble clic o dos personas a la vez. Se contesta que no hay nada que hacer en
 * vez de fingir que se hizo algo — y sobre todo, **sin escribir**: un cierre
 * repetido pisaría `closed_at` con una fecha nueva y perdería la original.
 */
export function laAccionCambiaAlgo(
  estadoActual: "abierto" | "cerrado",
  accion: AccionPeriodo
): boolean {
  return accion === "cerrar" ? estadoActual === "abierto" : estadoActual === "cerrado";
}

export interface AnioDePeriodos {
  year: number;
  periodos: PeriodoRow[];
  abiertos: number;
  cerrados: number;
}

/**
 * Agrupa por año, del más reciente al más viejo, y dentro de cada año por mes
 * ascendente.
 *
 * El año descendente porque el contador trabaja sobre el ejercicio en curso y no
 * tiene por qué bajar hasta el final para encontrarlo. Los meses ascendentes
 * porque un ejercicio se lee de enero a diciembre.
 */
export function agruparPorAnio(periodos: readonly PeriodoRow[]): AnioDePeriodos[] {
  const porAnio = new Map<number, PeriodoRow[]>();
  for (const p of periodos) {
    const lista = porAnio.get(p.year) ?? [];
    lista.push(p);
    porAnio.set(p.year, lista);
  }
  return Array.from(porAnio.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, lista]) => {
      const ordenados = [...lista].sort((a, b) => a.month - b.month);
      return {
        year,
        periodos: ordenados,
        abiertos: ordenados.filter((p) => p.status === "abierto").length,
        cerrados: ordenados.filter((p) => p.status === "cerrado").length,
      };
    });
}
