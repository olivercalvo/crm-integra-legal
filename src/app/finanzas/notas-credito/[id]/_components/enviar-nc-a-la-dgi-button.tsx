"use client";

import { etiquetaDeEnvio } from "@/lib/finanzas/efactura/etiquetas-de-envio";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, AlertCircle, Loader2 } from "lucide-react";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { traducirCodigoDgi } from "@/lib/finanzas/efactura/mensajes-dgi";

interface Props {
  creditNoteId: string;
  creditNoteNumber: string;
  /** El número de la factura que corrige, para nombrarla en el modal. */
  invoiceNumber: string;
  /** Reintento: la NC ya salió una vez y volvió con error. */
  esReintento: boolean;
}

/**
 * «Enviar a la DGI» en el detalle de una nota de crédito.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * POR QUÉ PIDE CONFIRMACIÓN
 * ═════════════════════════════════════════════════════════════════════════════
 * Porque **no se puede deshacer apretando otra vez**. Una vez que la DGI la
 * autoriza, el documento existe ante el fisco: corregirlo ya no es editar, es
 * anularlo ante la DGI dentro de las 182 horas. El modal lo dice antes, no
 * después.
 *
 * 🔴 El botón NO decide si se puede enviar. Eso lo decide el servidor, que
 * mira el CUFE de la factura referenciada y el estado fiscal de la NC. Acá sólo
 * se muestra el error que vuelva, traducido cuando lo conocemos.
 */
export function EnviarNcALaDgiButton({
  creditNoteId,
  creditNoteNumber,
  invoiceNumber,
  esReintento,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);

  const traduccion = traducirCodigoDgi(codigo);

  function enviar() {
    setError(null);
    setCodigo(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/finanzas/credit-notes/${creditNoteId}/emit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const json = (await res.json()) as {
          ok?: boolean;
          mensaje?: string | null;
          error?: string;
        };

        if (!res.ok) {
          setError(json.error ?? "No se pudo enviar la nota de crédito a la DGI.");
          return;
        }
        if (!json.ok) {
          // La DGI contestó y no la aceptó. El envío OCURRIÓ: no es un error
          // del sistema, es una respuesta del fisco, y se muestra como tal.
          const msg = json.mensaje ?? "La DGI no aceptó la nota de crédito.";
          setError(msg);
          const m = msg.match(/\[(\d{3,5})\]/);
          setCodigo(m ? m[1] : null);
          router.refresh();
          return;
        }
        setOpen(false);
        router.refresh();
      } catch {
        setError(
          "No se pudo comunicar con la DGI. La nota de crédito quedó sin enviar y se puede reintentar."
        );
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[48px] items-center gap-2 rounded-md bg-integra-navy px-4 py-2 text-sm font-medium text-white hover:bg-integra-navy/90"
      >
        <Send size={16} />
        {etiquetaDeEnvio(esReintento)}
      </button>

      <ConfirmationModal
        open={open}
        onClose={() => {
          if (!isPending) {
            setOpen(false);
            setError(null);
            setCodigo(null);
          }
        }}
        onConfirm={enviar}
        title={esReintento ? "Reenviar la nota de crédito a la DGI" : "Enviar la nota de crédito a la DGI"}
        confirmButtonText={isPending ? "Enviando…" : etiquetaDeEnvio(esReintento)}
        loading={isPending}
      >
        <div className="space-y-3 text-sm text-gray-700">
          <p>
            Se va a enviar la nota de crédito <strong>{creditNoteNumber}</strong>, que corrige la
            factura <strong>{invoiceNumber}</strong>.
          </p>
          <p className="rounded-md bg-amber-50 p-3 text-amber-900">
            Una vez que la DGI la autorice, la nota de crédito existe ante el fisco y{" "}
            <strong>ya no se puede corregir</strong>: para deshacerla hay que anularla ante la DGI,
            y sólo se puede dentro de las 182 horas siguientes.
          </p>

          {isPending && (
            <p className="flex items-center gap-2 text-gray-600">
              <Loader2 size={16} className="animate-spin" />
              Enviando a la DGI y esperando su respuesta…
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                {traduccion ? (
                  <>
                    <p className="font-semibold">{traduccion.queePaso}</p>
                    <p className="mt-1">{traduccion.queHacer}</p>
                    {/* ⚠️ El texto del PAC NUNCA se tira: es lo único que sirve
                        para hablar con ideati. */}
                    <p className="mt-2 break-words text-xs text-red-800/80">
                      Respuesta de la DGI: {error}
                    </p>
                  </>
                ) : (
                  <p className="break-words">{error}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </ConfirmationModal>
    </>
  );
}
