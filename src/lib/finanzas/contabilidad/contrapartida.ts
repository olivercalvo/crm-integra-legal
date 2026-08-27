/**
 * ═════════════════════════════════════════════════════════════════════════════
 * LA CONTRAPARTIDA — punto único de decisión
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Este archivo existe para tener UN solo lugar donde se decide qué va en la
 * columna "cuenta de contrapartida" del Libro Mayor. Está aislado a propósito:
 * la respuesta de Josuar sobre qué poner cuando un asiento tiene más de dos
 * líneas cae exactamente acá, y va a ser un cambio de una función, no una
 * cacería por medio repositorio.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ ES Y POR QUÉ NO ES OBVIO
 * ─────────────────────────────────────────────────────────────────────────────
 * En el mayor de una cuenta, cada renglón muestra "contra qué" se movió. Con dos
 * líneas es trivial: la contrapartida de A es B. Con tres o más no hay una
 * respuesta única, y ahí es donde los sistemas difieren.
 *
 * Del modelo que mandó Josuar (`Temas Contables/image001.png`) se sabe esto:
 *
 *   1010 Caja Menuda │ Pago de facturas de proveedores │ MICROSISTEMAS │ Proveedores │ -7,386.59
 *   1021 Banco Pich. │ Pago                            │ BBP BANK S.A. │ cobrar clientes │ 12,412.00
 *
 * Y de ahí salen dos observaciones que importan:
 *
 *   · Lo que escribe NO es un código de cuenta ni el nombre exacto de una
 *     cuenta: es una CATEGORÍA corta ("Proveedores", "cobrar clientes"). O sea
 *     que aunque resolvamos bien cuál es la cuenta contraria, todavía queda por
 *     definir con qué etiqueta se la nombra.
 *   · Todos los ejemplos visibles son asientos simples. No hay ninguno de tres
 *     líneas o más, así que el caso ambiguo no está resuelto por el modelo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ PENDIENTE — CONSULTA 3 DEL CORREO A JOSUAR
 * ─────────────────────────────────────────────────────────────────────────────
 * Las tres opciones razonables para un asiento de tres líneas o más:
 *
 *   a) "Varios" — lo más común en los sistemas contables. Honesto: avisa que hay
 *      más de una y obliga a abrir el asiento para ver el detalle.
 *   b) La cuenta del lado opuesto con MAYOR importe. Útil cuando hay una línea
 *      dominante y varias chicas, engañoso cuando están parejas.
 *   c) La lista completa, separada por comas. Precisa, pero rompe la grilla.
 *
 * Hoy se implementa (a), que es la que no miente. Cuando Josuar responda, se
 * cambia SOLO `contrapartidaDe()` y `ETIQUETA_VARIOS`.
 *
 * Módulo PURO: sin I/O, sin React.
 */

/** Lo mínimo que hace falta de una línea para decidir la contrapartida. */
export interface LineaParaContrapartida {
  /** Código de la cuenta (identidad contable, inmutable). */
  code: string;
  /** Nombre de la cuenta, que es lo que se muestra. */
  name: string;
  debit: number;
  credit: number;
}

/**
 * Etiqueta para cuando hay más de una contrapartida posible.
 *
 * Se saca a constante porque es lo primero que puede cambiar con la respuesta
 * de Josuar, y así no hay que buscar un string suelto adentro de una función.
 */
export const ETIQUETA_VARIOS = "Varios";

/** Cuando no hay ninguna línea del lado opuesto (asiento mal armado). */
export const ETIQUETA_SIN_CONTRAPARTIDA = "—";

/** true si la línea es un débito. Una línea siempre es débito O crédito. */
function esDebito(l: LineaParaContrapartida): boolean {
  return l.debit > 0;
}

/**
 * Las líneas del LADO OPUESTO a la dada.
 *
 * Es el corazón del asunto: la contrapartida de un débito son los créditos del
 * mismo asiento, y viceversa. Se excluye la propia línea comparando por
 * IDENTIDAD del objeto y no por código, porque un mismo asiento puede tocar la
 * misma cuenta dos veces y son renglones distintos del mayor.
 */
export function lineasOpuestas(
  linea: LineaParaContrapartida,
  todas: LineaParaContrapartida[]
): LineaParaContrapartida[] {
  const buscoDebitos = !esDebito(linea);
  return todas.filter((l) => l !== linea && esDebito(l) === buscoDebitos);
}

/**
 * Qué mostrar en la columna "cuenta de contrapartida" para una línea del mayor.
 *
 * @param linea  la línea que se está mostrando
 * @param todas  TODAS las líneas del asiento al que pertenece, la propia incluida
 */
export function contrapartidaDe(
  linea: LineaParaContrapartida,
  todas: LineaParaContrapartida[]
): string {
  const opuestas = lineasOpuestas(linea, todas);

  if (opuestas.length === 0) return ETIQUETA_SIN_CONTRAPARTIDA;

  // Caso simple y no ambiguo: una sola cuenta del otro lado.
  if (opuestas.length === 1) return opuestas[0].name;

  // Varias líneas del otro lado, pero TODAS de la misma cuenta: sigue sin haber
  // ambigüedad, aunque el asiento tenga más de dos renglones. Este caso pasa
  // seguido (por ejemplo, varias facturas contra la misma cuenta por pagar).
  const codigosUnicos = new Set(opuestas.map((l) => l.code));
  if (codigosUnicos.size === 1) return opuestas[0].name;

  // Acá SÍ es ambiguo. Ver el pendiente del encabezado.
  return ETIQUETA_VARIOS;
}

/**
 * true si la contrapartida de esa línea es ambigua (hay más de una cuenta del
 * lado opuesto).
 *
 * La expone aparte para que la UI del mayor pueda, por ejemplo, marcar esas
 * celdas como "clickeables para ver el detalle" sin tener que comparar el texto
 * devuelto contra `ETIQUETA_VARIOS` — comparar contra una etiqueta es
 * exactamente lo que se rompe cuando Josuar pida cambiarla.
 */
export function contrapartidaEsAmbigua(
  linea: LineaParaContrapartida,
  todas: LineaParaContrapartida[]
): boolean {
  const opuestas = lineasOpuestas(linea, todas);
  return new Set(opuestas.map((l) => l.code)).size > 1;
}
