/**
 * Metadatos compartidos del encabezado de los reportes contables.
 */

/**
 * Nombre de la firma en el encabezado. Sale de la razón social del emisor de
 * facturación electrónica (que es el nombre legal registrado en la DGI) para no
 * inventar una segunda fuente de verdad. Si la env var no está configurada,
 * cae al nombre comercial.
 *
 * Se lee directo de `process.env` en vez de usar `loadEmisorConfig()` a
 * propósito: ese helper LANZA si falta cualquier variable del emisor, y un
 * reporte contable no tiene por qué caerse porque la configuración de eFactura
 * esté incompleta.
 */
export const REPORT_FIRM_NAME =
  process.env.EFACTURA_EMISOR_RAZON_SOCIAL?.trim() || "Integra Legal";

/**
 * Fecha/hora de generación en formato panameño. NO es la fecha de corte del
 * reporte: los saldos son de apertura y la fecha de corte la tiene que confirmar
 * el contador (ver roadmap-contable.md §5.2).
 */
export function formatGeneratedAt(now: Date = new Date()): string {
  return now.toLocaleString("es-PA", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
