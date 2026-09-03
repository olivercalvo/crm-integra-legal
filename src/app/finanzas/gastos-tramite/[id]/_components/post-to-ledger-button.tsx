"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * "Registrar en el libro contable" — el botón que llama a
 * `POST /api/expenses/{id}/post-to-ledger`.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * SE OCULTA CUANDO NO SE PUEDE APRETAR, **ADEMÁS** DE QUE LA RUTA RECHACE
 * ═════════════════════════════════════════════════════════════════════════════
 * Es la regla de CLAUDE.md: *"ocultar el botón NO reemplaza al 403, y el 403 no
 * reemplaza a ocultar el botón. Los dos hacen falta."* El servidor es el
 * permiso; esconder la acción que no se puede ejecutar es lo que evita que
 * alguien apriete algo que le va a fallar.
 *
 * Por eso no se renderiza si:
 *   · el rol no puede postear (el contador LEE esta pantalla, no la registra);
 *   · el gasto ya tiene asiento;
 *   · alguna línea está sin clasificar.
 *
 * En el último caso **el aviso ámbar de arriba ya explica qué falta y por qué**,
 * así que un botón deshabilitado al lado sería ruido: la pantalla ya dice lo que
 * hay que hacer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIRMACIÓN EXPLÍCITA, PORQUE NO SE PUEDE DESHACER
 * ─────────────────────────────────────────────────────────────────────────────
 * Un asiento NO SE BORRA: los triggers de la `023` rechazan UPDATE y DELETE. La
 * única salida es un asiento de reversión que un contador tiene que justificar
 * ante la DGI. Y además, desde ese momento el gasto queda **inmutable**: no se
 * le puede cambiar el monto, la fecha, el proveedor ni las líneas.
 *
 * La confirmación dice las dos cosas, con el importe. Nada de "¿Confirmar?" a
 * secas: lo que se confirma tiene que estar escrito.
 */

interface Props {
  expenseId: string;
  /** Total del gasto, para nombrarlo en la confirmación. */
  total: string;
}

export function PostToLedgerButton({ expenseId, total }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function postear() {
    setError(null);
    setEnviando(true);
    try {
      const res = await fetch(`/api/expenses/${expenseId}/post-to-ledger`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "No se pudo registrar el gasto en el libro");
        setConfirmando(false);
        return;
      }
      setConfirmando(false);
      startTransition(() => router.refresh());
    } catch {
      setError("Error de conexión. Revise su internet e intente de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  if (!confirmando) {
    return (
      <div className="space-y-2">
        <Button
          onClick={() => setConfirmando(true)}
          className="min-h-[44px] bg-integra-navy hover:bg-integra-navy/90"
        >
          <BookOpenCheck size={16} className="mr-1.5" />
          Registrar en el libro contable
        </Button>
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-integra-navy/25 bg-integra-navy/5 p-4">
      <p className="text-sm text-integra-navy">
        Se va a registrar este gasto de <strong className="font-semibold">B/. {total}</strong>{" "}
        en el libro contable.
      </p>
      <p className="text-xs text-gray-600">
        <strong className="font-semibold">Un asiento no se borra.</strong> Desde ese momento
        el gasto queda inmutable: no se le puede cambiar el monto, la fecha, el proveedor ni
        las líneas. Corregirlo requiere un asiento de reversión. El comprobante sí se puede
        seguir adjuntando.
      </p>
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={postear}
          disabled={enviando || isPending}
          className="min-h-[44px] bg-integra-navy hover:bg-integra-navy/90"
        >
          {enviando || isPending ? (
            <Loader2 size={16} className="mr-1.5 animate-spin" />
          ) : (
            <BookOpenCheck size={16} className="mr-1.5" />
          )}
          Sí, registrar
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setConfirmando(false);
            setError(null);
          }}
          disabled={enviando}
          className="min-h-[44px]"
        >
          Volver
        </Button>
      </div>
    </div>
  );
}
