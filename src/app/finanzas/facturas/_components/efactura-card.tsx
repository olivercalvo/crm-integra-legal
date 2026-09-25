"use client";

import { useState } from "react";
import {
  Zap,
  Fingerprint,
  Stamp,
  CalendarCheck,
  QrCode,
  Hash,
  Loader2,
  AlertCircle,
  XCircle,
  Copy,
  Check,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils/format-date";
import { FeEstadoBadge } from "@/components/finanzas/fe-estado-badge";
import type { FeEstado } from "@/lib/finanzas/types/invoice";
import { EmitEfacturaDialog } from "./emit-efactura-dialog";
import type { RechazoTraducido } from "@/lib/finanzas/efactura/mensajes-dgi";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  grandTotal: number;
  receptorRuc: string | null;
  receptorNombre: string | null;
  /** Estado fiscal actual. */
  feEstado: FeEstado;
  /** Datos autorizados — todos null mientras feEstado != 'authorized'. */
  cufe: string | null;
  protocoloAutorizacion: string | null;
  fechaAutorizacion: string | null;
  qrContent: string | null;
  puntoFacturacion: string | null;
  numeroDocumento: number | null;
  /** Si el usuario puede disparar el envío (admin|abogada). */
  canEmitToPac: boolean;
  /**
   * 🔴 Lo que dijo la DGI en el último envío fallido, ya traducido.
   *
   * Antes esta sección decía "el último envío al PAC falló" y nada más: para
   * saber POR QUÉ había que apretar el botón otra vez y leerlo en el diálogo.
   * O sea que para enterarse del motivo del rechazo había que provocar otro.
   *
   * `null` cuando no hay registro del intento (facturas anteriores al
   * cableado, o una lectura que falló): la sección vuelve al aviso genérico.
   */
  rechazo?: RechazoTraducido | null;
}

/**
 * Card "Facturación Electrónica" en el detalle de factura. Render por
 * fe_estado:
 *   - no_emitida → CTA "Enviar al PAC" (gated por canEmitToPac).
 *   - pending    → indicador "Pendiente PAC", sin CTA. La transición la
 *                  hace la respuesta T4 del orquestador o un reconciliador
 *                  futuro.
 *   - authorized → datos oficiales DGI (CUFE, protocolo, fecha, punto+nro,
 *                  link QR si vino).
 *   - error      → mensaje genérico + CTA "Reintentar". El detalle de
 *                  códigos vive en el dialog cuando se reintenta y falla
 *                  nuevamente, o en fe_emisiones (consulta manual).
 *   - canceled   → leyenda "Anulada en DGI" (lectura).
 *
 * El gate fiscal (status='emitida' + fe_estado IN ('no_emitida','error')) se
 * replica acá para mostrar el botón; el server-side ya rechaza con 409 si
 * se cuela una solicitud fuera de gate.
 */
export function EfacturaCard({
  invoiceId,
  invoiceNumber,
  grandTotal,
  receptorRuc,
  receptorNombre,
  feEstado,
  cufe,
  protocoloAutorizacion,
  fechaAutorizacion,
  qrContent,
  puntoFacturacion,
  numeroDocumento,
  canEmitToPac,
  rechazo,
}: Props) {
  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-integra-navy flex items-center gap-2">
          <Zap size={18} className="text-integra-gold" />
          Facturación Electrónica
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Estado fiscal:</span>
          <FeEstadoBadge estado={feEstado} />
        </div>
      </div>

      {feEstado === "no_emitida" && (
        <NoEmitidaSection
          yaExisteAnteLaDgi={!!cufe && cufe.trim().length > 0}
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          grandTotal={grandTotal}
          receptorRuc={receptorRuc}
          receptorNombre={receptorNombre}
          canEmitToPac={canEmitToPac}
        />
      )}

      {feEstado === "pending" && <PendingSection />}

      {feEstado === "authorized" && (
        <AuthorizedSection
          cufe={cufe}
          protocoloAutorizacion={protocoloAutorizacion}
          fechaAutorizacion={fechaAutorizacion}
          qrContent={qrContent}
          puntoFacturacion={puntoFacturacion}
          numeroDocumento={numeroDocumento}
        />
      )}

      {feEstado === "error" && (
        <ErrorSection
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          grandTotal={grandTotal}
          receptorRuc={receptorRuc}
          receptorNombre={receptorNombre}
          canEmitToPac={canEmitToPac}
          rechazo={rechazo ?? null}
        />
      )}

      {feEstado === "canceled" && <CanceledSection />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-secciones por estado
// ---------------------------------------------------------------------------

function NoEmitidaSection({
  yaExisteAnteLaDgi,
  invoiceId,
  invoiceNumber,
  grandTotal,
  receptorRuc,
  receptorNombre,
  canEmitToPac,
}: {
  yaExisteAnteLaDgi: boolean;
  invoiceId: string;
  invoiceNumber: string;
  grandTotal: number;
  receptorRuc: string | null;
  receptorNombre: string | null;
  canEmitToPac: boolean;
}) {
  // Caso B de 9C: CUFE cargado del portal. La factura ya existe ante la DGI y
  // `fe_estado` sigue en `no_emitida` a propósito. Ofrecer «Enviar al PAC» acá
  // emitía un segundo documento fiscal por la misma venta. El servidor también
  // lo rechaza (409 en emitInvoiceToEfactura).
  if (yaExisteAnteLaDgi) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-5 text-center">
        <p className="text-sm text-gray-700">
          Esta factura ya existe ante la DGI: su CUFE se cargó del portal. No
          se envía al PAC desde acá, porque sería un segundo documento fiscal
          por la misma venta.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-integra-gold/40 bg-integra-navy/[0.02] p-5 text-center">
      <p className="mb-4 text-sm text-gray-700">
        Esta factura todavía no fue enviada al PAC. Al enviar, la DGI emite
        el CUFE oficial y los datos quedan registrados aquí.
      </p>
      {canEmitToPac ? (
        <EmitEfacturaDialog
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          grandTotal={grandTotal}
          receptorRuc={receptorRuc}
          receptorNombre={receptorNombre}
          isRetry={false}
        />
      ) : (
        <p className="text-xs italic text-gray-500">
          Solo admin o abogada pueden enviar facturas al PAC.
        </p>
      )}
    </div>
  );
}

function PendingSection() {
  return (
    <div className="flex items-start gap-3 rounded-lg border-l-4 border-amber-400 bg-amber-50 p-4 text-amber-900">
      <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-amber-600" />
      <div className="text-sm">
        <p className="font-semibold">Envío en proceso</p>
        <p>
          La DGI está procesando la factura. Refresca la página en unos
          segundos para ver el resultado.
        </p>
      </div>
    </div>
  );
}

function AuthorizedSection({
  cufe,
  protocoloAutorizacion,
  fechaAutorizacion,
  qrContent,
  puntoFacturacion,
  numeroDocumento,
}: {
  cufe: string | null;
  protocoloAutorizacion: string | null;
  fechaAutorizacion: string | null;
  qrContent: string | null;
  puntoFacturacion: string | null;
  numeroDocumento: number | null;
}) {
  const puntoYNumero =
    puntoFacturacion && numeroDocumento !== null
      ? `${puntoFacturacion} / ${String(numeroDocumento).padStart(10, "0")}`
      : null;

  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-lg border bg-gray-50/50 p-3 sm:col-span-2">
        <dt className="flex items-center gap-1 text-xs uppercase tracking-wider text-gray-500">
          <Fingerprint size={14} /> CUFE
        </dt>
        <dd className="mt-1 flex items-center gap-2 break-all font-mono text-xs text-gray-900">
          {cufe ? (
            <>
              <span className="truncate" title={cufe}>
                {cufe}
              </span>
              <InlineCopyButton value={cufe} ariaLabel="Copiar CUFE" />
            </>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </dd>
      </div>

      <div className="rounded-lg border bg-gray-50/50 p-3">
        <dt className="flex items-center gap-1 text-xs uppercase tracking-wider text-gray-500">
          <Stamp size={14} /> Protocolo
        </dt>
        <dd className="mt-1 font-mono text-sm text-gray-900">
          {protocoloAutorizacion ?? <span className="text-gray-400">—</span>}
        </dd>
      </div>

      <div className="rounded-lg border bg-gray-50/50 p-3">
        <dt className="flex items-center gap-1 text-xs uppercase tracking-wider text-gray-500">
          <CalendarCheck size={14} /> Fecha autorización
        </dt>
        <dd className="mt-1 text-sm font-medium text-gray-900">
          {fechaAutorizacion ? (
            formatDateTime(fechaAutorizacion)
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </dd>
      </div>

      <div className="rounded-lg border bg-gray-50/50 p-3">
        <dt className="flex items-center gap-1 text-xs uppercase tracking-wider text-gray-500">
          <Hash size={14} /> Punto / Documento
        </dt>
        <dd className="mt-1 font-mono text-sm text-gray-900">
          {puntoYNumero ?? <span className="text-gray-400">—</span>}
        </dd>
      </div>

      <div className="rounded-lg border bg-gray-50/50 p-3">
        <dt className="flex items-center gap-1 text-xs uppercase tracking-wider text-gray-500">
          <QrCode size={14} /> Consulta DGI
        </dt>
        <dd className="mt-1 text-sm">
          {qrContent ? (
            <a
              href={qrContent}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-medium text-integra-navy hover:underline"
            >
              Abrir en portal DGI
            </a>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

function ErrorSection({
  invoiceId,
  invoiceNumber,
  grandTotal,
  receptorRuc,
  receptorNombre,
  canEmitToPac,
  rechazo,
}: {
  invoiceId: string;
  invoiceNumber: string;
  grandTotal: number;
  receptorRuc: string | null;
  receptorNombre: string | null;
  canEmitToPac: boolean;
  rechazo: RechazoTraducido | null;
}) {
  // 🔴 Un envío que quedó INCIERTO no es un rechazo, y decirle a la licenciada
  //    que la DGI rechazó algo que puede estar autorizado la manda a corregir
  //    una factura que está perfecta. Es la lección del `0600`.
  const incierto = rechazo?.donde === "ningún lado" && rechazo?.sinTraduccion === false;

  return (
    <div className="space-y-3">
      <div
        role="alert"
        className="flex items-start gap-3 rounded-lg border-l-4 border-red-500 bg-red-50 p-4 text-red-900"
      >
        <AlertCircle size={20} className="mt-0.5 shrink-0 text-red-600" />
        <div className="space-y-2 text-sm">
          <p className="font-semibold">
            {rechazo
              ? "La DGI no aceptó esta factura"
              : "El último envío al PAC falló"}
          </p>

          {rechazo ? (
            <>
              <p>{rechazo.resumen}</p>
              {rechazo.queHacer && (
                <p>
                  <span className="font-semibold">Qué hacer: </span>
                  {rechazo.queHacer}
                </p>
              )}
              {/* 🔴 El texto del PAC NUNCA se tira: traducir no es reemplazar,
                  y es lo único que sirve para hablar con ideati. */}
              <p className="rounded border border-red-200 bg-white/60 px-2 py-1 font-mono text-xs text-red-800">
                {rechazo.textoDelPac}
              </p>
              {rechazo.sinTraduccion && (
                <p className="text-xs italic">
                  El sistema no tiene traducido este motivo. El texto de arriba es el que
                  devolvió la DGI.
                </p>
              )}
            </>
          ) : (
            <p>
              Puede volver a enviarla. Si falla otra vez, el detalle del rechazo se muestra en
              el cuadro de confirmación.
            </p>
          )}

          {/* El aviso queda hasta que se reenvíe: editar el cliente o la
              factura NO lo borra. Es a propósito — el caso que trajo esto fue
              una factura corregida que nunca se reenvió y quedó rechazada ante
              la DGI con los datos ya arreglados. */}
          <p className="text-xs">
            Este aviso queda hasta que la factura se envíe otra vez y la DGI la acepte.
            Corregir los datos no lo borra.
          </p>
        </div>
      </div>
      {canEmitToPac ? (
        <EmitEfacturaDialog
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          grandTotal={grandTotal}
          receptorRuc={receptorRuc}
          receptorNombre={receptorNombre}
          isRetry
          etiqueta={incierto ? "Consultar y reenviar a la DGI" : "Reenviar a la DGI"}
        />
      ) : (
        <p className="text-xs italic text-gray-500">
          Solo admin o abogada pueden reenviar facturas a la DGI.
        </p>
      )}
    </div>
  );
}

function InlineCopyButton({
  value,
  ariaLabel,
}: {
  value: string;
  ariaLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // si el navegador bloquea, fallback silencioso
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={ariaLabel}
      className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-900"
    >
      {copied ? (
        <Check size={14} className="text-green-600" />
      ) : (
        <Copy size={14} />
      )}
    </button>
  );
}

function CanceledSection() {
  return (
    <div className="flex items-start gap-3 rounded-lg border-l-4 border-gray-400 bg-gray-50 p-4 text-gray-700">
      <XCircle size={20} className="mt-0.5 shrink-0 text-gray-500" />
      <div className="text-sm">
        <p className="font-semibold">Anulada en DGI</p>
        <p>
          La factura fue anulada del lado de la DGI. Esta acción es
          irreversible fiscalmente.
        </p>
      </div>
    </div>
  );
}
