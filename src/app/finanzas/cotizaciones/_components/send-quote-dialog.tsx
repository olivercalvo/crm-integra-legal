"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, AlertCircle, AlertTriangle, Loader2, Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface Props {
  quoteId: string;
  quoteNumber: string;
  /** Email sugerido por defecto — usualmente el del cliente. */
  defaultEmail: string | null;
  /** URL pública del portal (D4). En 2E.2 es informativo (portal viene en 2E.4). */
  publicPortalBaseUrl?: string;
  disabled?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Botón "Enviar" + dialog en dos pasos (D4):
 *
 *   Step 1: dialog con input email destinatario + confirmar.
 *   Step 2 (post-éxito): dialog con el link público copiable + banner
 *           "El portal público estará disponible en una próxima
 *           actualización."
 *
 * El POST /send genera el public_token. La ruta /cotizacion/[token] aún
 * NO existe (es Fase 2E.4); por eso el banner ámbar avisa que el link
 * todavía no es funcional.
 */
export function SendQuoteDialog({
  quoteId,
  quoteNumber,
  defaultEmail,
  publicPortalBaseUrl,
  disabled,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState<"compose" | "success">("compose");
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [publicLink, setPublicLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
        const res = await fetch(`/api/finanzas/quotes/${quoteId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sent_to_email: trimmed }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.fieldErrors?.sent_to_email) {
            setEmailError(data.fieldErrors.sent_to_email);
          }
          setSubmitError(data.error ?? "No se pudo enviar la cotización.");
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
        setStep("success");
        // Refresh para que el server component recargue con status='enviada'.
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
    url.searchParams.set("sent", "1");
    router.replace(url.pathname + url.search, { scroll: false });
    router.refresh();
  }

  return (
    <>
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
        title={`Enviar cotización ${quoteNumber}`}
        confirmButtonText={isPending ? "Enviando…" : "Sí, enviar"}
        cancelButtonText="Cancelar"
      >
        <div className="space-y-4">
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
              Por ahora no se envía email automático: solo se genera el
              link público para que lo compartas manualmente.
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

      {/* Step 2: éxito con link público */}
      <ConfirmationModal
        open={open && step === "success"}
        onClose={closeAfterSuccess}
        onConfirm={closeAfterSuccess}
        loading={false}
        title="✓ Cotización enviada"
        confirmButtonText="Cerrar"
        cancelButtonText="Cerrar"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            La cotización <span className="font-mono font-semibold">{quoteNumber}</span>{" "}
            quedó marcada como <span className="font-semibold">enviada</span>.
          </p>

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
              actualización. Por ahora el link funciona como referencia
              interna. Pega este link en el email o WhatsApp que envíes al
              cliente. Cuando el cliente responda, marca la cotización como
              aceptada o rechazada manualmente desde esta misma pantalla.
            </p>
          </div>
        </div>
      </ConfirmationModal>
    </>
  );
}
