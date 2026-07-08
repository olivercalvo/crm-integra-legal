"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  CheckCircle,
  Send,
  FileBadge,
  XCircle,
  ArrowRightCircle,
  Zap,
  Loader2,
  AlertCircle,
} from "lucide-react";

/**
 * Toast de éxito para acciones del módulo Facturas. Lee `?saved`, `?emitted`,
 * `?dgi=saved`, `?cancelled=1`, `?converted=<N>` o `?fe=sent|pending|error`
 * del URL — análogo a DeleteSuccessToast pero específico para Facturas.
 *
 * `?converted=N` viene del flujo de Cotizaciones cuando ConvertToInvoicesDialog
 * redirige acá tras crear N facturas. N puede ser 1 o 2 según las líneas
 * mixtas (D2).
 *
 * `?fe=sent` se setea cuando el PAC devuelve feEstado='authorized'.
 * `?fe=pending` cuando devuelve feEstado='pending' (envío en proceso).
 * `?fe=error` se reserva para futuros flujos que cierren el modal en error
 * (hoy el dialog deja el modal abierto y no setea el param).
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
  const converted = searchParams.get("converted");
  const fe = searchParams.get("fe");
  const [visible, setVisible] = useState(false);

  const anyParam = !!(saved || emitted || dgi || cancelled || converted || fe);

  useEffect(() => {
    if (!anyParam) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("saved");
      url.searchParams.delete("emitted");
      url.searchParams.delete("dgi");
      url.searchParams.delete("cancelled");
      url.searchParams.delete("converted");
      url.searchParams.delete("fe");
      router.replace(url.pathname + url.search, { scroll: false });
    }, 4000);
    return () => clearTimeout(timer);
  }, [anyParam, router]);

  if (!visible || !anyParam) return null;

  // Resolución del icono + mensaje según qué param vino. Prioridad:
  // fe (envío al PAC) → converted (Cotizaciones) → emitted → cancelled →
  // dgi → saved. Paletas: fe=sent verde + ícono rayo; fe=pending ámbar;
  // fe=error rojo; converted violeta; cancelled rojo; resto verde.
  let icon: React.ReactNode;
  let message: string;
  let palette: "success" | "danger" | "info" | "warning" = "success";
  if (fe === "sent") {
    icon = <Zap size={18} className="text-green-600 shrink-0" />;
    message = "Factura autorizada por la DGI";
  } else if (fe === "pending") {
    icon = <Loader2 size={18} className="text-amber-600 shrink-0 animate-spin" />;
    message = "Envío en proceso. Refresca en unos segundos.";
    palette = "warning";
  } else if (fe === "error") {
    icon = <AlertCircle size={18} className="text-red-600 shrink-0" />;
    message = "El PAC rechazó la factura. Revisa el detalle.";
    palette = "danger";
  } else if (converted) {
    const count = parseInt(converted, 10);
    icon = <ArrowRightCircle size={18} className="text-violet-600 shrink-0" />;
    message =
      count > 1
        ? `Cotización convertida. ${count} facturas creadas.`
        : "Cotización convertida. 1 factura creada.";
    palette = "info";
  } else if (emitted) {
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

  const paletteClass = {
    success: "border-green-200 bg-green-50 text-green-700",
    danger: "border-red-200 bg-red-50 text-red-700",
    info: "border-violet-200 bg-violet-50 text-violet-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
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
