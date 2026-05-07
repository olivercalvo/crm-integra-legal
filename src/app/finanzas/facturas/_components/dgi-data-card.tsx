"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  FileBadge,
  Pencil,
  Hash,
  Fingerprint,
  CalendarCheck,
  Link as LinkIcon,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/utils/format-date";

interface Props {
  invoiceId: string;
  initial: {
    dgi_numero_documento: string | null;
    dgi_cufe: string | null;
    dgi_fecha_autorizacion: string | null;
    dgi_cafe_url: string | null;
  };
}

/**
 * Card de "Datos de Factura Electrónica DGI" en el detalle de factura emitida.
 *
 * Solo se renderiza cuando status='emitida' (el caller decide). Tiene dos
 * estados:
 *
 *   - Vacío (los 4 valores null): muestra prompt + botón "Registrar datos DGI"
 *   - Lleno: muestra los 4 datos + botón "Editar"
 *
 * En ambos casos abre el mismo modal con el form. El form es manual
 * (useState + setError(string|null)) consistente con /legal y el resto del
 * módulo Finanzas — sin Zod, sin react-hook-form.
 *
 * Validaciones cliente-side reflejan exactamente las del backend
 * (validateDgiInput en api/invoices.ts):
 *   - número: 10 dígitos numéricos exactos
 *   - URL: parseable por new URL()
 *   - fecha: parseable por Date.parse()
 *
 * Si el backend devuelve fieldErrors, los pintamos en el form (defensa
 * server-first).
 */
export function DgiDataCard({ invoiceId, initial }: Props) {
  const isEmpty =
    !initial.dgi_numero_documento &&
    !initial.dgi_cufe &&
    !initial.dgi_fecha_autorizacion &&
    !initial.dgi_cafe_url;

  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h2 className="text-base font-semibold text-integra-navy flex items-center gap-2">
          <FileBadge size={18} className="text-integra-gold" />
          Datos de Factura Electrónica DGI
        </h2>
        {!isEmpty && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            className="min-h-[36px]"
          >
            <Pencil size={14} className="mr-1.5" />
            Editar
          </Button>
        )}
      </div>

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-integra-gold/40 bg-integra-navy/[0.02] p-5 text-center">
          <p className="text-sm text-gray-700 mb-4">
            Esta factura aún no fue replicada en eFactura. Registra el número
            oficial cuando termines de emitirla allá.
          </p>
          <Button
            onClick={() => setOpen(true)}
            className="bg-integra-navy text-white hover:bg-integra-navy/90 min-h-[44px]"
          >
            <FileBadge size={16} className="mr-2" />
            Registrar datos DGI
          </Button>
        </div>
      ) : (
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DgiField
            icon={<Hash size={14} />}
            label="Número documento DGI"
            value={initial.dgi_numero_documento}
            mono
          />
          <DgiField
            icon={<CalendarCheck size={14} />}
            label="Fecha de autorización"
            value={
              initial.dgi_fecha_autorizacion
                ? formatDateTime(initial.dgi_fecha_autorizacion)
                : null
            }
          />
          <DgiField
            icon={<Fingerprint size={14} />}
            label="CUFE"
            value={initial.dgi_cufe}
            mono
            wrap
          />
          <DgiField
            icon={<LinkIcon size={14} />}
            label="URL del CAFE"
            value={initial.dgi_cafe_url}
            href={initial.dgi_cafe_url}
          />
        </dl>
      )}

      {open && (
        <DgiFormModal
          invoiceId={invoiceId}
          initial={initial}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Subcomponente: campo individual en estado "lleno"
// ---------------------------------------------------------------------------

function DgiField({
  icon,
  label,
  value,
  mono,
  wrap,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  mono?: boolean;
  wrap?: boolean;
  href?: string | null;
}) {
  return (
    <div className="rounded-lg border bg-gray-50/50 p-3">
      <dt className="text-xs uppercase tracking-wider text-gray-500 flex items-center gap-1">
        {icon} {label}
      </dt>
      <dd
        className={[
          "mt-1 text-gray-900",
          mono ? "font-mono text-sm" : "text-sm font-medium",
          wrap ? "break-all" : "truncate",
        ].join(" ")}
      >
        {value ? (
          href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-integra-navy hover:underline"
            >
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponente: modal con form de edición/registro
// ---------------------------------------------------------------------------

interface ModalProps {
  invoiceId: string;
  initial: Props["initial"];
  onClose: () => void;
}

function DgiFormModal({ invoiceId, initial, onClose }: ModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Estado del form. Para datetime-local necesitamos el formato
  // 'YYYY-MM-DDTHH:mm'. Si initial.dgi_fecha_autorizacion viene como ISO con
  // segundos/zona, lo recortamos.
  const [numero, setNumero] = useState(initial.dgi_numero_documento ?? "");
  const [cufe, setCufe] = useState(initial.dgi_cufe ?? "");
  const [fecha, setFecha] = useState(toLocalInput(initial.dgi_fecha_autorizacion));
  const [url, setUrl] = useState(initial.dgi_cafe_url ?? "");

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});

  // ESC cierra (consistente con ConfirmationModal).
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onClose();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [isPending, onClose]);

  function validateClient(): Record<string, string> | null {
    const errs: Record<string, string> = {};

    const nTrim = numero.trim();
    if (nTrim && !/^\d{10}$/.test(nTrim)) {
      errs.dgi_numero_documento =
        "Debe ser exactamente 10 dígitos numéricos (ej. 0000001234).";
    }

    const fTrim = fecha.trim();
    if (fTrim) {
      if (isNaN(Date.parse(fTrim))) {
        errs.dgi_fecha_autorizacion = "Fecha inválida.";
      }
    }

    const uTrim = url.trim();
    if (uTrim) {
      try {
        new URL(uTrim);
      } catch {
        errs.dgi_cafe_url = "URL inválida (debe incluir http:// o https://).";
      }
    }

    return Object.keys(errs).length > 0 ? errs : null;
  }

  function submit() {
    setError(null);
    setFieldErrors({});

    const clientErrs = validateClient();
    if (clientErrs) {
      setFieldErrors(clientErrs);
      return;
    }

    // Empty string → null para mandar limpieza explícita al backend.
    const payload = {
      dgi_numero_documento: numero.trim() || null,
      dgi_cufe: cufe.trim() || null,
      dgi_fecha_autorizacion: fecha.trim()
        ? new Date(fecha).toISOString()
        : null,
      dgi_cafe_url: url.trim() || null,
    };

    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/invoices/${invoiceId}/dgi`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.fieldErrors) {
            setFieldErrors(data.fieldErrors);
          }
          setError(data.error ?? "No se pudieron guardar los datos DGI.");
          return;
        }
        onClose();
        // Disparamos el toast vía URL param (patrón consistente con
        // InvoiceSuccessToast). router.refresh recarga la data del server
        // component padre para reflejar los nuevos valores en la card.
        const url = new URL(window.location.href);
        url.searchParams.set("dgi", "saved");
        router.replace(url.pathname + url.search, { scroll: false });
        router.refresh();
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={isPending ? undefined : onClose}
      />
      <div className="relative w-full max-w-lg rounded-lg bg-white shadow-xl">
        <button
          onClick={onClose}
          disabled={isPending}
          className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
          aria-label="Cerrar"
        >
          <X size={20} />
        </button>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-integra-gold/20">
              <FileBadge size={20} className="text-integra-navy" />
            </div>
            <h3 className="text-lg font-bold text-integra-navy">
              Datos de Factura Electrónica DGI
            </h3>
          </div>

          <p className="text-xs text-gray-500">
            Registra los datos oficiales que devolvió eFactura tras emitir la
            factura electrónica allá.
          </p>

          <div className="space-y-3">
            {/* Número de documento */}
            <div>
              <Label htmlFor="dgi_numero" className="text-sm">
                Número documento DGI
              </Label>
              <Input
                id="dgi_numero"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="0000001234"
                inputMode="numeric"
                maxLength={10}
                disabled={isPending}
                className="font-mono"
              />
              <p
                className={`mt-1 text-xs ${
                  fieldErrors.dgi_numero_documento
                    ? "text-red-600"
                    : "text-gray-500"
                }`}
              >
                {fieldErrors.dgi_numero_documento ??
                  "Exactamente 10 dígitos numéricos."}
              </p>
            </div>

            {/* CUFE */}
            <div>
              <Label htmlFor="dgi_cufe" className="text-sm">
                CUFE <span className="text-gray-400 font-normal">(opcional)</span>
              </Label>
              <Input
                id="dgi_cufe"
                value={cufe}
                onChange={(e) => setCufe(e.target.value)}
                placeholder="Código Único de Factura Electrónica"
                disabled={isPending}
                className="font-mono text-xs"
              />
              {fieldErrors.dgi_cufe && (
                <p className="mt-1 text-xs text-red-600">
                  {fieldErrors.dgi_cufe}
                </p>
              )}
            </div>

            {/* Fecha autorización */}
            <div>
              <Label htmlFor="dgi_fecha" className="text-sm">
                Fecha de autorización DGI
              </Label>
              <Input
                id="dgi_fecha"
                type="datetime-local"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={isPending}
              />
              {fieldErrors.dgi_fecha_autorizacion && (
                <p className="mt-1 text-xs text-red-600">
                  {fieldErrors.dgi_fecha_autorizacion}
                </p>
              )}
            </div>

            {/* URL del CAFE */}
            <div>
              <Label htmlFor="dgi_url" className="text-sm">
                URL del CAFE <span className="text-gray-400 font-normal">(opcional)</span>
              </Label>
              <Input
                id="dgi_url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://dgi.mef.gob.pa/..."
                disabled={isPending}
              />
              {fieldErrors.dgi_cafe_url && (
                <p className="mt-1 text-xs text-red-600">
                  {fieldErrors.dgi_cafe_url}
                </p>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isPending}
              className="min-h-[48px] flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={submit}
              disabled={isPending}
              className="min-h-[48px] flex-1 bg-integra-navy text-white hover:bg-integra-navy/90"
            >
              {isPending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Guardando…
                </span>
              ) : (
                "Guardar datos DGI"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Convierte un timestamp ISO (ej. '2026-05-07T14:30:00.000Z' o
 * '2026-05-07T14:30:00+00:00') al formato que espera <input type="datetime-local">
 * ('YYYY-MM-DDTHH:mm'). Devuelve string vacío si la entrada es null o inválida.
 *
 * Tomamos la fecha como local: si DGI devuelve UTC, lo mostramos en la zona del
 * navegador. Acceptable para MVP — Panamá es UTC-5 sin DST.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
