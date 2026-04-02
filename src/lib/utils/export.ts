/**
 * Export utilities for CRM Integra Legal
 * Supports CSV and basic Excel (CSV-based .xlsx) downloads.
 * A full Excel library (e.g. exceljs) can replace exportToExcel later without
 * changing the call-sites — the ColumnConfig type and function signature stay the same.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColumnConfig<T = Record<string, unknown>> {
  /** Key of the data object to read */
  key: keyof T | string;
  /** Column header shown in the first row of the export */
  header: string;
  /** Optional value formatter. Receives the raw cell value and the full row. */
  formatter?: (value: unknown, row: T) => string;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Formats a Date | ISO string for use in exported files.
 * Output: "DD/MM/YYYY HH:MM" (Panama locale, 24 h)
 */
export function formatDateForExport(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return String(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Escapes a value for CSV:
 *  - Wraps in double-quotes if it contains a comma, newline or double-quote
 *  - Escapes any double-quotes inside by doubling them
 */
function escapeCsvValue(value: unknown): string {
  const str = value == null ? "" : String(value);
  // Always wrap in quotes to be safe (also handles numeric strings, dates, etc.)
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Resolves a (possibly nested) key path from a row object.
 * Supports dot-notation, e.g. "users.full_name"
 */
function resolveValue<T>(row: T, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[part];
  }, row);
}

/**
 * Converts a data array and column config into a CSV string (UTF-8 BOM included
 * so Excel opens it with the correct encoding on Windows).
 */
function buildCsvString<T>(data: T[], columns: ColumnConfig<T>[]): string {
  const BOM = "\uFEFF";

  const header = columns.map((c) => escapeCsvValue(c.header)).join(",");

  const rows = data.map((row) =>
    columns
      .map((col) => {
        const raw = resolveValue(row, col.key as string);
        const cell = col.formatter ? col.formatter(raw, row) : raw;
        return escapeCsvValue(cell);
      })
      .join(",")
  );

  return BOM + [header, ...rows].join("\r\n");
}

/**
 * Triggers a file download in the browser.
 */
function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Exports `data` as a UTF-8 CSV file and triggers a browser download.
 *
 * @param data     Array of row objects
 * @param columns  Column configuration (key, header, optional formatter)
 * @param filename Desired filename WITHOUT extension — `.csv` is appended
 *
 * @example
 * exportToCSV(auditRows, [
 *   { key: "created_at", header: "Fecha", formatter: (v) => formatDateForExport(v as string) },
 *   { key: "users.full_name", header: "Usuario" },
 * ], "auditoria-2026-04");
 */
export function exportToCSV<T>(
  data: T[],
  columns: ColumnConfig<T>[],
  filename: string
): void {
  const csv = buildCsvString(data, columns);
  triggerDownload(csv, `${filename}.csv`, "text/csv;charset=utf-8;");
}

/**
 * Exports `data` as a CSV-encoded file with an `.xlsx` extension.
 *
 * Excel opens CSV files with the .xlsx extension when no real OOXML structure
 * is present — it shows a compatibility prompt but loads the data correctly.
 * This is intentionally a placeholder: replace the body with an `exceljs`
 * (or similar) implementation when richer formatting is required, without
 * changing the call-sites.
 *
 * @param data     Array of row objects
 * @param columns  Column configuration
 * @param filename Desired filename WITHOUT extension — `.xlsx` is appended
 */
export function exportToExcel<T>(
  data: T[],
  columns: ColumnConfig<T>[],
  filename: string
): void {
  // TODO: Replace with exceljs or sheetjs for full OOXML when needed.
  const csv = buildCsvString(data, columns);
  triggerDownload(
    csv,
    `${filename}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}
