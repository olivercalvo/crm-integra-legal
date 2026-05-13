"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  initialContent: string;
  initialUpdatedAt: string | null;
}

const MIN_CHARS = 10;
const MAX_CHARS = 20_000;

/**
 * Editor de la plantilla T&C (D6, D9). PUT /api/finanzas/configuracion/
 * terms-template. El gate de admin lo hace el route handler — el server
 * component que renderiza esta pantalla también gate-ea ANTES (defensa en
 * profundidad), por lo que asumimos que el usuario ya es admin acá.
 */
export function TermsTemplateEditor({ initialContent, initialUpdatedAt }: Props) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(initialUpdatedAt);
  const [justSaved, setJustSaved] = useState(false);

  const trimmedLen = content.trim().length;
  const isValid = trimmedLen >= MIN_CHARS && content.length <= MAX_CHARS;
  const isDirty = content !== initialContent;

  function submit() {
    setSubmitError(null);
    setJustSaved(false);

    if (trimmedLen < MIN_CHARS) {
      setSubmitError(
        `La plantilla debe tener al menos ${MIN_CHARS} caracteres.`
      );
      return;
    }
    if (content.length > MAX_CHARS) {
      setSubmitError(
        `La plantilla no puede tener más de ${MAX_CHARS.toLocaleString("es-PA")} caracteres.`
      );
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/configuracion/terms-template", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSubmitError(data.error ?? "No se pudo guardar la plantilla.");
          return;
        }
        setSavedAt(new Date().toISOString());
        setJustSaved(true);
        // Refresh para que server component recargue updated_at.
        router.refresh();
        // Auto-clear el flag "justSaved" tras 4s.
        setTimeout(() => setJustSaved(false), 4000);
      } catch {
        setSubmitError("Error de red. Intenta de nuevo.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {justSaved && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700 animate-in fade-in slide-in-from-top-2">
          <CheckCircle size={18} className="text-green-600 shrink-0" />
          Plantilla actualizada
        </div>
      )}

      <div className="rounded-xl border bg-white p-5 shadow-sm space-y-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={isPending}
          rows={20}
          maxLength={MAX_CHARS}
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
          placeholder="Escribe los Términos y Condiciones del bufete…"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="text-gray-500">
            {savedAt ? (
              <>
                Última actualización:{" "}
                <span className="font-mono">
                  {new Date(savedAt).toLocaleString("es-PA")}
                </span>
              </>
            ) : (
              <span className="italic text-gray-400">Sin guardados previos.</span>
            )}
          </p>
          <p
            className={`font-mono ${
              trimmedLen < MIN_CHARS
                ? "text-amber-600"
                : "text-gray-500"
            }`}
          >
            {content.length.toLocaleString("es-PA")} / {MAX_CHARS.toLocaleString("es-PA")} caracteres
            {trimmedLen < MIN_CHARS && (
              <span className="ml-2 text-amber-700">
                (mínimo {MIN_CHARS})
              </span>
            )}
          </p>
        </div>
      </div>

      {submitError && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          type="button"
          onClick={submit}
          disabled={isPending || !isDirty || !isValid}
          className="bg-integra-navy hover:bg-integra-navy/90 text-white min-h-[48px]"
        >
          {isPending ? (
            <>
              <Loader2 size={16} className="mr-2 animate-spin" />
              Guardando…
            </>
          ) : (
            <>
              <Save size={16} className="mr-2" />
              Guardar
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
