"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  quoteId: string;
  /** "button" (header del detalle) o "icon" (fila del listado, compacto). */
  variant?: "button" | "icon";
  quoteNumber?: string;
  disabled?: boolean;
}

/**
 * Botón "Duplicar cotización" — Sprint 2E.4.
 *
 * Sin modal de confirmación: la operación es reversible (la duplicada nace
 * en 'borrador' y se puede eliminar/cancelar). Click → POST al endpoint →
 * redirect a la edición del nuevo quote con ?duplicated=1 para que el toast
 * informe a la abogada.
 *
 * Variantes:
 *   - "button": estilo botón con texto, para el header del detalle.
 *   - "icon": botón compacto solo con ícono + tooltip, para el listado.
 */
export function DuplicateQuoteButton({
  quoteId,
  variant = "button",
  quoteNumber,
  disabled,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick(e: React.MouseEvent) {
    // Si está en una fila del listado, evitar que el click navegue al
    // detalle por el <Link> padre.
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/finanzas/quotes/${quoteId}/duplicate`,
          { method: "POST" }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo duplicar la cotización");
          return;
        }
        if (data.id) {
          router.push(`/finanzas/cotizaciones/${data.id}/editar?duplicated=1`);
          router.refresh();
        }
      } catch {
        setError("Error de red. Intenta de nuevo.");
      }
    });
  }

  if (variant === "icon") {
    const label = quoteNumber
      ? `Duplicar cotización ${quoteNumber}`
      : "Duplicar cotización";
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isPending}
        title={error ?? label}
        aria-label={label}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-integra-navy/5 hover:text-integra-navy disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Copy size={16} />
        )}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={disabled || isPending}
      className="min-h-[48px]"
      title={error ?? undefined}
    >
      {isPending ? (
        <>
          <Loader2 size={16} className="mr-2 animate-spin" />
          Duplicando…
        </>
      ) : (
        <>
          <Copy size={16} className="mr-2" />
          Duplicar
        </>
      )}
    </Button>
  );
}
