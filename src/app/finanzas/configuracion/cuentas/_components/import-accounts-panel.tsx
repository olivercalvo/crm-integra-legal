"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Upload,
  Check,
  X,
  Loader2,
  AlertTriangle,
  FileSpreadsheet,
} from "lucide-react";
import { generateChartAccountsTemplate } from "@/lib/finanzas/import/chart-of-accounts-workbook";
import {
  ACCOUNT_TYPE_LABEL_ES,
  subcategoriaLabel,
  type AccountType,
  type Subcategoria,
} from "@/lib/finanzas/types/chart-of-account";

const BULK_URL = "/api/finanzas/configuracion/chart-of-accounts/bulk";

/** Fila clasificada tal como la devuelve el endpoint en modo preview. */
interface PreviewRow {
  rowNumber: number;
  code: string;
  name: string;
  account_type: AccountType | null;
  subcategoria: Subcategoria | null;
  saldo_inicial: number;
  errors: string[];
  action: "create" | "update" | "error";
  isSystem?: boolean;
}

interface PreviewPayload {
  skippedRows: number;
  hasSubcategoriaColumn: boolean;
  hasSaldoColumn: boolean;
  counts: { create: number; update: number; error: number };
  rows: PreviewRow[];
}

interface CommitSummary {
  created: number;
  updated: number;
  failed: number;
  skippedRows: number;
}

interface CommitOutcome {
  rowNumber: number;
  code: string;
  action: "created" | "updated" | "error";
  message?: string;
}

interface Props {
  /** Se llama al terminar una carga que escribió algo, para refrescar el listado. */
  onImported: () => void;
  onClose: () => void;
}

function formatSaldo(n: number): string {
  return n.toLocaleString("es-PA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ImportAccountsPanel({ onImported, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [outcomes, setOutcomes] = useState<CommitOutcome[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const buffer = generateChartAccountsTemplate();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    // Anchor programático, NO window.open: con noopener el popup se bloquea o
    // redirige la pestaña actual (bug ya visto en la descarga del PDF de
    // cotizaciones, sprint 2E.3).
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla-plan-de-cuentas.xlsx";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  async function post(mode: "preview" | "commit", theFile: File) {
    const body = new FormData();
    body.append("file", theFile);
    body.append("mode", mode);
    const res = await fetch(BULK_URL, { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Error al procesar el archivo");
    return json;
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setPreview(null);
    setSummary(null);
    setOutcomes([]);
    setError(null);
    if (!selected) return;

    setLoading(true);
    try {
      const json = await post("preview", selected);
      setPreview(json.preview as PreviewPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al leer el archivo");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const json = await post("commit", file);
      setSummary(json.summary as CommitSummary);
      setOutcomes((json.outcomes ?? []) as CommitOutcome[]);
      setPreview(null);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al confirmar la carga");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setSummary(null);
    setOutcomes([]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const writableCount = preview ? preview.counts.create + preview.counts.update : 0;

  return (
    <div className="space-y-4 rounded-lg border border-integra-navy/25 bg-integra-navy/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-integra-navy">
            <FileSpreadsheet size={16} />
            Importar cuentas desde Excel
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Si un código ya existe, la fila actualiza esa cuenta. No se genera ningún asiento
            contable.
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={onClose}
          disabled={loading}
          className="h-8 min-h-0 px-2 text-gray-500"
          title="Cerrar"
        >
          <X size={16} />
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Paso 1 — plantilla + archivo */}
      {!summary && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={downloadTemplate}
            disabled={loading}
            className="min-h-[44px]"
          >
            <Download size={16} className="mr-1.5" />
            Descargar plantilla de ejemplo
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileSelect}
            disabled={loading}
            className="hidden"
            id="chart-accounts-file"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="min-h-[44px] bg-integra-navy text-white hover:bg-integra-navy/90"
          >
            {loading && !preview ? (
              <Loader2 size={16} className="mr-1.5 animate-spin" />
            ) : (
              <Upload size={16} className="mr-1.5" />
            )}
            {file ? "Elegir otro archivo" : "Subir .xlsx o .csv"}
          </Button>

          {file && <span className="text-xs text-gray-600">{file.name}</span>}
        </div>
      )}

      {/* Paso 2 — preview */}
      {preview && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
              {preview.counts.create} a crear
            </Badge>
            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
              {preview.counts.update} a actualizar
            </Badge>
            {preview.counts.error > 0 && (
              <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                {preview.counts.error} con error
              </Badge>
            )}
            {preview.skippedRows > 0 && (
              <span className="text-gray-500">
                {preview.skippedRows} fila(s) ignorada(s) (títulos, totales o sin código)
              </span>
            )}
          </div>

          {!preview.hasSaldoColumn && (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              El archivo no trae columna de saldo inicial: todas las cuentas se cargarán en 0.00.
            </p>
          )}

          <div className="max-h-96 overflow-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 font-semibold">Fila</th>
                  <th className="px-3 py-2 font-semibold">Acción</th>
                  <th className="px-3 py-2 font-semibold">Código</th>
                  <th className="px-3 py-2 font-semibold">Nombre</th>
                  <th className="px-3 py-2 font-semibold">Tipo</th>
                  <th className="px-3 py-2 font-semibold">Subcategoría</th>
                  <th className="px-3 py-2 text-right font-semibold">Saldo inicial</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {preview.rows.map((r) => (
                  <tr
                    key={`${r.rowNumber}-${r.code}`}
                    className={r.action === "error" ? "bg-red-50/60" : ""}
                  >
                    <td className="px-3 py-2 text-xs text-gray-400">{r.rowNumber}</td>
                    <td className="px-3 py-2">
                      {r.action === "create" && (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                          Crear
                        </Badge>
                      )}
                      {r.action === "update" && (
                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                          Actualizar
                        </Badge>
                      )}
                      {r.action === "error" && (
                        <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Error</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{r.code}</td>
                    <td className="px-3 py-2">
                      {r.name || <span className="text-gray-400">—</span>}
                      {r.isSystem && (
                        <span className="ml-1.5 text-xs text-gray-500">(del sistema)</span>
                      )}
                      {r.action === "error" && (
                        <p className="mt-0.5 text-xs text-red-600">{r.errors.join(" · ")}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {r.account_type ? ACCOUNT_TYPE_LABEL_ES[r.account_type] : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {subcategoriaLabel(r.subcategoria)}
                    </td>
                    <td
                      className={
                        "px-3 py-2 text-right font-mono text-xs tabular-nums " +
                        (r.saldo_inicial < 0 ? "text-red-600" : "text-gray-700")
                      }
                    >
                      {formatSaldo(r.saldo_inicial)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleConfirm}
              disabled={loading || writableCount === 0}
              className="min-h-[44px] bg-integra-gold text-integra-navy hover:bg-integra-gold/90"
            >
              {loading ? (
                <Loader2 size={16} className="mr-1.5 animate-spin" />
              ) : (
                <Check size={16} className="mr-1.5" />
              )}
              Confirmar carga de {writableCount} cuenta(s)
            </Button>
            <Button variant="outline" onClick={reset} disabled={loading} className="min-h-[44px]">
              <X size={16} className="mr-1.5" />
              Descartar
            </Button>
          </div>
          {writableCount === 0 && (
            <p className="text-xs text-red-600">
              Ninguna fila se puede importar. Corregí el archivo y volvé a subirlo.
            </p>
          )}
        </div>
      )}

      {/* Paso 3 — resumen */}
      {summary && (
        <div className="space-y-3">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-semibold">Carga completada</p>
            <p className="mt-1">
              {summary.created} creada(s) · {summary.updated} actualizada(s) ·{" "}
              {summary.failed} con error
              {summary.skippedRows > 0 && ` · ${summary.skippedRows} fila(s) ignorada(s)`}
            </p>
          </div>

          {summary.failed > 0 && (
            <div className="rounded-lg border bg-white">
              <p className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Filas con error
              </p>
              <ul className="divide-y">
                {outcomes
                  .filter((o) => o.action === "error")
                  .map((o) => (
                    <li key={`${o.rowNumber}-${o.code}`} className="px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-gray-500">
                        Fila {o.rowNumber} · {o.code}
                      </span>
                      <p className="text-xs text-red-600">{o.message}</p>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={reset} className="min-h-[44px]">
              <Upload size={16} className="mr-1.5" />
              Cargar otro archivo
            </Button>
            <Button
              onClick={onClose}
              className="min-h-[44px] bg-integra-navy text-white hover:bg-integra-navy/90"
            >
              <Check size={16} className="mr-1.5" />
              Listo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
