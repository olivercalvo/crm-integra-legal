"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

const REASONS: Record<string, string> = {
  terms_template:
    "Sin permiso: solo el administrador puede editar la plantilla de Términos y Condiciones.",
};

/**
 * Toast de "Sin permiso" para acciones gate-eadas por rol. Lee `?denied=<reason>`
 * y muestra un banner rojo con el mensaje correspondiente. Se auto-limpia
 * tras 4s.
 */
export function DeniedToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const reason = searchParams.get("denied");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!reason) return;
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("denied");
      router.replace(url.pathname + url.search, { scroll: false });
    }, 4000);
    return () => clearTimeout(t);
  }, [reason, router]);

  if (!visible || !reason) return null;

  const message = REASONS[reason] ?? "Sin permiso para realizar esta acción.";

  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
      <ShieldAlert size={18} className="text-red-600 shrink-0" />
      <p className="text-sm font-medium text-red-700">{message}</p>
    </div>
  );
}
