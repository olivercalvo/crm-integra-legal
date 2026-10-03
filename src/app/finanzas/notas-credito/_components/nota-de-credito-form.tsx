"use client";

import { useMemo, useState, useTransition } from "react";
import { SelectorDeEnvio, type ModoDeEnvio } from "@/components/finanzas/selector-de-envio";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, FileMinus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ClientCombobox } from "@/components/finanzas/client-combobox";
import { CampoFechaDeRegistro } from "@/components/finanzas/campo-fecha-de-registro";
import { InvoiceLineItems, makeEmptyLine } from "@/app/finanzas/facturas/_components/invoice-line-items";
import { fmtImporte } from "@/lib/utils/importe";
import { hoyEnPanama } from "@/lib/utils/hoy-en-panama";
import {
  MENSAJE_NC_VENTA_SIN_FACTURA,
  NC_MOTIVO_MAX,
  NC_MOTIVO_MIN,
  PERMITIR_NC_VENTA_SIN_FACTURA,
  totalDeLineaDeNc,
  validarLineasDeNotaDeCredito,
  type LineaPedidaNc,
  type TasaDelCatalogo,
} from "@/lib/finanzas/validators/credit-note";
import type { FacturaAbiertaParaNc } from "@/lib/finanzas/queries/notas-credito";
import type { ClientOption, InvoiceLineInput, ServiceOption, TaxCodeOption } from "@/lib/finanzas/types/invoice";

/**
 * LA NOTA DE CRÉDITO DE VENTA COMO MÓDULO PROPIO (E8, 01/10/2026).
 *
 * Se elige el cliente; la factura es OPCIONAL y sale de la lista de sus
 * facturas abiertas. Al elegirla se cargan sus líneas (lo que queda por
 * acreditar de cada una) y todo queda editable: cantidad, precio, descripción y
 * gravada o exenta. Las líneas se editan con el MISMO componente que la
 * factura (`InvoiceLineItems`).
 *
 * 🔒 Lo que se ve en vivo (el tope de cada línea, el total, si se pasa del
 *    saldo) sale de `validarLineasDeNotaDeCredito`, la MISMA función pura que
 *    corre el servidor antes de tomar el número. Si la pantalla dice que está
 *    bien, el servidor dice lo mismo.
 *
 * 🔴 Sin factura: hoy apagado (`PERMITIR_NC_VENTA_SIN_FACTURA`, P-4a). Cuando
 *    se encienda, la pantalla pregunta antes de guardar.
 */
export function NotaDeCreditoForm({
  clients,
  services,
  taxCodes,
  facturas,
  facturaInicial,
  mesesCerrados,
}: {
  clients: ClientOption[];
  services: ServiceOption[];
  taxCodes: TaxCodeOption[];
  facturas: FacturaAbiertaParaNc[];
  /** `?factura=ID` desde el detalle de la factura. */
  facturaInicial: string | null;
  /** Ids de las facturas cuyo mes de registro está cerrado (D4: no se anulan, se acreditan). */
  mesesCerrados: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const inicial = facturas.find((f) => f.id === facturaInicial) ?? null;
  const [clientId, setClientId] = useState<string | null>(inicial?.client_id ?? null);
  const [facturaId, setFacturaId] = useState<string | null>(inicial?.id ?? null);
  const [lines, setLines] = useState<InvoiceLineInput[]>(() => (inicial ? lineasDeLaFactura(inicial) : []));
  const [fecha, setFecha] = useState(() => hoyEnPanama());
  const [reason, setReason] = useState("");
  const [observations, setObservations] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmandoSinFactura, setConfirmandoSinFactura] = useState(false);
  const [envio, setEnvio] = useState<ModoDeEnvio | null>(null);

  const factura = facturas.find((f) => f.id === facturaId) ?? null;
  const facturasDelCliente = useMemo(
    () => (clientId ? facturas.filter((f) => f.client_id === clientId) : []),
    [facturas, clientId]
  );
  const tasas = useMemo(
    () => new Map<string, TasaDelCatalogo>(taxCodes.map((t) => [t.id, { code: t.code, rate: t.rate, active: true }])),
    [taxCodes]
  );

  // Lo que el servidor va a validar, calculado igual acá.
  const pedido: LineaPedidaNc[] = lines.map((ln) => ({
    invoice_line_id: ln.id ?? null,
    quantity: Number(ln.quantity),
    service_id: ln.service_id,
    description: ln.description,
    unit_price: Number(ln.unit_price),
    tax_code_id: ln.tax_code_id || null,
  }));
  const validacion = useMemo(
    () =>
      lines.length === 0
        ? null
        : validarLineasDeNotaDeCredito({
            factura: factura ? { invoice_number: factura.invoice_number, status: "emitida", balance_due: factura.balance_due } : null,
            facturadas: factura?.lineas ?? [],
            acreditadoPorLinea: new Map((factura?.lineas ?? []).map((l) => [l.id, l.acreditado])),
            pedido,
            tasas,
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, factura, tasas]
  );
  const total =
    validacion && validacion.ok
      ? validacion.total
      : Math.round(lines.reduce((s, l) => s + totalDeLineaDeNc(Number(l.quantity) || 0, Number(l.unit_price) || 0, Number(l.tax_rate) || 0), 0) * 100) / 100;

  // Los errores en vivo, por línea, con las claves del editor de la factura.
  const avisosPorLinea: Record<number, string> = {};
  if (validacion && !validacion.ok && validacion.fieldErrors) {
    for (const [k, v] of Object.entries(validacion.fieldErrors)) {
      const m = /^lineas\.(\d+)\./.exec(k);
      if (m) avisosPorLinea[Number(m[1])] = v;
    }
  }
  const excedeSaldo = validacion && !validacion.ok && validacion.status === 409 ? validacion.mensaje : null;
  const sinFacturaBloqueado = !factura && !PERMITIR_NC_VENTA_SIN_FACTURA;
  const mesCerrado = factura ? mesesCerrados.includes(factura.id) : false;

  function elegirCliente(id: string | null) {
    setClientId(id);
    if (factura && factura.client_id !== id) {
      setFacturaId(null);
      setLines([]);
    }
  }

  function elegirFactura(id: string) {
    const f = facturas.find((x) => x.id === id) ?? null;
    setFacturaId(f?.id ?? null);
    setLines(f ? lineasDeLaFactura(f) : []);
    setErrors({});
  }

  function enviar() {
    setSubmitError(null);
    const e: Record<string, string> = {};
    const r = reason.trim();
    if (!clientId) e.client_id = "Elige el cliente.";
    if (r.length < NC_MOTIVO_MIN || r.length > NC_MOTIVO_MAX) {
      e.reason = `El motivo debe tener entre ${NC_MOTIVO_MIN} y ${NC_MOTIVO_MAX} caracteres.`;
    }
    if (lines.length === 0) e.lines = "Agrega al menos una línea.";
    if (!envio) e.envio = "Elige si se envía a la DGI o queda interna.";
    setErrors(e);
    if (Object.keys(e).length > 0 || !validacion || !validacion.ok || sinFacturaBloqueado) return;

    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/credit-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoice_id: factura?.id ?? null,
            client_id: clientId,
            reason: r,
            observations: observations.trim() || null,
            fecha_registro: fecha,
            lineas: pedido,
            envio,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.fieldErrors) {
            // El servidor habla en `lineas.N.campo`; el editor, en `lines.N.campo`.
            const mapeados: Record<string, string> = {};
            for (const [k, v] of Object.entries(data.fieldErrors as Record<string, string>)) {
              mapeados[k.replace(/^lineas\./, "lines.").replace(/\.invoice_line_id$/, ".description")] = v;
            }
            setErrors(mapeados);
          }
          setSubmitError(data.error ?? "No se pudo emitir la nota de crédito.");
          return;
        }
        // Si eligió la DGI y el envío no terminó bien, la NC igual existe: el
        // detalle lo dice y ofrece reintentar.
        const fallo = data.envio?.envio === "dgi" && data.envio?.fe && !data.envio.fe.ok;
        router.push(`/finanzas/notas-credito/${data.id}?emitida=1${fallo ? "&envio=fallo" : ""}`);
        router.refresh();
      } catch {
        setSubmitError("Error de red. Intenta de nuevo.");
      }
    });
  }

  function onSubmit() {
    if (!factura && PERMITIR_NC_VENTA_SIN_FACTURA && !confirmandoSinFactura) {
      setConfirmandoSinFactura(true);
      return;
    }
    setConfirmandoSinFactura(false);
    enviar();
  }

  const selectClass =
    "block w-full rounded-md border border-gray-300 bg-white px-3 min-h-[44px] text-sm hover:border-integra-navy focus:border-integra-navy focus:outline-none";

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <form
        className="space-y-5"
        onSubmit={(ev) => {
          ev.preventDefault();
          onSubmit();
        }}
      >
        <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-integra-navy">Datos de la nota de crédito</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="mb-1 block">Cliente *</Label>
              <ClientCombobox
                clients={clients}
                value={clientId}
                onChange={(id) => elegirCliente(id)}
                error={errors.client_id}
                disabled={isPending}
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="nc_factura" className="mb-1 block">
                Factura que corrige {PERMITIR_NC_VENTA_SIN_FACTURA ? "(opcional)" : "*"}
              </Label>
              <select
                id="nc_factura"
                value={facturaId ?? ""}
                onChange={(ev) => (ev.target.value ? elegirFactura(ev.target.value) : (setFacturaId(null), setLines([])))}
                disabled={isPending || !clientId}
                className={selectClass}
              >
                <option value="">
                  {!clientId
                    ? "Elige primero el cliente"
                    : facturasDelCliente.length === 0
                      ? "Este cliente no tiene facturas con saldo"
                      : "Sin factura"}
                </option>
                {facturasDelCliente.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.invoice_number} · saldo B/. {fmtImporte(f.balance_due)}
                  </option>
                ))}
              </select>
              {sinFacturaBloqueado && clientId && (
                <p className="mt-1 text-xs text-amber-700">{MENSAJE_NC_VENTA_SIN_FACTURA}</p>
              )}
            </div>

            {mesCerrado && (
              <div role="alert" className="sm:col-span-2 flex items-start gap-2 rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                <p>
                  El mes de esta factura está cerrado: no se anula, se acredita con esta nota de crédito y una fecha
                  de registro en un mes abierto. Para acreditarla completa, deja todas las líneas.
                </p>
              </div>
            )}

            <div className="sm:col-span-2">
              <CampoFechaDeRegistro
                id="nc_fecha_registro"
                value={fecha}
                onChange={setFecha}
                min={factura?.accounting_date}
                disabled={isPending}
                ayuda="La nota de crédito entra al libro con esta fecha. Tiene que caer en un período abierto y no puede ser anterior a la factura."
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="nc_reason" className="mb-1 block">
                Motivo *
              </Label>
              <textarea
                id="nc_reason"
                value={reason}
                onChange={(ev) => setReason(ev.target.value)}
                disabled={isPending}
                rows={3}
                maxLength={NC_MOTIVO_MAX}
                placeholder="Ej: descuento acordado con la clienta, servicio no prestado, error en el monto"
                className={`block w-full rounded-md border px-3 py-2 text-sm focus:border-integra-navy focus:outline-none ${
                  errors.reason ? "border-red-300" : "border-gray-300"
                }`}
              />
              {errors.reason && <p className="mt-1 text-xs text-red-600">{errors.reason}</p>}
            </div>

            <div className="sm:col-span-2">
              <SelectorDeEnvio
                valor={envio}
                onChange={setEnvio}
                disabled={isPending}
                error={errors.envio}
                nombre="nota de crédito"
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="nc_obs" className="mb-1 block">
                Observaciones (opcional)
              </Label>
              <textarea
                id="nc_obs"
                value={observations}
                onChange={(ev) => setObservations(ev.target.value)}
                disabled={isPending}
                rows={2}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-integra-navy focus:outline-none"
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-white p-5 shadow-sm">
          {factura || PERMITIR_NC_VENTA_SIN_FACTURA ? (
            <InvoiceLineItems
              titulo="Líneas de la nota de crédito"
              lines={lines}
              services={services}
              taxCodes={taxCodes}
              invoiceKind={factura?.invoice_kind ?? "HONORARIOS"}
              errors={errors}
              onChange={setLines}
              disabled={isPending}
              avisosPorLinea={avisosPorLinea}
            />
          ) : (
            <p className="text-sm text-gray-500">Elige la factura para cargar sus líneas.</p>
          )}
          {lines.length === 0 && (factura || PERMITIR_NC_VENTA_SIN_FACTURA) && (
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => setLines([makeEmptyLine(taxCodes)])}
              disabled={isPending}
            >
              Agregar la primera línea
            </Button>
          )}
        </section>

        {confirmandoSinFactura && (
          <div role="alertdialog" className="flex flex-wrap items-center justify-between gap-3 rounded-md border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
            <span>No estás asociando esta nota a una factura. ¿Deseas continuar?</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmandoSinFactura(false)}>
                No, elegir una factura
              </Button>
              <Button type="button" onClick={enviar} className="bg-integra-navy text-white">
                Sí, continuar
              </Button>
            </div>
          </div>
        )}

        {submitError && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t bg-gray-50 px-1 py-3">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending} className="min-h-[48px]">
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isPending || sinFacturaBloqueado || !validacion || !validacion.ok}
            className="min-h-[48px] bg-integra-navy text-white hover:bg-integra-navy/90"
          >
            {isPending ? <Loader2 size={16} className="mr-2 animate-spin" /> : <FileMinus size={16} className="mr-2" />}
            {isPending ? "Emitiendo…" : "Emitir la nota de crédito"}
          </Button>
        </div>
      </form>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className={`rounded-lg border bg-white p-4 ${excedeSaldo ? "border-red-200" : ""}`}>
          <p className="text-xs uppercase tracking-wider text-gray-500">Total de la nota de crédito</p>
          <p className={`mt-1 font-mono text-2xl font-bold ${excedeSaldo ? "text-red-700" : "text-integra-navy"}`}>
            B/. {fmtImporte(total)}
          </p>
          {factura && (
            <p className="mt-2 text-xs text-gray-600">
              Saldo de {factura.invoice_number}: <span className="font-mono">B/. {fmtImporte(factura.balance_due)}</span>
            </p>
          )}
          {excedeSaldo && <p role="alert" className="mt-2 text-xs text-red-600">{excedeSaldo}</p>}
        </div>
        <div className="rounded-lg border bg-white p-4 text-xs text-gray-500">
          <p className="mb-1 font-semibold text-gray-700">Sobre la nota de crédito</p>
          <p>
            Se numera <span className="font-mono">NC-</span>, lleva como fecha del documento la de hoy y queda como
            documento interno hasta que se envía a la DGI desde su detalle.
          </p>
        </div>
      </aside>
    </div>
  );
}

/** Las líneas de la factura como valor INICIAL: lo que queda por acreditar de cada una. */
function lineasDeLaFactura(f: FacturaAbiertaParaNc): InvoiceLineInput[] {
  return f.lineas
    .map((l) => ({ l, disponible: Math.round((l.quantity - l.acreditado) * 100) / 100 }))
    .filter((x) => x.disponible > 0.0001)
    .map(({ l, disponible }) => ({
      _key: `nc-${l.id}`,
      // El `id` de la línea del editor es la línea de la FACTURA que se acredita.
      id: l.id,
      service_id: l.service_id,
      description: l.description,
      quantity: disponible,
      unit_price: l.unit_price,
      tax_code_id: l.tax_code_id ?? "",
      tax_code: l.tax_code,
      tax_rate: l.tax_rate,
    }));
}
