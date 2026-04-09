"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";

interface DeleteSuccessToastProps {
  entityLabel: string;
}

export function DeleteSuccessToast({ entityLabel }: DeleteSuccessToastProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const deleted = searchParams.get("deleted");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (deleted) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        // Clean URL
        const url = new URL(window.location.href);
        url.searchParams.delete("deleted");
        router.replace(url.pathname + url.search, { scroll: false });
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [deleted, router]);

  if (!visible || !deleted) return null;

  return (
    <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2">
      <CheckCircle size={18} className="text-green-600 shrink-0" />
      <p className="text-sm font-medium text-green-700">
        {entityLabel} {deleted} eliminado correctamente
      </p>
    </div>
  );
}
