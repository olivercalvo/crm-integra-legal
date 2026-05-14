"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Mail,
  Paperclip,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

/**
 * SendQuoteDialog en dos modos (D4 original + hotfix Sprint 2E.3):
 *
 *   mode='initial' (default): comportamiento original. Transición
 *      borrador → enviada vía POST /send. Setea public_token + sent_*.
 *
 *   mode='resend': reenvío manual una vez que la cotización ya está en
 *      enviada/aceptada/rechazada. Permite mantener o cambiar el email.
 *      NO cambia el status. POST a /resend en lugar de /send. El audit_log
 *      queda con action='resend_quote' y guarda el sent_at/email previo.
 *
 * Step 1: dialog con input email destinatario + confirmar.
 * Step 2 (post-éxito): confirmación con resumen del envío (email
 *         enviado + PDF adjunto + link público copiable).
 *
 * Sprint 2E.3: el POST genera el PDF, lo adjunta al email y lo envía vía
 * Resend. Si el email falla (DNS pendiente u otro motivo), la cotización
 * igual queda marcada como enviada y la UI muestra el fallback con el link
 * público copiable para compartir manualmente.
 */

export type SendQuoteDialogMode = "initial" | "resend";

interface Props {
  quoteId: string;
  quoteNumber: string;
  /** Email sugerido por defecto — usualmente el del cliente. */
  defaultEmail: string | null;
  /** URL pública del portal (D4). Sprint 2E.4: portal queda como placeholder. */
  publicPortalBaseUrl?: string;
  disabled?: boolean;
  /** Modo del dialog (initial = transición borrador→enviada, resend = reenvío). */
  mode?: SendQuoteDialogMode;
  /**
   * Solo para mode='resend': string descriptivo del status actual,
   * para mostrar en el dialog ("enviada" / "aceptada" / "rechazada").
   */
  currentStatusLabel?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SendQuoteDialog({
  quoteId,
  quoteNumber,
  defaultEmail,
  publicPortalBaseUrl,
  disabled,
  mode = "initial",
  currentStatusLabel,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState<"compose" | "success">("compose");
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [publicLink, setPublicLink] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<boolean | null>(null);
  const [apiEmailError, setApiEmailError] = useState<string | null>(null);
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isResend = mode === "resend";
  const endpoint = isResend
    ? `/api/finanzas/quotes/${quoteId}/resend`
    : `/api/finanzas/quotes/${quoteId}/send`;

  // Autofocus al input cuando abre el dialog en step compose.
  useEffect(() => {
    if (!open || step !== "compose") return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, step]);

  function reset() {
    setStep("compose");
    setEmail(defaultEmail ?? "");
    setEmailError(null);
    setSubmitError(null);
    setPublicLink(null);
    setEmailSent(null);
    setApiEmailError(null);
    setSentToEmail(null);
    setCopied(false);
  }

  function submit() {
    setEmailError(null);
    setSubmitError(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError("Email del destinatario requerido");
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setEmailError("Email inválido");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sent_to_email: trimmed }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.fieldErrors?.sent_to_email) {
            setEmailError(data.fieldErrors.sent_to_email);
          }
          setSubmitError(
            data.error ??
              (isResend
                ? "No se pudo reenviar la cotización."
                : "No se pudo enviar la cotización.")
          );
          return;
        }

        // Éxito: armar link público y pasar a step 2.
        const token = data.public_token as string | undefined;
        if (token) {
          const base =
            publicPortalBaseUrl ??
            (typeof window !== "undefined" ? window.location.origin : "");
          setPublicLink(`${base}/cotizacion/${token}`);
        }
        // Estado del envío de email (best-effort, Sprint 2E.3).
        setEmailSent(data.email_sent === true);
        setApiEmailError(
          typeof data.email_error === "string" ? data.email_error : null
        );
        setSentToEmail(trimmed);
        setStep("success");
        // Refresh para que el server component recargue con sent_at actualizado.
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intenta de nuevo.");
      }
    });
  }

  async function copyLink() {
    if (!publicLink) return;
    try {
      await navigator.clipboard.writeText(publicLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: seleccionar el contenido del input.
      const el = document.getElementById("quote-public-link") as HTMLInputElement | null;
      el?.select();
    }
  }

  function closeAfterSuccess() {
    setOpen(false);
    reset();
    // Reflejar el cambio en la URL sin reload completo.
    const url = new URL(window.location.href);
    url.searchParams.set(isResend ? "resent" : "sent", "1");
    router.replace(url.pathname + url.search, { scroll: false });
    router.refresh();
  }

  // Estilo del trigger: gold para envío inicial (CTA primario), outline
  // para reenvío (acción secundaria sobre una cotización ya enviada).
  const triggerButton = isResend ? (
    <Button
      type="button"
      onClick={() => {
        reset();
        setOpen(true);
      }}
      disabled={disabled || isPending}
      variant="outline"
      className="min-h-[48px]"
      title="Reenviar cotización por email"
    >
      <RotateCcw size={16} className="mr-2" />
      Reenviar
    </Button>
  ) : (
    <Button
      type="button"
      onClick={() => {
        reset();
        setOpen(true);
      }}
      disabled={disabled || isPending}
      className="bg-integra-gold text-integra-navy hover:bg-integra-gold/90 min-h-[48px]"
    >
      <Send size={16} className="mr-2" />
      Enviar
    </Button>
  );

  const dialogTitle = isResend
    ? `Reenviar cotización ${quoteNumber}`
    : `Enviar cotización ${quoteNumber}`;
  const confirmText = isPending
    ? isResend
      ? "Reenviando…"
      : "Enviando…"
    : isResend
      ? "Sí, reenviar"
      : "Sí, enviar";
  const successTitle = isResend ? "✓ Cotización reenviada" : "✓ Cotización enviada";
  const successDescription = isResend ? (
    <>
      La cotización <span className="font-mono font-semibold">{quoteNumber}</span>{" "}
      se reenvió al destinatario. Sigue en estado{" "}
      <span className="font-semibold">{currentStatusLabel ?? "el actual"}</span>.
    </>
  ) : (
    <>
      La cotización <span className="font-mono font-semibold">{quoteNumber}</span>{" "}
      quedó marcada como <span className="font-semibold">enviada</span>.
    </>
  );

  return (
    <>
      {triggerButton}

      <ConfirmationModal
        open={open && step === "compose"}
        onClose={() => {
          if (!isPending) {
            setOpen(false);
            reset();
          }
        }}
        onConfirm={submit}
        loading={isPending}
        title={dialogTitle}
        confirmButtonText={confirmText}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-4">
          {isResend ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <p>
                Si cambias el email, se reenviará a la nueva dirección. El
                historial de envíos queda en el audit log. El estado de la
                cotización no cambia.
              </p>
            </div>
          ) : (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <p>
                Al enviar, la cotización queda bloqueada para edición. Solo
                podrás marcarla como aceptada o rechazada manualmente.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="send_quote_email" className="text-sm">
              Email del destinatario{" "}
              <span className="text-red-600" aria-hidden="true">
                *
              </span>
            </Label>
            <Input
              id="send_quote_email"
              ref={inputRef}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError(null);
              }}
              disabled={isPending}
              placeholder="cliente@ejemplo.com"
              className={`mt-1 ${emailError ? "border-red-300" : ""}`}
            />
            {emailError && (
              <p className="mt-1 text-xs text-red-600">{emailError}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              {isResend
                ? "Al confirmar enviamos nuevamente el PDF de la cotización por email a esta dirección."
                : "Al confirmar enviamos el PDF de la cotización por email con el link de aceptación. La cotización queda marcada como enviada y ya no se puede editar."}
            </p>
          </div>

          {submitError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {isPending && (
            <p className="text-xs text-gray-500 inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Procesando…
            </p>
          )}
        </div>
      </ConfirmationModal>

      {/* Step 2: éxito con resumen del envío */}
      <ConfirmationModal
        open={open && step === "success"}
        onClose={closeAfterSuccess}
        onConfirm={closeAfterSuccess}
        loading={false}
        title={successTitle}
        confirmButtonText="Cerrar"
        cancelButtonText="Cerrar"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">{successDescription}</p>

          {/* Resultado del envío de email */}
          {emailSent === true ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border-l-4 border-green-400 bg-green-50 p-3 text-sm text-green-800"
            >
              <Mail size={16} className="mt-0.5 shrink-0 text-green-600" />
              <div className="space-y-1">
                <p className="font-semibold">
                  Email enviado a {sentToEmail ?? "el destinatario"}
                </p>
                <p className="text-xs text-green-700 inline-flex items-center gap-1">
                  <Paperclip size={11} />
                  Con el PDF de la cotización adjunto y el link de aceptación.
                </p>
              </div>
            </div>
          ) : (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-700" />
              <div className="space-y-1">
                <p className="font-semibold">
                  No se pudo enviar el email automático
                </p>
                <p className="text-xs">
                  {apiEmailError ??
                    "Verifica con el equipo técnico que el servicio de email esté configurado."}
                  {" "}
                  {isResend
                    ? "El registro de reenvío igual quedó guardado — copia el link de abajo y compártelo manualmente con el cliente."
                    : "La cotización igual quedó marcada como enviada — copia el link de abajo y compártelo manualmente con el cliente."}
                </p>
              </div>
            </div>
          )}

          <div>
            <Label className="text-sm">Link público para el cliente</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                id="quote-public-link"
                readOnly
                value={publicLink ?? ""}
                className="font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyLink}
                className="shrink-0 min-h-[40px]"
              >
                {copied ? (
                  <>
                    <Check size={14} className="mr-1 text-green-600" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy size={14} className="mr-1" />
                    Copiar
                  </>
                )}
              </Button>
            </div>
          </div>

          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-xs text-amber-900"
          >
            <ExternalLink size={14} className="mt-0.5 shrink-0 text-amber-600" />
            <p>
              El portal público estará disponible en una próxima
              actualización. Cuando el cliente responda, marca la cotización
              como aceptada o rechazada manualmente desde esta misma pantalla.
            </p>
          </div>
        </div>
      </ConfirmationModal>
    </>
  );
}
