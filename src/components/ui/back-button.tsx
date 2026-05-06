"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
  fallbackHref?: string;
  label?: string;
  /**
   * Si true, muestra el `label` visiblemente al lado del icono (botón con
   * texto). Default false → solo icono (sr-only). Backward-compat con
   * /legal que ya usa el botón solo-icono.
   */
  showLabel?: boolean;
}

export function BackButton({ fallbackHref, label, showLabel = false }: BackButtonProps) {
  const router = useRouter();
  const text = label ?? "Volver";

  return (
    <Button
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      className={showLabel ? "min-h-[48px] px-3" : "min-h-[48px] min-w-[48px]"}
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
        } else if (fallbackHref) {
          router.push(fallbackHref);
        }
      }}
      aria-label={text}
    >
      <ArrowLeft size={20} />
      {showLabel ? (
        <span className="ml-2 text-sm font-medium">{text}</span>
      ) : (
        <span className="sr-only">{text}</span>
      )}
    </Button>
  );
}
