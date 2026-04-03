/**
 * Shared date formatting utilities — DD/MM/YYYY format throughout the app.
 */

/** Format a date as DD/MM/YYYY */
export function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "—";
  const d = typeof dateStr === "string" ? new Date(dateStr + (dateStr.length === 10 ? "T00:00:00" : "")) : dateStr;
  if (isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/** Format a date+time as DD/MM/YYYY hh:mm a */
export function formatDateTime(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "—";
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  if (isNaN(d.getTime())) return "—";
  const date = formatDate(d);
  const time = d.toLocaleTimeString("es-PA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} ${time}`;
}

/** Calculate days between a date and today. Returns null if date is missing. */
export function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + (dateStr.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}
