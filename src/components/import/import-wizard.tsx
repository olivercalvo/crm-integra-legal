"use client";

import { useState, useRef, useCallback } from "react";
import {
  Upload,
  FileSpreadsheet,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Users,
  FolderOpen,
  Info,
} from "lucide-react";
import { generateTemplate } from "@/lib/utils/import-parser";
import type { ImportPreview } from "@/lib/utils/import-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImportResults {
  clientsCreated: number;
  clientsSkipped: number;
  casesCreated: number;
  casesSkipped: number;
  errors: string[];
}

type Step = "upload" | "preview" | "confirm" | "results";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [results, setResults] = useState<ImportResults | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Template download ----
  const handleDownloadTemplate = useCallback(() => {
    const buffer = generateTemplate();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla-importacion-crm.xlsx";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }, []);

  // ---- File selection ----
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setError(null);
  };

  // ---- Upload & preview ----
  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", "preview");

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al procesar el archivo");
        return;
      }

      setPreview(data.preview);
      setStep("preview");
    } catch {
      setError("Error de conexión al procesar el archivo");
    } finally {
      setLoading(false);
    }
  };

  // ---- Execute import ----
  const handleExecute = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", "execute");
      formData.append("skipDuplicates", String(skipDuplicates));

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al ejecutar la importación");
        return;
      }

      setResults(data.results);
      setStep("results");
    } catch {
      setError("Error de conexión al ejecutar la importación");
    } finally {
      setLoading(false);
    }
  };

  // ---- Reset ----
  const handleReset = () => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setResults(null);
    setError(null);
    setSkipDuplicates(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <StepBadge label="1. Subir" active={step === "upload"} done={["preview", "confirm", "results"].includes(step)} />
        <span className="text-gray-300">/</span>
        <StepBadge label="2. Revisar" active={step === "preview"} done={["confirm", "results"].includes(step)} />
        <span className="text-gray-300">/</span>
        <StepBadge label="3. Confirmar" active={step === "confirm"} done={step === "results"} />
        <span className="text-gray-300">/</span>
        <StepBadge label="4. Resultado" active={step === "results"} done={false} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <XCircle size={18} />
          {error}
        </div>
      )}

      {/* ---- STEP 1: Upload ---- */}
      {step === "upload" && (
        <div className="space-y-6">
          {/* Template download */}
          <div className="rounded-lg border border-integra-gold/30 bg-integra-gold/5 p-4">
            <div className="flex items-start gap-3">
              <Info size={20} className="mt-0.5 shrink-0 text-integra-gold" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-integra-navy">Plantilla de importación</p>
                <p className="text-sm text-gray-600">
                  Descargue la plantilla Excel con las columnas correctas. Puede importar clientes, casos o ambos.
                  Use la hoja &quot;Clientes&quot; para clientes y &quot;Casos&quot; para casos.
                </p>
                <button
                  onClick={handleDownloadTemplate}
                  className="inline-flex items-center gap-2 rounded-lg border border-integra-gold bg-white px-4 py-2 text-sm font-medium text-integra-navy hover:bg-integra-gold/10 min-h-[48px]"
                >
                  <Download size={16} />
                  Descargar plantilla
                </button>
              </div>
            </div>
          </div>

          {/* File upload */}
          <div
            className="flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center hover:border-integra-gold/50 cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="rounded-full bg-gray-100 p-4">
              <Upload size={32} className="text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                {file ? file.name : "Seleccione un archivo Excel o CSV"}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Formatos: .xlsx, .xls, .csv — Máximo 10 MB
              </p>
            </div>
            {file && (
              <div className="flex items-center gap-2 text-sm text-integra-navy">
                <FileSpreadsheet size={16} />
                {(file.size / 1024).toFixed(1)} KB
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Upload button */}
          <div className="flex justify-end">
            <button
              onClick={handleUpload}
              disabled={!file || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-integra-navy px-6 py-3 text-sm font-medium text-white hover:bg-integra-navy/90 disabled:opacity-50 min-h-[48px]"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              Analizar archivo
            </button>
          </div>
        </div>
      )}

      {/* ---- STEP 2: Preview ---- */}
      {step === "preview" && preview && (
        <div className="space-y-6">
          {/* Stats cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard icon={<Users size={20} />} label="Clientes" value={preview.stats.validClients} color="text-blue-600" />
            <StatCard icon={<FolderOpen size={20} />} label="Casos" value={preview.stats.validCases} color="text-green-600" />
            <StatCard icon={<AlertTriangle size={20} />} label="Duplicados" value={preview.stats.duplicateCount} color="text-amber-600" />
            <StatCard icon={<XCircle size={20} />} label="Errores" value={preview.stats.errorCount} color="text-red-600" />
          </div>

          {/* Clients preview */}
          {preview.clients.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-integra-navy flex items-center gap-2">
                <Users size={16} />
                Clientes a importar ({preview.clients.length})
              </h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Fila</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Nombre</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">RUC</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Tipo</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Teléfono</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Email</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.clients.slice(0, 20).map((c) => (
                      <tr key={c.rowNumber} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-400">{c.rowNumber}</td>
                        <td className="px-3 py-2 font-medium">{c.name}</td>
                        <td className="px-3 py-2">{c.ruc || "—"}</td>
                        <td className="px-3 py-2">{c.type || "—"}</td>
                        <td className="px-3 py-2">{c.phone || "—"}</td>
                        <td className="px-3 py-2">{c.email || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.clients.length > 20 && (
                  <p className="px-3 py-2 text-xs text-gray-500 bg-gray-50">
                    ...y {preview.clients.length - 20} más
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Cases preview */}
          {preview.cases.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-integra-navy flex items-center gap-2">
                <FolderOpen size={16} />
                Casos a importar ({preview.cases.length})
              </h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Fila</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Cliente</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Descripción</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Clasificación</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.cases.slice(0, 20).map((c) => (
                      <tr key={c.rowNumber} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-400">{c.rowNumber}</td>
                        <td className="px-3 py-2 font-medium">{c.clientName}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate">{c.description || "—"}</td>
                        <td className="px-3 py-2">{c.classification || "—"}</td>
                        <td className="px-3 py-2">{c.openedAt || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.cases.length > 20 && (
                  <p className="px-3 py-2 text-xs text-gray-500 bg-gray-50">
                    ...y {preview.cases.length - 20} más
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Duplicates */}
          {preview.duplicateClients.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-amber-600 flex items-center gap-2">
                <AlertTriangle size={16} />
                Clientes duplicados ({preview.duplicateClients.length})
              </h3>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <ul className="space-y-1 text-sm">
                  {preview.duplicateClients.map((d, i) => (
                    <li key={i} className="text-amber-800">
                      Fila {d.row}: <strong>{d.name}</strong> — coincide por {d.matchField}
                    </li>
                  ))}
                </ul>
                <label className="mt-3 flex items-center gap-2 text-sm text-amber-800">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="rounded"
                  />
                  Omitir clientes duplicados al importar
                </label>
              </div>
            </div>
          )}

          {/* Errors */}
          {preview.errors.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-red-600 flex items-center gap-2">
                <XCircle size={16} />
                Errores ({preview.errors.length})
              </h3>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <ul className="space-y-1 text-sm text-red-700">
                  {preview.errors.map((e, i) => (
                    <li key={i}>
                      Fila {e.row}, {e.field}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Warnings */}
          {preview.warnings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-amber-600 flex items-center gap-2">
                <AlertTriangle size={16} />
                Advertencias ({preview.warnings.length})
              </h3>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <ul className="space-y-1 text-sm text-amber-700">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>
                      Fila {w.row}, {w.field}: {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 min-h-[48px]"
            >
              <ArrowLeft size={16} />
              Volver
            </button>
            <button
              onClick={() => setStep("confirm")}
              disabled={preview.stats.validClients === 0 && preview.stats.validCases === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-integra-navy px-6 py-3 text-sm font-medium text-white hover:bg-integra-navy/90 disabled:opacity-50 min-h-[48px]"
            >
              Continuar
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ---- STEP 3: Confirm ---- */}
      {step === "confirm" && preview && (
        <div className="space-y-6">
          <div className="rounded-lg border border-integra-navy/20 bg-integra-navy/5 p-6">
            <h3 className="text-lg font-semibold text-integra-navy mb-4">Confirmar importación</h3>
            <div className="space-y-3 text-sm">
              <p className="flex items-center gap-2">
                <Users size={16} className="text-blue-600" />
                <strong>{preview.stats.validClients}</strong> clientes nuevos
                {preview.stats.duplicateCount > 0 && skipDuplicates && (
                  <span className="text-amber-600">({preview.stats.duplicateCount} duplicados se omitirán)</span>
                )}
              </p>
              <p className="flex items-center gap-2">
                <FolderOpen size={16} className="text-green-600" />
                <strong>{preview.stats.validCases}</strong> casos nuevos
              </p>
              {preview.stats.warningCount > 0 && (
                <p className="flex items-center gap-2 text-amber-600">
                  <AlertTriangle size={16} />
                  {preview.stats.warningCount} advertencias (se procesarán de todas formas)
                </p>
              )}
            </div>

            <div className="mt-6 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              <strong>Esta acción no se puede deshacer.</strong> Los registros creados deberán eliminarse manualmente si hay un error.
            </div>
          </div>

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={() => setStep("preview")}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 min-h-[48px]"
            >
              <ArrowLeft size={16} />
              Volver
            </button>
            <button
              onClick={handleExecute}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-integra-gold px-6 py-3 text-sm font-semibold text-integra-navy hover:bg-integra-gold/90 disabled:opacity-50 min-h-[48px]"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  Ejecutar importación
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ---- STEP 4: Results ---- */}
      {step === "results" && results && (
        <div className="space-y-6">
          <div className="rounded-lg border border-green-200 bg-green-50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle2 size={24} className="text-green-600" />
              <h3 className="text-lg font-semibold text-green-800">Importación completada</h3>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <ResultCard label="Clientes creados" value={results.clientsCreated} color="text-blue-600" />
              <ResultCard label="Clientes omitidos" value={results.clientsSkipped} color="text-gray-500" />
              <ResultCard label="Casos creados" value={results.casesCreated} color="text-green-600" />
              <ResultCard label="Casos omitidos" value={results.casesSkipped} color="text-gray-500" />
            </div>
          </div>

          {/* Errors during import */}
          {results.errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <h4 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-2">
                <XCircle size={16} />
                Errores durante importación ({results.errors.length})
              </h4>
              <ul className="space-y-1 text-sm text-red-600">
                {results.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 min-h-[48px]"
            >
              <Upload size={16} />
              Nueva importación
            </button>
            <a
              href="/abogada/clientes"
              className="inline-flex items-center gap-2 rounded-lg bg-integra-navy px-4 py-3 text-sm font-medium text-white hover:bg-integra-navy/90 min-h-[48px]"
            >
              <Users size={16} />
              Ver clientes
            </a>
            <a
              href="/abogada/expedientes"
              className="inline-flex items-center gap-2 rounded-lg bg-integra-navy px-4 py-3 text-sm font-medium text-white hover:bg-integra-navy/90 min-h-[48px]"
            >
              <FolderOpen size={16} />
              Ver casos
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepBadge({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active
          ? "bg-integra-navy text-white"
          : done
          ? "bg-green-100 text-green-700"
          : "bg-gray-100 text-gray-500"
      }`}
    >
      {label}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-4 text-center">
      <div className={`flex justify-center mb-1 ${color}`}>{icon}</div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function ResultCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
