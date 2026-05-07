"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, Send, FileBadge } from "lucide-react";

/**
 * Toast de éxito para acciones del módulo Facturas. Lee `?saved`, `?emitted`
 * o `?dgi=saved` del URL — análogo a DeleteSuccessToast pero específico para
 * Facturas.
 *
 * El URL param se limpia tras 4s para evitar reaparición al refrescar.
 */
export function InvoiceSuccessToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const saved = searchParams.get("saved");
  const emitted = searchParams.get("emitted");
  const dgi = searchParams.get("dgi");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!saved && !emitted && !dgi) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("saved");
      url.searchParams.delete("emitted");
      url.searchParams.delete("dgi");
      router.replace(url.pathname + url.search, { scroll: false });
    }, 4000);
    return () => clearTimeout(timer);
  }, [saved, emitted, dgi, router]);

  if (!visible || (!saved && !emitted && !dgi)) return null;

  // Resolución del icono + mensaje según qué param vino. Prioridad:
  // emitted (única acción que muestra número) → dgi → saved (genérico).
  let icon: React.ReactNode;
  let message: string;
  if (emitted) {
    icon = <Send size={18} className="text-green-600 shrink-0" />;
    message = `Factura emitida con número ${emitted}`;
  } else if (dgi === "saved") {
    icon = <FileBadge size={18} className="text-green-600 shrink-0" />;
    message = "Datos DGI guardados correctamente";
  } else {
    icon = <CheckCircle size={18} className="text-green-600 shrink-0" />;
    message = "Cambios guardados correctamente";
  }

  return (
    <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
      {icon}
      <p className="text-sm font-medium text-green-700">{message}</p>
    </div>
  );
}
