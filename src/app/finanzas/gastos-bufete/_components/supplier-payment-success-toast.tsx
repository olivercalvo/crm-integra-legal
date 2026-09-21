"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CircleDollarSign } from "lucide-react";

/**
 * Toast del detalle de la compra: `?pago=CE-000004`, que pone
 * `RegisterSupplierPaymentDialog` al registrar. Mismo mecanismo que el del
 * cobro: se limpia a los 4 s.
 */
export function SupplierPaymentSuccessToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pago = searchParams.get("pago");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!pago) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("pago");
      router.replace(url.pathname + url.search, { scroll: false });
    }, 4000);
    return () => clearTimeout(timer);
  }, [pago, router]);

  if (!visible || !pago) return null;

  return (
    <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2 text-green-700 animate-in fade-in slide-in-from-top-2">
      <CircleDollarSign size={18} className="text-green-600 shrink-0" />
      <p className="text-sm font-medium">Pago {pago} registrado</p>
    </div>
  );
}
