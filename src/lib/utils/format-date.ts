/**
 * Shared date formatting utilities — DD/MM/YYYY format throughout the app.
 * All date-only strings (YYYY-MM-DD) are parsed by splitting, NOT by new Date(),
 * to avoid UTC timezone shift that causes dates to show one day behind.
 */

/** Parse a date-only string (YYYY-MM-DD) without timezone conversion */
function parseDateOnly(dateStr: string): { year: number; month: number; day: number } | null {
  // Match YYYY-MM-DD
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return { year: parseInt(match[1]), month: parseInt(match[2]), day: parseInt(match[3]) };
  }
  // Match DD/MM/YYYY
  const match2 = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match2) {
    return { year: parseInt(match2[3]), month: parseInt(match2[2]), day: parseInt(match2[1]) };
  }
  return null;
}

/** Format a date as DD/MM/YYYY — timezone-safe for date-only values */
export function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "—";

  if (typeof dateStr === "string") {
    // For date-only strings, parse directly to avoid timezone issues
    const parts = parseDateOnly(dateStr.trim());
    if (parts) {
      return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}`;
    }
    // For datetime strings, still use Date object but force local interpretation
    const d = new Date(dateStr + (dateStr.length === 10 ? "T12:00:00" : ""));
    if (isNaN(d.getTime())) return "—";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  // Date object
  const day = String(dateStr.getDate()).padStart(2, "0");
  const month = String(dateStr.getMonth() + 1).padStart(2, "0");
  const year = dateStr.getFullYear();
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

/** Calculate days between a date-only string and today. Returns null if missing.
 *  Negative = future, positive = past. */
export function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const parts = parseDateOnly(dateStr.trim());
  if (parts) {
    const target = new Date(parts.year, parts.month - 1, parts.day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.floor((today.getTime() - target.getTime()) / 86_400_000);
  }
  const d = new Date(dateStr + (dateStr.length === 10 ? "T12:00:00" : ""));
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}
