"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, Send } from "lucide-react";

/**
 * Toast de éxito para acciones del módulo Facturas. Lee `?saved` o `?emitted`
 * del URL — análogo a DeleteSuccessToast pero específico para Facturas.
 *
 * El URL param se limpia tras 4s para evitar reaparición al refrescar.
 */
export function InvoiceSuccessToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const saved = searchParams.get("saved");
  const emitted = searchParams.get("emitted");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!saved && !emitted) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("saved");
      url.searchParams.delete("emitted");
      router.replace(url.pathname + url.search, { scroll: false });
    }, 4000);
    return () => clearTimeout(timer);
  }, [saved, emitted, router]);

  if (!visible || (!saved && !emitted)) return null;

  return (
    <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
      {emitted ? (
        <Send size={18} className="text-green-600 shrink-0" />
      ) : (
        <CheckCircle size={18} className="text-green-600 shrink-0" />
      )}
      <p className="text-sm font-medium text-green-700">
        {emitted
          ? `Factura emitida con número ${emitted}`
          : "Cambios guardados correctamente"}
      </p>
    </div>
  );
}
