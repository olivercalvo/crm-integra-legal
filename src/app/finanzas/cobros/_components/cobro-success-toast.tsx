"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CircleDollarSign } from "lucide-react";

/**
 * Toast del listado de cobros. Lee `?recibo=REC-000012`, que pone el alta
 * (`/finanzas/cobros/nuevo`) al redirigir acá. Mismo mecanismo que
 * `InvoiceSuccessToast`: el param se limpia a los 4 s para que no reaparezca
 * al refrescar.
 */
export function CobroSuccessToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const recibo = searchParams.get("recibo");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!recibo) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("recibo");
      router.replace(url.pathname + url.search, { scroll: false });
    }, 4000);
    return () => clearTimeout(timer);
  }, [recibo, router]);

  if (!visible || !recibo) return null;

  return (
    <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2 text-green-700 animate-in fade-in slide-in-from-top-2">
      <CircleDollarSign size={18} className="text-green-600 shrink-0" />
      <p className="text-sm font-medium">Recibo {recibo} registrado</p>
    </div>
  );
}
