/**
 * Shared case status styling — only two statuses: "En trámite" and "Cerrado"
 */
export function getStatusStyle(statusName: string): string {
  const name = statusName.toLowerCase();
  if (name.includes("cerrado") || name.includes("cerrada") || name.includes("archivado")) {
    return "border-transparent bg-gray-200 text-gray-600";
  }
  // Default: "En trámite" or any other status
  return "border-transparent bg-amber-100 text-amber-800";
}

export function formatCurrency(amount: number): string {
  return `B/. ${amount.toLocaleString("es-PA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
