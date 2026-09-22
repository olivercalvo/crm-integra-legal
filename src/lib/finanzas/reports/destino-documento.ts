/**
 * A QUÉ PANTALLA LLEVA CADA DOCUMENTO DEL LEDGER.
 *
 * Es la trazabilidad nivel 2 del Libro Mayor: el ícono de cada renglón abre el
 * documento que originó el movimiento. La guía de RM lo pide en su lista de
 * validación — "cada reporte permite llegar al documento origen".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES UN MÓDULO Y NO UN OBJETO SUELTO DENTRO DEL SOURCE
 * ─────────────────────────────────────────────────────────────────────────────
 * Vivía como una constante local en `libro-mayor-source.ts`, y por eso nadie
 * podía verificarlo: el 01/09/2026 se descubrió que el enlace de una factura
 * apuntaba a `/finanzas/facturas/{id}`, una ruta que el middleware le rebota al
 * contador. El ícono prometía abrir el documento y lo depositaba en otra
 * pantalla sin explicación — en SEIS de los diez asientos sembrados.
 *
 * La auditoría del menú contra el middleware ya existía y no lo agarró, porque
 * miraba el sidebar. Este era el mismo error una capa más adentro: en los
 * enlaces de CONTENIDO.
 *
 * Exportado, `nav-guard.test.ts` puede cruzar cada ruta contra `puedeAccederA()`
 * para cada rol que entra al reporte, y fallar si alguna no abre.
 *
 * Módulo PURO: sin I/O. Solo dice a dónde va cada tipo.
 */

/** `source_type` del asiento → ruta del documento que lo originó. */
export const RUTA_DEL_DOCUMENTO: Record<string, (id: string) => string> = {
  factura: (id) => `/finanzas/facturas/${id}`,
  // Desde el Bloque 5 (22/09/2026) la NC tiene pantalla propia y su asiento
  // lleva `source_id = la NC` (D5), no la factura: una factura puede tener
  // varias NC parciales y el drill-down tiene que caer en LA que originó el
  // movimiento. Antes apuntaba a `/finanzas/facturas/{id}` asumiendo que el
  // source_id era la factura — con la NC parcial habría sido un 404.
  nota_credito: (id) => `/finanzas/notas-credito/${id}`,
  gasto: (id) => `/finanzas/gastos-bufete/${id}`,
  // ───────────────────────────────────────────────────────────────────────────
  // `gasto_tramite` es un source_type APARTE de `gasto`, y no por prolijidad
  // ───────────────────────────────────────────────────────────────────────────
  // `gasto` ya está tomado por `business_expenses` (las compras del bufete) y es
  // el que apunta al renglón de arriba. Un gasto de trámite es otra tabla
  // (`expenses`, del módulo Legal) y otra pantalla: si compartieran source_type,
  // el ícono del mayor mandaría un gasto de trámite a `/finanzas/gastos-bufete`
  // con un id que ahí no existe. Sería el bug del 01/09 que originó este archivo,
  // reintroducido un módulo más adelante.
  //
  // Elegir un valor nuevo tiene además una ventaja de migración: cero backfill.
  // `gasto` sigue significando exactamente lo que significa hoy.
  gasto_tramite: (id) => `/finanzas/gastos-tramite/${id}`,
  // El pago de UNA factura vive en el detalle de esa factura: su destino se
  // resuelve mirando `payment_applications` y termina en la misma ruta que
  // `factura`. Ver `loadDestinosDeOrigen`.
  pago: (id) => `/finanzas/facturas/${id}`,
  // Un pago aplicado a VARIAS facturas (Parte B, 21/09/2026) no tiene una
  // factura única: va al listado de cobros filtrado por su número de recibo,
  // que existe desde el Bloque 2 y el contador ya puede abrir. Recibe el
  // NÚMERO (`REC-000012`), no el id. Antes de esto el cobro quedaba sin enlace.
  cobro_varias_facturas: (numero) => `/finanzas/cobros?q=${encodeURIComponent(numero)}`,
  // Un pago a PROVEEDOR es la otra punta y tiene su propio `source_type` desde
  // la migración `042`, exactamente por el motivo del bloque de arriba: con
  // `pago` habría mandado a `/finanzas/facturas/<id-de-una-compra>`. Desde la
  // 048 su `source_id` es el id del PAGO (`supplier_payments`), no el de la
  // compra: `loadDestinosDeOrigen` resuelve pago → compra y el destino sigue
  // siendo la compra, que es donde el pago se ve. Esta función recibe el id de
  // la COMPRA ya resuelto.
  pago_proveedor: (id) => `/finanzas/gastos-bufete/${id}`,
};

/**
 * Los `source_type` que NO tienen documento y por lo tanto no llevan a ninguna
 * pantalla. Un asiento de diario no tiene origen: su origen es él mismo.
 *
 * ⚠️ `reversion` es el caso a medias: el TIPO no tiene pantalla, pero cada
 * espejo lleva el `source_id` de lo que revierte y `loadDestinosDeOrigen` lo
 * resuelve por su tabla de origen: un cobro por `payment_reversals` (046), un
 * pago a proveedor por `supplier_payments` (048/049), la anulación de una
 * factura por `invoices` (052) y un gasto de trámite por `expenses` (050) —
 * los cuatro a la misma pantalla que el asiento original. Por eso no está en
 * `RUTA_DEL_DOCUMENTO`: no hay una ruta por tipo, hay una por tabla de origen.
 */
export const SOURCE_TYPES_SIN_DOCUMENTO = ["manual", "apertura", "reversion"] as const;

/**
 * Una ruta de ejemplo por tipo, con un id de muestra. La usa el test de
 * navegación: no puede inventar ids, y necesita una ruta concreta para
 * preguntarle al middleware si el rol la puede abrir.
 */
export function rutasDeEjemplo(): { sourceType: string; ruta: string }[] {
  const ID = "00000000-0000-0000-0000-000000000001";
  return Object.entries(RUTA_DEL_DOCUMENTO).map(([sourceType, f]) => ({
    sourceType,
    // Sin el query string: el middleware decide por `pathname`, y es contra
    // eso que `puedeAccederA` se cruza en nav-guard.test.ts.
    ruta: f(ID).split("?")[0],
  }));
}
