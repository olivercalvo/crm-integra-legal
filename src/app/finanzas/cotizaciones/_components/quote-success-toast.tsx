"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, Send, XCircle, ThumbsUp, ThumbsDown, ArrowRightCircle, RotateCcw } from "lucide-react";

/**
 * Toast de éxito para acciones del módulo Cotizaciones. Lee los params:
 *   ?created=1, ?saved=1, ?sent=1, ?resent=1, ?cancelled=1, ?accepted=1,
 *   ?rejected=1, ?converted=N
 *
 * El URL param se limpia tras 4s. Análogo a InvoiceSuccessToast.
 */
export function QuoteSuccessToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const created = searchParams.get("created");
  const saved = searchParams.get("saved");
  const sent = searchParams.get("sent");
  const resent = searchParams.get("resent");
  const cancelled = searchParams.get("cancelled");
  const accepted = searchParams.get("accepted");
  const rejected = searchParams.get("rejected");
  const converted = searchParams.get("converted");
  const [visible, setVisible] = useState(false);

  const anyParam = !!(
    created ||
    saved ||
    sent ||
    resent ||
    cancelled ||
    accepted ||
    rejected ||
    converted
  );

  useEffect(() => {
    if (!anyParam) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("created");
      url.searchParams.delete("saved");
      url.searchParams.delete("sent");
      url.searchParams.delete("resent");
      url.searchParams.delete("cancelled");
      url.searchParams.delete("accepted");
      url.searchParams.delete("rejected");
      url.searchParams.delete("converted");
      router.replace(url.pathname + url.search, { scroll: false });
    }, 4000);
    return () => clearTimeout(timer);
  }, [anyParam, router]);

  if (!visible || !anyParam) return null;

  // Resolución de icono + mensaje + paleta. Prioridad por especificidad
  // (converted → rejected → accepted → cancelled → resent → sent → created → saved).
  let icon: React.ReactNode;
  let message: string;
  let palette: "success" | "danger" | "info" = "success";

  if (converted) {
    const count = parseInt(converted, 10);
    icon = <ArrowRightCircle size={18} className="text-violet-600 shrink-0" />;
    message =
      count > 1
        ? `Cotización convertida. ${count} facturas creadas.`
        : "Cotización convertida. 1 factura creada.";
    palette = "info";
  } else if (rejected) {
    icon = <ThumbsDown size={18} className="text-red-600 shrink-0" />;
    message = "Cotización marcada como rechazada";
    palette = "danger";
  } else if (accepted) {
    icon = <ThumbsUp size={18} className="text-green-600 shrink-0" />;
    message = "Cotización marcada como aceptada";
  } else if (cancelled) {
    icon = <XCircle size={18} className="text-red-600 shrink-0" />;
    message = "Cotización cancelada";
    palette = "danger";
  } else if (resent) {
    icon = <RotateCcw size={18} className="text-green-600 shrink-0" />;
    message = "Cotización reenviada por email";
  } else if (sent) {
    icon = <Send size={18} className="text-green-600 shrink-0" />;
    message = "Cotización enviada por email";
  } else if (created) {
    icon = <CheckCircle size={18} className="text-green-600 shrink-0" />;
    message = "Cotización creada correctamente";
  } else {
    icon = <CheckCircle size={18} className="text-green-600 shrink-0" />;
    message = "Cambios guardados correctamente";
  }

  const paletteClass = {
    success: "border-green-200 bg-green-50 text-green-700",
    danger: "border-red-200 bg-red-50 text-red-700",
    info: "border-violet-200 bg-violet-50 text-violet-700",
  }[palette];

  return (
    <div
      className={`rounded-md border px-4 py-3 flex items-center gap-2 animate-in fade-in slide-in-from-top-2 ${paletteClass}`}
    >
      {icon}
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}
