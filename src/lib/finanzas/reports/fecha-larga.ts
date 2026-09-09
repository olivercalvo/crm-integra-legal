/**
 * Formato largo de una fecha ISO para los encabezados de los estados
 * («30 de junio de 2026»).
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ ESTE ARCHIVO EXISTE, Y POR QUÉ NO PUEDE VOLVER A `_components/`
 * ═════════════════════════════════════════════════════════════════════════════
 * Vivía dentro de `reportes/_components/periodo-filtros.tsx`, que empieza con
 * `"use client"`. Los tres estados financieros son Server Components y la
 * importaban de ahí.
 *
 * Un Server Component que importa de un módulo `"use client"` NO recibe la
 * función: recibe una **referencia de cliente** —el objeto que React usa para
 * hidratar el componente en el navegador—. Llamarla revienta con:
 *
 *     TypeError: (0 , …periodo_filtros__WEBPACK_IMPORTED_MODULE__.fechaLarga)
 *                is not a function
 *
 * Y como sólo se invoca cuando hay filtro de período, las tres pantallas
 * andaban perfecto sin filtrar y devolvían 500 al aplicar un corte de fechas.
 * En producción eso se ve como «Application error: a server-side exception has
 * occurred», sin ninguna pista de qué lo causó. Lo encontró RM en la reunión
 * del 09/09/2026, en vivo.
 *
 * ⚠️ La frontera no avisa: TypeScript compila, el build pasa y la pantalla sin
 * filtro funciona. Por eso el arreglo no es «tener cuidado», es que la función
 * viva en un módulo SIN `"use client"`, que los dos lados pueden importar.
 *
 * 🔒 Hay un test que lo verifica: `src/lib/finanzas/reports/__tests__/
 * frontera-cliente-servidor.test.ts` falla si un módulo `"use client"` exporta
 * algo que no es un componente y un módulo de servidor lo importa.
 *
 * Módulo PURO: sin React, sin I/O, sin Supabase.
 */

/**
 * `"2026-06-30"` → `"30 de junio de 2026"`.
 *
 * En UTC a propósito: `YYYY-MM-DD` no tiene hora, y dejarlo a la zona local
 * corre el día uno para atrás al oeste de Greenwich — que es donde está Panamá.
 */
export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("es-PA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
