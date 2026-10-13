/**
 * Shared case status styling — only two statuses: "En trámite" and "Cerrado"
 */
/**
 * ¿El estado del caso es de cierre? La MISMA regla que pinta el badge gris, así
 * que la pantalla no puede decir "cerrado" en un lado y no en el otro.
 */
export function esEstadoCerrado(statusName: string | null | undefined): boolean {
  const name = (statusName ?? "").toLowerCase();
  return name.includes("cerrado") || name.includes("cerrada") || name.includes("archivado");
}

export function getStatusStyle(statusName: string): string {
  if (esEstadoCerrado(statusName)) {
    return "border-transparent bg-gray-200 text-gray-600";
  }
  // Default: "En trámite" or any other status
  return "border-transparent bg-amber-100 text-amber-800";
}

export function formatCurrency(amount: number): string {
  return `B/. ${amount.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
