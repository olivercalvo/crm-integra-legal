"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Save, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientCombobox } from "@/components/finanzas/client-combobox";
import { CampoFechaDeRegistro } from "@/components/finanzas/campo-fecha-de-registro";
import { InvoiceLineItems, makeEmptyLine } from "@/app/finanzas/facturas/_components/invoice-line-items";
import {
  compararCufeConFactura,
  leerCufe,
  NOMBRE_DE_PUNTO,
  normalizarPunto,
} from "@/lib/finanzas/efactura/cufe/leer-cufe";
import { totalesDeLineas, validarPedidoDeFacturaExterna } from "@/lib/finanzas/validators/factura-externa";
import type { ValidationErrors } from "@/lib/finanzas/validators/invoice";
import type { ClientOption, InvoiceLineInput, ServiceOption, TaxCodeOption } from "@/lib/finanzas/types/invoice";
import { fmtImporte } from "@/lib/utils/importe";

type Kind = "HONORARIOS" | "REEMBOLSO";

interface Props {
  clients: ClientOption[];
  services: ServiceOption[];
  taxCodes: TaxCodeOption[];
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const SELECT_CLASS =
  "block w-full rounded-md border px-3 min-h-[48px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none";

/**
 * «Registrar factura emitida fuera» (092). Se cargan los datos del documento
 * que la DGI ya autorizó y se pega su CUFE. La pantalla lee el CUFE mientras se
 * escribe y marca, campo por campo, si coincide con lo cargado. Los datos NO se
 * completan desde el CUFE a propósito: copiarlos de ahí haría que el control
 * no detecte el caso que existe para detectar (el CUFE de otra factura).
 */
export function FacturaExternaForm({ clients, services, taxCodes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [cufe, setCufe] = useState("");
  const [kind, setKind] = useState<Kind>("HONORARIOS");
  const [issueDate, setIssueDate] = useState("");
  const [punto, setPunto] = useState("");
  const [numero, setNumero] = useState("");
  const [base, setBase] = useState("");
  const [itbms, setItbms] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [accountingDate, setAccountingDate] = useState("");
  const [registroElegido, setRegistroElegido] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<InvoiceLineInput[]>(() => [makeEmptyLine(taxCodes)]);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // La fecha de registro sigue a la del documento hasta que alguien la elige.
  useEffect(() => {
    if (!registroElegido) setAccountingDate(issueDate);
  }, [issueDate, registroElegido]);

  // El vencimiento: fecha del documento + plazo del cliente (30 si no tiene).
  useEffect(() => {
    if (!issueDate) return;
    const c = clients.find((x) => x.id === clientId);
    setDueDate(addDays(issueDate, c?.default_payment_terms_days ?? 30));
  }, [issueDate, clientId, clients]);

  const lectura = useMemo(() => (cufe.trim() ? leerCufe(cufe) : null), [cufe]);
  const desacuerdos = useMemo(() => {
    if (!lectura?.ok) return null;
    return compararCufeConFactura(lectura.leido, {
      invoice_kind: kind,
      issue_date: issueDate,
      punto: normalizarPunto(punto),
      numero_documento: /^\d+$/.test(numero.trim()) ? Number(numero.trim()) : null,
    });
  }, [lectura, kind, issueDate, punto, numero]);

  const totales = totalesDeLineas(lines);

  function payload() {
    return {
      invoice_kind: kind,
      client_id: clientId ?? "",
      case_id: null,
      issue_date: issueDate,
      accounting_date: accountingDate,
      due_date: dueDate,
      notes: notes.trim() || null,
      cufe,
      punto,
      numero_documento: numero,
      base_autorizada: base,
      itbms_autorizado: itbms,
      lines: lines.map((ln) => ({
        service_id: ln.service_id,
        description: ln.description.trim(),
        quantity: ln.quantity,
        unit_price: ln.unit_price,
        tax_code_id: ln.tax_code_id,
        tax_code: ln.tax_code,
        tax_rate: ln.tax_rate,
      })),
    };
  }

  function handleSubmit() {
    setSubmitError(null);
    const body = payload();
    const v = validarPedidoDeFacturaExterna(body);
    if (!v.ok) {
      setErrors(v.errors);
      setSubmitError(Object.values(v.errors)[0] ?? "Revisa los datos marcados.");
      requestAnimationFrame(() =>
        document.querySelector("[data-error='true']")?.scrollIntoView({ behavior: "smooth", block: "center" })
      );
      return;
    }
    setErrors({});
    startTransition(async () => {
      try {
        const res = await fetch("/api/finanzas/facturas-externas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.fieldErrors) setErrors(data.fieldErrors);
          setSubmitError(data.error ?? "No se pudo registrar la factura.");
          return;
        }
        router.push(`/finanzas/facturas/${data.id}?saved=1`);
        router.refresh();
      } catch {
        setSubmitError("Error de red al guardar. Intenta de nuevo.");
      }
    });
  }

  /** ✓ / ✗ junto a un campo que se compara con el CUFE. */
  function Marca({ campo }: { campo: string }) {
    if (!desacuerdos) return null;
    return desacuerdos[campo] ? (
      <XCircle size={16} className="text-red-600" aria-label="No coincide con el CUFE" />
    ) : (
      <CheckCircle2 size={16} className="text-green-600" aria-label="Coincide con el CUFE" />
    );
  }

  function ErrorDe({ campo }: { campo: string }) {
    const m = errors[campo] ?? desacuerdos?.[campo];
    return m ? <p className="mt-1 text-xs text-red-600">{m}</p> : null;
  }

  const baseNum = Number(base.replace(",", "."));
  const itbmsNum = Number(itbms.replace(",", "."));
  const montosCoinciden =
    base.trim() !== "" && itbms.trim() !== "" && totales.base === baseNum && totales.itbms === itbmsNum;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-integra-navy">Documento autorizado por la DGI</h2>
          <p className="text-sm text-gray-600">
            Copia los datos del documento tal como figuran en el facturador o en su PDF, y pega su CUFE. El CRM
            lee el CUFE y no deja guardar si el tipo, la fecha, el punto o el número no coinciden.
          </p>

          <div data-error={!!(errors.cufe || desacuerdos?.cufe)}>
            <Label htmlFor="cufe" className="mb-1 block">
              CUFE *
            </Label>
            <textarea
              id="cufe"
              value={cufe}
              onChange={(e) => setCufe(e.target.value)}
              disabled={isPending}
              rows={2}
              spellCheck={false}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
              placeholder="FE01200000…"
            />
            {lectura && !lectura.ok && <p className="mt-1 text-xs text-red-600">{lectura.mensaje}</p>}
            {lectura?.ok && (
              <p className="mt-1 text-xs text-gray-600">
                El CUFE dice: tipo {lectura.leido.tipo}, del {fechaCorta(lectura.leido.fecha)}, punto{" "}
                {lectura.leido.punto}
                {NOMBRE_DE_PUNTO[lectura.leido.punto] ? ` (${NOMBRE_DE_PUNTO[lectura.leido.punto]})` : ""}, documento
                n.º {lectura.leido.numero}.
              </p>
            )}
            <ErrorDe campo="cufe" />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div data-error={!!errors.invoice_kind}>
              <Label htmlFor="invoice_kind" className="mb-1 flex items-center gap-2">
                Tipo de documento * <Marca campo="invoice_kind" />
              </Label>
              <select
                id="invoice_kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                disabled={isPending}
                className={SELECT_CLASS + " border-gray-300"}
              >
                <option value="HONORARIOS">Factura de honorarios (tipo 01)</option>
                <option value="REEMBOLSO">Factura de reembolso (tipo 09)</option>
              </select>
              <ErrorDe campo="invoice_kind" />
            </div>

            <div data-error={!!errors.issue_date}>
              <Label htmlFor="issue_date" className="mb-1 flex items-center gap-2">
                Fecha del documento * <Marca campo="issue_date" />
              </Label>
              <Input
                id="issue_date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                disabled={isPending}
                className="min-h-[48px]"
              />
              <ErrorDe campo="issue_date" />
            </div>

            <div data-error={!!errors.punto}>
              <Label htmlFor="punto" className="mb-1 flex items-center gap-2">
                Punto de facturación * <Marca campo="punto" />
              </Label>
              <Input
                id="punto"
                inputMode="numeric"
                value={punto}
                onChange={(e) => setPunto(e.target.value)}
                disabled={isPending}
                placeholder="100"
                className="min-h-[48px]"
              />
              <ErrorDe campo="punto" />
            </div>

            <div data-error={!!errors.numero_documento}>
              <Label htmlFor="numero_documento" className="mb-1 flex items-center gap-2">
                Número del documento * <Marca campo="numero_documento" />
              </Label>
              <Input
                id="numero_documento"
                inputMode="numeric"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                disabled={isPending}
                placeholder="2"
                className="min-h-[48px]"
              />
              <ErrorDe campo="numero_documento" />
            </div>

            <div data-error={!!errors.base_autorizada}>
              <Label htmlFor="base_autorizada" className="mb-1 block">
                Monto sin ITBMS *
              </Label>
              <Input
                id="base_autorizada"
                inputMode="decimal"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                disabled={isPending}
                placeholder="150.00"
                className="min-h-[48px]"
              />
              <ErrorDe campo="base_autorizada" />
            </div>

            <div data-error={!!errors.itbms_autorizado}>
              <Label htmlFor="itbms_autorizado" className="mb-1 block">
                ITBMS *
              </Label>
              <Input
                id="itbms_autorizado"
                inputMode="decimal"
                value={itbms}
                onChange={(e) => setItbms(e.target.value)}
                disabled={isPending}
                placeholder="10.50"
                className="min-h-[48px]"
              />
              <ErrorDe campo="itbms_autorizado" />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            El CUFE no trae el monto: las líneas de abajo tienen que dar exactamente el monto y el ITBMS del
            documento autorizado.
          </p>
        </section>

        <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-integra-navy">Registro en el CRM</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2" data-error={!!errors.client_id}>
              <Label className="mb-1 block">Cliente *</Label>
              <ClientCombobox
                clients={clients}
                value={clientId}
                onChange={(id) => setClientId(id)}
                error={errors.client_id}
                disabled={isPending}
              />
            </div>

            <div data-error={!!errors.accounting_date}>
              <CampoFechaDeRegistro
                id="accounting_date"
                value={accountingDate}
                onChange={(v) => {
                  setAccountingDate(v);
                  setRegistroElegido(true);
                }}
                error={errors.accounting_date}
                disabled={isPending}
                ayuda="Por defecto es la fecha del documento, para que el ITBMS del CRM caiga en el mismo mes que ante la DGI. Tiene que ser un período abierto."
              />
            </div>

            <div data-error={!!errors.due_date}>
              <Label htmlFor="due_date" className="mb-1 block">
                Vence el *
              </Label>
              <Input
                id="due_date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={isPending}
                className="min-h-[48px]"
              />
              <ErrorDe campo="due_date" />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="notes" className="mb-1 block">
                Nota (opcional)
              </Label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isPending}
                rows={2}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
                placeholder="Por ejemplo: reemplaza a FAC-HON-000467"
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <InvoiceLineItems
            lines={lines}
            services={services}
            taxCodes={taxCodes}
            invoiceKind={kind}
            errors={errors}
            onChange={setLines}
            disabled={isPending}
          />
        </section>

        {submitError && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">No se registró la factura</p>
              <p className="mt-1">{submitError}</p>
            </div>
          </div>
        )}

        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t bg-gray-50 px-1 py-3">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending} className="min-h-[48px]">
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            className="min-h-[48px] bg-integra-navy text-white hover:bg-integra-navy/90"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" /> Registrando…
              </>
            ) : (
              <>
                <Save size={16} className="mr-2" /> Registrar factura
              </>
            )}
          </Button>
        </div>
      </form>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-xl border bg-white p-4 text-sm shadow-sm">
          <p className="mb-2 font-semibold text-integra-navy">Las líneas dan</p>
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt className="text-gray-500">Monto sin ITBMS</dt>
              <dd className="font-mono">B/. {fmtImporte(totales.base)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">ITBMS</dt>
              <dd className="font-mono">B/. {fmtImporte(totales.itbms)}</dd>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <dt>Total</dt>
              <dd className="font-mono">B/. {fmtImporte(totales.total)}</dd>
            </div>
          </dl>
          {base.trim() !== "" && itbms.trim() !== "" && (
            <p className={`mt-3 flex items-center gap-1 text-xs ${montosCoinciden ? "text-green-700" : "text-red-600"}`}>
              {montosCoinciden ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {montosCoinciden ? "Coincide con el documento autorizado." : "No coincide con el documento autorizado."}
            </p>
          )}
        </div>
        <div className="rounded-lg border bg-white p-4 text-xs text-gray-500">
          <p className="mb-1 font-semibold text-gray-700">Qué hace el CRM con esta factura</p>
          <p>
            La registra con un número propio <span className="font-mono">FAC-EXT-…</span>: entra al libro, a las
            ventas, al ITBMS y a las cuentas por cobrar. No la envía a la DGI y no usa la numeración del CRM ante la
            DGI (punto 051).
          </p>
        </div>
      </aside>
    </div>
  );
}
