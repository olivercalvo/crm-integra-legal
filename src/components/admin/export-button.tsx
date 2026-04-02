"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportToCSV, exportToExcel, type ColumnConfig } from "@/lib/utils/export";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportFormat = "csv" | "excel";

interface ExportButtonProps<T> {
  /** Array of rows to export */
  data: T[];
  /** Column definitions (key, header, optional formatter) */
  columns: ColumnConfig<T>[];
  /** Base filename without extension */
  filename: string;
  /** Which formats to show. Defaults to both ["csv", "excel"] */
  formats?: ExportFormat[];
  /** Optional label override. Defaults to "Exportar" */
  label?: string;
  /** Disabled when no data or parent says so */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExportButton<T>({
  data,
  columns,
  filename,
  formats = ["csv", "excel"],
  label = "Exportar",
  disabled = false,
}: ExportButtonProps<T>) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    if (exporting || data.length === 0) return;
    setExporting(true);
    try {
      if (format === "csv") {
        exportToCSV(data, columns, filename);
      } else {
        exportToExcel(data, columns, filename);
      }
    } finally {
      // Give the browser a tick to trigger the download before re-enabling
      setTimeout(() => setExporting(false), 300);
    }
  };

  const isDisabled = disabled || data.length === 0 || exporting;

  // If only one format is requested, render a plain button (no dropdown)
  if (formats.length === 1) {
    const fmt = formats[0];
    const Icon = fmt === "csv" ? FileText : FileSpreadsheet;
    const ext = fmt === "csv" ? "CSV" : "Excel";
    return (
      <Button
        variant="outline"
        className="min-h-[48px] gap-2 border-integra-navy/30 text-integra-navy hover:bg-integra-navy/5"
        disabled={isDisabled}
        onClick={() => handleExport(fmt)}
      >
        <Icon size={16} />
        {label} {ext}
      </Button>
    );
  }

  // Multiple formats → dropdown
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="min-h-[48px] gap-2 border-integra-navy/30 text-integra-navy hover:bg-integra-navy/5"
          disabled={isDisabled}
        >
          <Download size={16} />
          {exporting ? "Exportando…" : label}
          <ChevronDown size={14} className="ml-1 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {formats.includes("csv") && (
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onClick={() => handleExport("csv")}
          >
            <FileText size={15} className="text-green-600" />
            Exportar CSV
          </DropdownMenuItem>
        )}
        {formats.includes("excel") && (
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            onClick={() => handleExport("excel")}
          >
            <FileSpreadsheet size={15} className="text-emerald-700" />
            Exportar Excel
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
