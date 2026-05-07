"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, Send, FileBadge, XCircle } from "lucide-react";

/**
 * Toast de éxito para acciones del módulo Facturas. Lee `?saved`, `?emitted`,
 * `?dgi=saved` o `?cancelled=1` del URL — análogo a DeleteSuccessToast pero
 * específico para Facturas.
 *
 * El URL param se limpia tras 4s para evitar reaparición al refrescar.
 */
export function InvoiceSuccessToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const saved = searchParams.get("saved");
  const emitted = searchParams.get("emitted");
  const dgi = searchParams.get("dgi");
  const cancelled = searchParams.get("cancelled");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!saved && !emitted && !dgi && !cancelled) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("saved");
      url.searchParams.delete("emitted");
      url.searchParams.delete("dgi");
      url.searchParams.delete("cancelled");
      router.replace(url.pathname + url.search, { scroll: false });
    }, 4000);
    return () => clearTimeout(timer);
  }, [saved, emitted, dgi, cancelled, router]);

  if (!visible || (!saved && !emitted && !dgi && !cancelled)) return null;

  // Resolución del icono + mensaje según qué param vino. Prioridad:
  // emitted (única acción que muestra número) → cancelled → dgi → saved.
  // Cancelled tiene paleta roja; el resto verde (acciones positivas).
  let icon: React.ReactNode;
  let message: string;
  let palette: "success" | "danger" = "success";
  if (emitted) {
    icon = <Send size={18} className="text-green-600 shrink-0" />;
    message = `Factura emitida con número ${emitted}`;
  } else if (cancelled) {
    icon = <XCircle size={18} className="text-red-600 shrink-0" />;
    message = "Factura anulada correctamente";
    palette = "danger";
  } else if (dgi === "saved") {
    icon = <FileBadge size={18} className="text-green-600 shrink-0" />;
    message = "Datos DGI guardados correctamente";
  } else {
    icon = <CheckCircle size={18} className="text-green-600 shrink-0" />;
    message = "Cambios guardados correctamente";
  }

  const containerClass =
    palette === "danger"
      ? "rounded-md border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-2 animate-in fade-in slide-in-from-top-2"
      : "rounded-md border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2 animate-in fade-in slide-in-from-top-2";
  const textClass =
    palette === "danger"
      ? "text-sm font-medium text-red-700"
      : "text-sm font-medium text-green-700";

  return (
    <div className={containerClass}>
      {icon}
      <p className={textClass}>{message}</p>
    </div>
  );
}
