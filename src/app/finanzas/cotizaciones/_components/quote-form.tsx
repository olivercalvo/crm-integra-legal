"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, AlertCircle, FileText, MessageSquare, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CaseCombobox } from "@/components/finanzas/case-combobox";
import { ObservationTemplateCombobox } from "@/components/finanzas/observation-template-combobox";
import {
  ClientSelectorToggle,
  type ClientSelectorValue,
} from "./client-selector-toggle";
import {
  QuoteLinesEditor,
  makeEmptyQuoteLine,
  type QuoteLineEditorInput,
} from "./quote-lines-editor";
import { QuoteTotalsCard } from "./quote-totals-card";
import type {
  ClientOption,
  CaseOption,
  ServiceOption,
  TaxCodeOption,
} from "@/lib/finanzas/types/invoice";
import {
  QUOTE_TITLE_MIN,
  QUOTE_TITLE_MAX,
  QUOTE_OBSERVATIONS_MAX,
  type CreateQuoteInput,
  type NewQuoteLineInput,
  type NewProspectInput,
} from "@/lib/finanzas/types/quote";
import type { ObservationTemplate } from "@/lib/finanzas/types/observation-template";

type ValidationErrors = Record<string, string>;

interface BaseProps {
  clients: ClientOption[];
  casesByClient: Record<string, CaseOption[]>;
  services: ServiceOption[];
  taxCodes: TaxCodeOption[];
  /** Plantilla T&C del tenant — se pre-puebla en el textarea al crear. */
  defaultTerms: string;
  /** Plantillas activas de observaciones (Sprint QUOTES-POLISH, D5/D11). */
  observationTemplates: ObservationTemplate[];
}

interface CreateProps extends BaseProps {
  mode: "create";
  initial?: undefined;
}

interface EditProps extends BaseProps {
  mode: "edit";
  initial: {
    id: string;
    client_id: string;
    case_id: string | null;
    issue_date: string;
    valid_until: string;
    title: string;
    notes: string | null;
    observations: string | null;
    terms_and_conditions: string;
    lines: QuoteLineEditorInput[];
  };
  /**
   * Si la cotización fue creada por "Duplicar", info del origen para
   * renderizar el banner amarillo. Cuando viene, también se habilita el
   * dropdown de cliente (la abogada necesita poder cambiarlo).
   *
   * El banner se oculta automáticamente cuando la abogada selecciona un
   * cliente distinto al del origen (sourceClientId).
   */
  source?: {
    quote_number: string;
    client_id: string;
  } | null;
}

type Props = CreateProps | EditProps;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Form de cotización — crear (mode='create') y editar (mode='edit'). Mismo
 * patrón que InvoiceForm pero con:
 *   - ClientSelectorToggle (D1) en lugar de un solo combobox.
 *   - QuoteLinesEditor con columna HON/REI por línea (D2).
 *   - Campo Vence obligatorio sin default.
 *   - Textarea de T&C inicializado desde la plantilla del tenant.
 *
 * Validación client-side liviana para defensa en profundidad — la verdad
 * vive en validateCreateQuote / validateUpdateQuote server-side.
 */
export function QuoteForm(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ---- Cliente ------------------------------------------------------------
  const [clientSelector, setClientSelector] = useState<ClientSelectorValue>(() =>
    props.mode === "edit"
      ? { mode: "existing", client_id: props.initial.client_id }
      : { mode: "existing", client_id: undefined }
  );

  // ---- Caso ---------------------------------------------------------------
  const [caseId, setCaseId] = useState<string | null>(
    props.mode === "edit" ? props.initial.case_id : null
  );

  // ---- Fechas -------------------------------------------------------------
  const [issueDate, setIssueDate] = useState<string>(
    props.mode === "edit" ? props.initial.issue_date : todayIso()
  );
  // Default razonable: 30 días desde hoy. El usuario puede cambiarlo.
  const [validUntil, setValidUntil] = useState<string>(
    props.mode === "edit"
      ? props.initial.valid_until
      : addDays(todayIso(), 30)
  );

  // ---- Título (Sprint 2E.3.2) --------------------------------------------
  const [title, setTitle] = useState<string>(
    props.mode === "edit" ? props.initial.title ?? "" : ""
  );

  // ---- Notas / Observaciones / T&C ----------------------------------------
  const [notes, setNotes] = useState<string>(
    props.mode === "edit" ? props.initial.notes ?? "" : ""
  );
  const [observations, setObservations] = useState<string>(
    props.mode === "edit" ? props.initial.observations ?? "" : ""
  );
  const [terms, setTerms] = useState<string>(
    props.mode === "edit" ? props.initial.terms_and_conditions : props.defaultTerms
  );

  /**
   * Anexa el content de una plantilla al textarea de observaciones (D11).
   *   - Si el textarea está vacío → lo asigna directo.
   *   - Si ya hay texto → anexa con doble salto de línea como separador.
   */
  function insertObservationTemplate(content: string) {
    setObservations((current) => {
      const trimmedCurrent = current.trim();
      if (trimmedCurrent.length === 0) return content;
      return `${trimmedCurrent}\n\n${content}`;
    });
    // Limpiar error de longitud si el usuario estaba en el borde — se
    // re-valida al submit. Si la nueva inserción excede 2000, el server
    // rebota igual; mostramos el counter en rojo para feedback inmediato.
    setErrors((prev) => {
      if (!prev.observations) return prev;
      const rest = { ...prev };
      delete rest.observations;
      return rest;
    });
  }

  // ---- Líneas -------------------------------------------------------------
  const [lines, setLines] = useState<QuoteLineEditorInput[]>(() =>
    props.mode === "edit" ? props.initial.lines : [makeEmptyQuoteLine(props.taxCodes)]
  );

  // ---- Errors / submit ----------------------------------------------------
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Si el cliente cambia y el caso seleccionado no pertenece al nuevo
  // cliente, limpiar selección de caso.
  const effectiveClientId =
    clientSelector.mode === "existing" ? clientSelector.client_id ?? null : null;
  useEffect(() => {
    if (caseId && effectiveClientId) {
      const cases = props.casesByClient[effectiveClientId] ?? [];
      if (!cases.some((c) => c.id === caseId)) {
        setCaseId(null);
      }
    } else if (!effectiveClientId) {
      // Sin cliente existente (o creando prospect), no hay caso posible aún.
      setCaseId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveClientId]);

  const availableCases = effectiveClientId
    ? props.casesByClient[effectiveClientId] ?? []
    : [];

  // ---- Validación client-side liviana -------------------------------------
  function validateClientSide(): ValidationErrors {
    const e: ValidationErrors = {};

    if (clientSelector.mode === "existing") {
      if (!clientSelector.client_id) {
        e.client_id = "Selecciona un cliente";
      }
    } else {
      const p = clientSelector.new_prospect;
      if (!p?.name || p.name.trim().length < 2) {
        e["new_prospect.name"] = "Nombre del cliente requerido";
      }
      if (!p?.email) {
        e["new_prospect.email"] = "Email del cliente requerido";
      } else if (!EMAIL_RE.test(p.email.trim())) {
        e["new_prospect.email"] = "Email inválido";
      }
      if (!p?.client_type) {
        e["new_prospect.client_type"] = "Tipo de persona requerido";
      }
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      e.title = "Título requerido";
    } else if (trimmedTitle.length < QUOTE_TITLE_MIN) {
      e.title = `Título mínimo ${QUOTE_TITLE_MIN} caracteres`;
    } else if (trimmedTitle.length > QUOTE_TITLE_MAX) {
      e.title = `Título máximo ${QUOTE_TITLE_MAX} caracteres`;
    }

    if (!issueDate) e.issue_date = "Fecha de emisión requerida";
    if (!validUntil) {
      e.valid_until = "Fecha de validez requerida";
    } else if (issueDate && validUntil < issueDate) {
      e.valid_until = "La fecha de validez no puede ser anterior a la emisión";
    }

    if (observations.trim().length > QUOTE_OBSERVATIONS_MAX) {
      e.observations = `Observaciones máximo ${QUOTE_OBSERVATIONS_MAX} caracteres`;
    }

    if (lines.length === 0) {
      e.lines = "Agrega al menos una línea";
    } else {
      lines.forEach((ln, idx) => {
        if (!ln.description?.trim()) {
          e[`lines.${idx}.description`] = "Descripción requerida";
        }
        if (!isFinite(ln.quantity) || ln.quantity <= 0) {
          e[`lines.${idx}.quantity`] = "Cantidad debe ser mayor a 0";
        }
        if (!isFinite(ln.unit_price) || ln.unit_price < 0) {
          e[`lines.${idx}.unit_price`] = "Precio no puede ser negativo";
        }
        if (!ln.tax_code_id) {
          e[`lines.${idx}.tax_code_id`] = "Impuesto requerido";
        }
      });
    }

    return e;
  }

  async function handleSubmit() {
    setSubmitError(null);

    const clientErrors = validateClientSide();
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      requestAnimationFrame(() => {
        document.querySelector("[data-error='true']")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
      return;
    }
    setErrors({});

    // Armar payload server-shape.
    const linesPayload: NewQuoteLineInput[] = lines.map((ln) => ({
      invoice_kind: ln.invoice_kind,
      description: ln.description.trim(),
      quantity: ln.quantity,
      unit_price: ln.unit_price,
      tax_rate: ln.tax_rate,
      tax_code: ln.tax_code,
      service_id: ln.service_id ?? null,
      tax_code_id: ln.tax_code_id ?? null,
    }));

    let newProspect: NewProspectInput | undefined;
    let clientId: string | undefined;
    if (clientSelector.mode === "new") {
      newProspect = clientSelector.new_prospect;
    } else {
      clientId = clientSelector.client_id;
    }

    const createBody: CreateQuoteInput = {
      client_id: clientId,
      new_prospect: newProspect,
      case_id: caseId ?? null,
      issue_date: issueDate,
      valid_until: validUntil,
      title: title.trim(),
      notes: notes.trim() || null,
      observations: observations.trim() || null,
      terms_and_conditions: terms.trim() || null,
      lines: linesPayload,
    };

    startTransition(async () => {
      try {
        const url =
          props.mode === "create"
            ? "/api/finanzas/quotes"
            : `/api/finanzas/quotes/${props.initial.id}`;
        const method = props.mode === "create" ? "POST" : "PATCH";

        // En edición soportamos los dos modos del toggle, igual que en create.
        // Bugfix: al duplicar una cotización y cambiar a "Crear prospecto
        // nuevo", el PATCH ignoraba ese modo y conservaba el client_id
        // heredado. Ahora replicamos la rama XOR: si mode === "new" mandamos
        // new_prospect y NO client_id; si "existing" mandamos client_id y NO
        // new_prospect. El handler valida exclusión mutua server-side.
        const body =
          props.mode === "create"
            ? createBody
            : {
                ...(clientSelector.mode === "new"
                  ? { new_prospect: newProspect }
                  : { client_id: clientId }),
                case_id: caseId ?? null,
                issue_date: issueDate,
                valid_until: validUntil,
                title: title.trim(),
                notes: notes.trim() || null,
                observations: observations.trim() || null,
                terms_and_conditions: terms.trim() || null,
                lines: linesPayload,
              };

        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.fieldErrors) {
            setErrors(data.fieldErrors);
          }
          setSubmitError(data.error ?? "Error al guardar");
          return;
        }

        const id = data.id ?? (props.mode === "edit" ? props.initial.id : null);
        if (id) {
          // En create pasamos el quote_number como valor del param para que
          // el toast pueda mostrar "Cotización emitida con número COT-..."
          // (hot-fix QUOTES-FLOW). En edit basta con saved=1.
          const successQuery =
            props.mode === "create"
              ? `created=${encodeURIComponent(data.quote_number ?? "1")}`
              : "saved=1";
          router.push(`/finanzas/cotizaciones/${id}?${successQuery}`);
          router.refresh();
        }
      } catch (err) {
        console.error(err);
        setSubmitError("Error de red al guardar. Intenta de nuevo.");
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        {/* Cabecera */}
        <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-integra-navy">Datos de la cotización</h2>

          {/* Banner amarillo — solo para cotizaciones duplicadas que todavía
              conservan el cliente del origen (Sprint 2E.4). Se oculta cuando
              la abogada cambia el cliente a uno distinto. */}
          {props.mode === "edit" &&
            props.source &&
            clientSelector.mode === "existing" &&
            clientSelector.client_id === props.source.client_id && (
              <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                <Copy size={18} className="mt-0.5 shrink-0 text-amber-700" />
                <div className="text-sm">
                  <p className="font-medium text-amber-900">
                    Cotización duplicada de{" "}
                    <span className="font-mono">{props.source.quote_number}</span>
                  </p>
                  <p className="mt-0.5 text-amber-800">
                    Verifica el cliente y las fechas antes de emitir.
                  </p>
                </div>
              </div>
            )}

          {/* Cliente — toggle existente/nuevo (D1) */}
          <ClientSelectorToggle
            clients={props.clients}
            initialMode={clientSelector.mode}
            initialClientId={clientSelector.client_id ?? null}
            errors={errors}
            onChange={setClientSelector}
            disabled={
              isPending ||
              (props.mode === "edit" && !props.source)
            }
          />
          {props.mode === "edit" && !props.source && (
            <p className="text-xs text-gray-500">
              El cliente no se puede cambiar desde el editor. Para
              cambiarlo, cancela la cotización y crea una nueva.
            </p>
          )}

          {/* Título (Sprint 2E.3.2) — obligatorio, 3-100 chars */}
          <div data-error={!!errors.title}>
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="quote-title" className="mb-1 block">
                Título de la cotización{" "}
                <span className="text-red-600" aria-hidden="true">
                  *
                </span>
              </Label>
              <span
                className={`text-[11px] font-mono ${
                  title.trim().length > QUOTE_TITLE_MAX
                    ? "text-red-600"
                    : "text-gray-400"
                }`}
                aria-live="polite"
              >
                {title.length}/{QUOTE_TITLE_MAX}
              </span>
            </div>
            <Input
              id="quote-title"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) {
                  setErrors((prev) => {
                    const rest = { ...prev };
                    delete rest.title;
                    return rest;
                  });
                }
              }}
              maxLength={QUOTE_TITLE_MAX + 20 /* permite paste y truncar visual */}
              disabled={isPending}
              placeholder="Ej: Naturalización Adrian Fu - 1ra cotización"
              className={errors.title ? "border-red-300" : ""}
            />
            {errors.title ? (
              <p className="mt-1 text-xs text-red-600">{errors.title}</p>
            ) : (
              <p className="mt-1 text-xs text-gray-500">
                Descripción breve que ayuda a identificar esta cotización en
                el listado ({QUOTE_TITLE_MIN}-{QUOTE_TITLE_MAX} caracteres).
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Caso */}
            {effectiveClientId && availableCases.length > 0 && (
              <div className="sm:col-span-2" data-error={!!errors.case_id}>
                <Label className="mb-1 block">Caso asociado (opcional)</Label>
                <CaseCombobox
                  cases={availableCases}
                  value={caseId}
                  onChange={(id) => setCaseId(id)}
                  error={errors.case_id}
                  disabled={isPending}
                />
              </div>
            )}

            <div data-error={!!errors.issue_date}>
              <Label className="mb-1 block">Fecha de emisión *</Label>
              <Input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                disabled={isPending}
                className={errors.issue_date ? "border-red-300" : ""}
              />
              {errors.issue_date && (
                <p className="mt-1 text-xs text-red-600">{errors.issue_date}</p>
              )}
            </div>

            <div data-error={!!errors.valid_until}>
              <Label className="mb-1 block">Vence el *</Label>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                disabled={isPending}
                className={errors.valid_until ? "border-red-300" : ""}
              />
              {errors.valid_until && (
                <p className="mt-1 text-xs text-red-600">{errors.valid_until}</p>
              )}
            </div>

            {/* Notas internas */}
            <div className="sm:col-span-2">
              <Label className="mb-1 block">Notas internas (opcional)</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isPending}
                rows={3}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none"
                placeholder="Notas internas (solo visibles para el equipo)…"
              />
            </div>
          </div>
        </section>

        {/* Líneas */}
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <QuoteLinesEditor
            lines={lines}
            services={props.services}
            taxCodes={props.taxCodes}
            errors={errors}
            onChange={setLines}
            disabled={isPending}
          />
        </section>

        {/* Observaciones al cliente (Sprint QUOTES-POLISH, D5) */}
        <section
          className="rounded-xl border bg-white p-5 shadow-sm"
          data-error={!!errors.observations}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className="text-integra-gold" />
              <h2 className="text-base font-semibold text-integra-navy">
                Observaciones al cliente
              </h2>
            </div>
            <ObservationTemplateCombobox
              templates={props.observationTemplates}
              onInsert={insertObservationTemplate}
              disabled={isPending}
            />
          </div>
          <p className="mb-2 text-xs text-gray-500">
            Texto opcional que aparece en el PDF de la cotización, debajo de
            los totales. Útil para forma de pago, vigencia o aclaraciones
            puntuales. Puedes combinar varias plantillas.
          </p>
          <textarea
            value={observations}
            onChange={(e) => {
              setObservations(e.target.value);
              if (errors.observations) {
                setErrors((prev) => {
                  const rest = { ...prev };
                  delete rest.observations;
                  return rest;
                });
              }
            }}
            disabled={isPending}
            rows={5}
            maxLength={QUOTE_OBSERVATIONS_MAX + 20 /* permite paste y truncar visualmente */}
            className={`block w-full rounded-md border px-3 py-2 text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none ${
              errors.observations ? "border-red-300" : "border-gray-300"
            }`}
            placeholder="Ej: Los honorarios se pagan 50% al firmar el contrato y 50% al entregar el resultado final."
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            {errors.observations ? (
              <p className="text-xs text-red-600">{errors.observations}</p>
            ) : (
              <span aria-hidden="true" />
            )}
            <span
              className={`text-[11px] font-mono ${
                observations.trim().length > QUOTE_OBSERVATIONS_MAX
                  ? "text-red-600"
                  : "text-gray-400"
              }`}
              aria-live="polite"
            >
              {observations.length.toLocaleString("es-PA")}/
              {QUOTE_OBSERVATIONS_MAX.toLocaleString("es-PA")}
            </span>
          </div>
        </section>

        {/* Términos y Condiciones */}
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <FileText size={16} className="text-integra-gold" />
            <h2 className="text-base font-semibold text-integra-navy">
              Términos y Condiciones
            </h2>
          </div>
          <p className="mb-3 text-xs text-gray-500">
            Se carga automáticamente desde la plantilla del bufete. Puedes
            ajustarla para esta cotización si es necesario.
          </p>
          <textarea
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            disabled={isPending}
            rows={10}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none font-mono"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            {terms.length.toLocaleString("es-PA")} caracteres
          </p>
        </section>

        {/* Submit error */}
        {submitError && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">No se pudo guardar la cotización</p>
              <p className="mt-1">{submitError}</p>
            </div>
          </div>
        )}

        {/* Acciones */}
        <div className="flex flex-wrap items-center justify-end gap-3 sticky bottom-0 bg-gray-50 -mx-1 px-1 py-3 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isPending}
            className="min-h-[48px]"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            className="bg-integra-navy hover:bg-integra-navy/90 text-white min-h-[48px]"
          >
            {isPending ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Guardando…
              </>
            ) : (
              <>
                <Save size={16} className="mr-2" />
                {props.mode === "create" ? "Guardar cotización" : "Guardar cambios"}
              </>
            )}
          </Button>
        </div>
      </form>

      {/* Sidebar derecha: totales */}
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <QuoteTotalsCard lines={lines} />
        <div className="rounded-lg border bg-white p-4 text-xs text-gray-500">
          <p className="font-semibold text-gray-700 mb-1">Sobre la numeración</p>
          <p>
            Las cotizaciones reciben un número{" "}
            <span className="font-mono">COT-NNNNNN</span> al guardar. La
            numeración es definitiva — no cambia al enviar ni al convertir
            a facturas.
          </p>
        </div>
      </aside>
    </div>
  );
}
