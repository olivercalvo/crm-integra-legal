/**
 * EL FORMATO DE UN IMPORTE EN PANTALLA. Uno solo, para todo el sistema.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 * ═════════════════════════════════════════════════════════════════════════════
 * Hasta el 10/09/2026 convivían tres formas de escribir un monto:
 *
 *   · Los reportes: `toLocaleString("es-PA", { min/maxFractionDigits: 2 })`.
 *   · Gastos del Bufete: lo mismo, con `"en-US"`.
 *   · **Facturación y Cotizaciones: `.toFixed(2)` pelado**, que NO pone
 *     separador de miles.
 *
 * O sea que la misma factura se leía `1,605.00` en el Libro Mayor y `$1605.00`
 * en su propio detalle. Con cuatro o cinco dígitos hay que contarlos con el
 * dedo, y la demo la miran contadores.
 *
 * `es-PA` y `en-US` dan el mismo resultado para dinero panameño —coma para los
 * miles, punto para los decimales—; se usa `en-US` porque es el que ya tenían
 * Gastos del Bufete y el campo de carga (`monto-input.ts`), así que es el que
 * menos cosas mueve.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO LLEVA SÍMBOLO DE MONEDA
 * ─────────────────────────────────────────────────────────────────────────────
 * Devuelve `1,605.00`, no `B/. 1,605.00` ni `$1,605.00`. El símbolo lo pone
 * cada pantalla, que es la que sabe si va `$`, `B/.` o una columna con el
 * encabezado puesto. Meterlo acá obligaría a arrancárselo en la mitad de los
 * lugares.
 *
 * Módulo PURO: sin React, sin DOM.
 */

/**
 * Formatea un importe para mostrarlo: dos decimales y separador de miles.
 *
 * Acepta `string` porque muchos importes llegan de la base como texto (las
 * columnas `numeric` de Postgres viajan así por PostgREST).
 *
 * Un valor que no sea número devuelve `0.00` en vez de `NaN`: en una columna de
 * plata, un `NaN` en pantalla asusta más de lo que informa, y el dato roto se
 * ve igual porque el resto de la fila no cierra.
 */
export function fmtImporte(n: number | string | null | undefined): string {
  const v = typeof n === "number" ? n : Number(n ?? 0);
  const seguro = Number.isFinite(v) ? v : 0;
  return seguro.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
