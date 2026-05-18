"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ThumbsDown,
  AlertCircle,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  ACCEPTANCE_FULL_NAME_MAX,
  ACCEPTANCE_FULL_NAME_MIN,
  ACCEPTANCE_ID_DOCUMENT_MAX,
  ACCEPTANCE_POSITION_MAX,
  ACCEPTANCE_POSITION_MIN,
  REJECTION_REASON_MAX,
  REJECTION_REASON_MIN,
  buildConsentText,
} from "@/lib/finanzas/types/quote-acceptance";

interface Props {
  token: string;
  quote_number: string;
  client_name: string;
}

type Mode = null | "accept" | "reject";
type SuccessState = null | { kind: "accepted"; quote_number: string } | { kind: "rejected"; quote_number: string };

const PALETTE = {
  navy: "#1B2A4A",
  gold: "#C5A55A",
  red: "#B91C1C",
  green: "#15803D",
};

export function PortalActions({ token, quote_number, client_name }: Props) {
  const [mode, setMode] = useState<Mode>(null);
  const [success, setSuccess] = useState<SuccessState>(null);

  if (success?.kind === "accepted") {
    return <SuccessBanner kind="accepted" quote_number={success.quote_number} />;
  }
  if (success?.kind === "rejected") {
    return <SuccessBanner kind="rejected" quote_number={success.quote_number} />;
  }

  return (
    <>
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setMode("accept")}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-integra-gold px-5 py-4 min-h-[56px] text-sm font-bold text-integra-navy hover:bg-integra-gold/90 transition shadow-sm"
        >
          <CheckCircle2 size={18} />
          Aceptar cotización
        </button>
        <button
          type="button"
          onClick={() => setMode("reject")}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-5 py-4 min-h-[56px] text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
        >
          <ThumbsDown size={16} />
          Rechazar
        </button>
      </div>

      {mode === "accept" && (
        <AcceptModal
          token={token}
          quote_number={quote_number}
          client_name={client_name}
          onClose={() => setMode(null)}
          onSuccess={() => setSuccess({ kind: "accepted", quote_number })}
        />
      )}
      {mode === "reject" && (
        <RejectModal
          token={token}
          quote_number={quote_number}
          onClose={() => setMode(null)}
          onSuccess={() => setSuccess({ kind: "rejected", quote_number })}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Success banner
// ---------------------------------------------------------------------------

function SuccessBanner({
  kind,
  quote_number,
}: {
  kind: "accepted" | "rejected";
  quote_number: string;
}) {
  if (kind === "accepted") {
    return (
      <div className="mt-8 rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <CheckCircle2
          size={40}
          className="mx-auto mb-3"
          style={{ color: PALETTE.green }}
        />
        <h3 className="text-lg font-bold" style={{ color: PALETTE.navy }}>
          ¡Aceptación registrada!
        </h3>
        <p className="mt-2 text-sm text-gray-700 leading-relaxed">
          Registramos tu aceptación de la cotización{" "}
          <span className="font-mono font-semibold">{quote_number}</span>.
          Te enviamos por correo el PDF firmado con la evidencia electrónica.
          Nuestro equipo te contactará a la brevedad.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
      <ThumbsDown size={36} className="mx-auto mb-3 text-gray-500" />
      <h3 className="text-lg font-bold" style={{ color: PALETTE.navy }}>
        Rechazo registrado
      </h3>
      <p className="mt-2 text-sm text-gray-700 leading-relaxed">
        Registramos tu decisión sobre la cotización{" "}
        <span className="font-mono font-semibold">{quote_number}</span>.
        Te enviamos un correo de confirmación. Si tu situación cambia, puedes
        contactarnos en cualquier momento.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accept modal
// ---------------------------------------------------------------------------

function AcceptModal({
  token,
  quote_number,
  client_name,
  onClose,
  onSuccess,
}: {
  token: string;
  quote_number: string;
  client_name: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fullName, setFullName] = useState("");
  const [position, setPosition] = useState("");
  const [idDocument, setIdDocument] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTimeout(() => firstInput.current?.focus(), 50);
  }, []);

  // Vista previa del consent que el cliente está a punto de firmar.
  const consentPreview = buildConsentText({
    full_name: fullName.trim() || "[tu nombre]",
    position: position.trim() || "[tu cargo]",
    id_document: idDocument.trim() || null,
    client_name,
    quote_number,
  });

  function clientValidate(): boolean {
    const e: Record<string, string> = {};
    const fn = fullName.trim();
    const ps = position.trim();
    const id = idDocument.trim();
    if (fn.length < ACCEPTANCE_FULL_NAME_MIN) {
      e.full_name = `Nombre completo (mínimo ${ACCEPTANCE_FULL_NAME_MIN} caracteres)`;
    } else if (fn.length > ACCEPTANCE_FULL_NAME_MAX) {
      e.full_name = `Máximo ${ACCEPTANCE_FULL_NAME_MAX} caracteres`;
    }
    if (ps.length < ACCEPTANCE_POSITION_MIN) {
      e.position = `Cargo (mínimo ${ACCEPTANCE_POSITION_MIN} caracteres)`;
    } else if (ps.length > ACCEPTANCE_POSITION_MAX) {
      e.position = `Máximo ${ACCEPTANCE_POSITION_MAX} caracteres`;
    }
    if (id.length > 0 && id.length > ACCEPTANCE_ID_DOCUMENT_MAX) {
      e.id_document = `Máximo ${ACCEPTANCE_ID_DOCUMENT_MAX} caracteres`;
    }
    if (!consent) {
      e.consent_accepted = "Necesitas confirmar el texto para aceptar";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit() {
    setSubmitError(null);
    if (!clientValidate()) return;

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/public/cotizaciones/${token}/accept`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              full_name: fullName.trim(),
              position: position.trim(),
              id_document: idDocument.trim() || null,
              consent_accepted: consent,
            }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          if (data.fieldErrors) setErrors(data.fieldErrors);
          setSubmitError(data.error ?? "No se pudo registrar la aceptación");
          return;
        }
        onSuccess();
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intenta de nuevo.");
      }
    });
  }

  return (
    <ModalShell title="Aceptar cotización" onClose={isPending ? undefined : onClose}>
      <p className="text-sm text-gray-700 leading-relaxed">
        Estás a punto de aceptar la cotización{" "}
        <span className="font-mono font-semibold">{quote_number}</span> en
        nombre de <strong>{client_name}</strong>. Completa tus datos para
        firmar electrónicamente:
      </p>

      <div className="mt-5 space-y-4">
        <Field
          label="Nombre completo"
          required
          error={errors.full_name}
        >
          <input
            ref={firstInput}
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={isPending}
            maxLength={ACCEPTANCE_FULL_NAME_MAX}
            placeholder="Ej: María Pérez González"
            className="w-full rounded-md border border-gray-300 px-3 py-3 text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none min-h-[48px]"
          />
        </Field>

        <Field label="Cargo o posición" required error={errors.position}>
          <input
            type="text"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            disabled={isPending}
            maxLength={ACCEPTANCE_POSITION_MAX}
            placeholder="Ej: Gerente General"
            className="w-full rounded-md border border-gray-300 px-3 py-3 text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none min-h-[48px]"
          />
        </Field>

        <Field
          label="Cédula o pasaporte"
          hint="Opcional pero recomendado para la evidencia legal"
          error={errors.id_document}
        >
          <input
            type="text"
            value={idDocument}
            onChange={(e) => setIdDocument(e.target.value)}
            disabled={isPending}
            maxLength={ACCEPTANCE_ID_DOCUMENT_MAX}
            placeholder="Ej: PE-123-4567"
            className="w-full rounded-md border border-gray-300 px-3 py-3 text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none min-h-[48px]"
          />
        </Field>

        <div className="rounded-md bg-gray-50 border border-gray-200 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-700 mb-2">
            <ShieldCheck size={14} className="text-integra-gold" />
            Texto que vas a firmar electrónicamente
          </div>
          <p className="text-xs text-gray-700 italic leading-relaxed whitespace-pre-wrap">
            {consentPreview}
          </p>
        </div>

        <label
          htmlFor="consent_accept"
          className="flex items-start gap-3 cursor-pointer select-none"
        >
          <input
            id="consent_accept"
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={isPending}
            className="mt-1 h-5 w-5 rounded border-gray-300 text-integra-navy focus:ring-integra-navy"
          />
          <span className="text-sm text-gray-700 leading-relaxed">
            Confirmo el texto de arriba y autorizo la aceptación de esta
            cotización en nombre de <strong>{client_name}</strong>.
          </span>
        </label>
        {errors.consent_accepted && (
          <p className="text-xs text-red-600 -mt-2">{errors.consent_accepted}</p>
        )}

        {submitError && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-gray-300 bg-white px-4 py-3 min-h-[48px] text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Volver
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-integra-gold px-5 py-3 min-h-[48px] text-sm font-bold text-integra-navy hover:bg-integra-gold/90 disabled:opacity-50"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Registrando aceptación…
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                Confirmar aceptación
              </>
            )}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Reject modal
// ---------------------------------------------------------------------------

function RejectModal({
  token,
  quote_number,
  onClose,
  onSuccess,
}: {
  token: string;
  quote_number: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  function clientValidate(): boolean {
    const e: Record<string, string> = {};
    const r = reason.trim();
    if (r.length < REJECTION_REASON_MIN) {
      e.reason = `Cuéntanos brevemente (mínimo ${REJECTION_REASON_MIN} caracteres)`;
    } else if (r.length > REJECTION_REASON_MAX) {
      e.reason = `Máximo ${REJECTION_REASON_MAX} caracteres`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit() {
    setSubmitError(null);
    if (!clientValidate()) return;

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/public/cotizaciones/${token}/reject`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: reason.trim() }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          if (data.fieldErrors) setErrors(data.fieldErrors);
          setSubmitError(data.error ?? "No se pudo registrar el rechazo");
          return;
        }
        onSuccess();
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intenta de nuevo.");
      }
    });
  }

  const trimmed = reason.trim().length;

  return (
    <ModalShell title={`Rechazar cotización ${quote_number}`} onClose={isPending ? undefined : onClose}>
      <p className="text-sm text-gray-700 leading-relaxed">
        Cuéntanos por qué no procedes con esta cotización. Tu motivo nos
        ayuda a mejorar nuestras propuestas y queda en tu legajo.
      </p>

      <div className="mt-4 space-y-4">
        <Field label="Motivo del rechazo" required error={errors.reason}>
          <textarea
            ref={textareaRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isPending}
            rows={5}
            maxLength={REJECTION_REASON_MAX}
            placeholder="Ej: el alcance no se ajusta a lo que necesitamos, el monto excede el presupuesto, ya elegimos otro proveedor…"
            className="w-full rounded-md border border-gray-300 px-3 py-3 text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400 text-right font-mono">
            {trimmed}/{REJECTION_REASON_MAX}
          </p>
        </Field>

        {submitError && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-gray-300 bg-white px-4 py-3 min-h-[48px] text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Volver
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-red-600 px-5 py-3 min-h-[48px] text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Registrando…
              </>
            ) : (
              <>
                <ThumbsDown size={16} />
                Confirmar rechazo
              </>
            )}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Shared subcomponents
// ---------------------------------------------------------------------------

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-200 px-5 py-4 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-integra-navy">{title}</h2>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
