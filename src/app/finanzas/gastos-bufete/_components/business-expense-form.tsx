"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Save, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  validateCreateBusinessExpense,
  type ValidationErrors,
} from "@/lib/finanzas/validators/business-expense";
import {
  BUSINESS_EXPENSE_STATUS_LABEL,
  BUSINESS_EXPENSE_PAYMENT_METHOD_LABEL,
  computeTotal,
  type BusinessExpenseStatus,
  type BusinessExpensePaymentMethod,
  type BusinessExpenseTaxRate,
  type CreateBusinessExpenseInput,
} from "@/lib/finanzas/types/business-expense";
import type { ExpenseAccountOption } from "@/lib/finanzas/queries/business-expenses";
import type { SupplierOption } from "@/lib/finanzas/queries/suppliers";
import { ExpenseLinesEditor } from "@/components/finanzas/expense-lines-editor";
import type { ExpenseLineDraft } from "@/lib/finanzas/types/expense-line";
import { paymentTermsLabel, vencimientoPorPlazo } from "@/lib/finanzas/types/supplier";

interface BaseProps {
  accounts: ExpenseAccountOption[];
  suppliers: SupplierOption[];
}

interface CreateProps extends BaseProps {
  mode: "create";
  initial?: undefined;
}

interface EditProps extends BaseProps {
  mode: "edit";
  initial: CreateBusinessExpenseInput & { id: string };
}

type Props = CreateProps | EditProps;

const STATUSES: BusinessExpenseStatus[] = ["pendiente_pago", "pagado"];
const PAYMENT_METHODS: BusinessExpensePaymentMethod[] = [
  "efectivo",
  "transferencia",
  "tarjeta",
  "cheque",
  "otro",
];

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Form de gasto del bufete — usado para crear (mode='create') y editar
 * (mode='edit'). Validación manual con setState + setError, mismo patrón que
 * InvoiceForm.
 *
 * Comportamiento del auto-cálculo del ITBMS:
 *   - Por defecto, tax_amount = round(subtotal * tax_rate, 2).
 *   - Si el usuario edita manualmente el campo, marcamos manualOverride=true
 *     y dejamos de auto-recalcular hasta que el usuario clickee "Recalcular"
 *     o reinicie el form. Esto permite ingresar el ITBMS exacto del
 *     comprobante cuando el redondeo del proveedor no coincide con el cálculo.
 *
 * Comportamiento de campos por status:
 *   - Si status='pendiente_pago', payment_date y payment_method se ocultan
 *     y se envían como null al backend (también lo limpia el validator).
 *   - Si status='pagado', payment_date se prefilla con hoy si está vacío.
 */
export function BusinessExpenseForm(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const init = props.mode === "edit" ? props.initial : null;

  // ---- State --------------------------------------------------------------
  const [expenseDate, setExpenseDate] = useState<string>(init?.expense_date ?? todayIso());
  const [supplierName, setSupplierName] = useState<string>(init?.supplier_name ?? "");
  const [supplierRuc, setSupplierRuc] = useState<string>(init?.supplier_ruc ?? "");
  const [supplierId, setSupplierId] = useState<string>(init?.supplier_id ?? "");
  const [dueDate, setDueDate] = useState<string>(init?.due_date ?? "");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState<string>(
    init?.supplier_invoice_number ?? ""
  );
  /**
   * Si la persona tocó el vencimiento a mano, deja de recalcularse solo. El
   * plazo del proveedor propone; el comprobante manda.
   */
  const [vencimientoTocado, setVencimientoTocado] = useState<boolean>(
    Boolean(init?.due_date)
  );

  const proveedorElegido = props.suppliers.find((s) => s.id === supplierId) ?? null;

  /** Recalcula el vencimiento salvo que ya lo hayan editado a mano. */
  function proponerVencimiento(fechaGasto: string, plazo: number | null) {
    if (vencimientoTocado) return;
    setDueDate(fechaGasto ? vencimientoPorPlazo(fechaGasto, plazo ?? 0) : "");
  }
  // 🔴 De UNA cuenta a N LÍNEAS (migración `040`). La cuenta dejó de vivir en el
  //    encabezado: cada línea dice contra qué cuenta se imputa su parte, que es
  //    lo que el acta pide y lo que el asiento necesita.
  const [lineas, setLineas] = useState<ExpenseLineDraft[]>(
    init?.lineas?.length
      ? init.lineas.map((l, i) => ({
          key: `l${i}`,
          description: l.description,
          chart_account_code: l.chart_account_code ?? "",
          amount: String(l.amount),
          tax_rate: String(l.tax_rate),
          tax_amount: String(l.tax_amount),
        }))
      : [{ key: "l0", description: "", chart_account_code: "", amount: "", tax_rate: "0.07", tax_amount: "" }]
  );
  const [description, setDescription] = useState<string>(init?.description ?? "");
  const [status, setStatus] = useState<BusinessExpenseStatus>(init?.status ?? "pagado");
  const [paymentDate, setPaymentDate] = useState<string>(
    init?.payment_date ?? todayIso()
  );
  const [paymentMethod, setPaymentMethod] = useState<BusinessExpensePaymentMethod | "">(
    init?.payment_method ?? ""
  );
  const [notes, setNotes] = useState<string>(init?.notes ?? "");

  // ---- Errors / submit state ----------------------------------------------
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ---- Status: cambio de pagado ↔ pendiente_pago --------------------------
  useEffect(() => {
    if (status === "pagado" && !paymentDate) {
      setPaymentDate(todayIso());
    }
    // Cuando vuelve a pendiente_pago, NO limpiamos los campos locales —
    // el validator los descarta. Si el usuario vuelve a pagado los reusa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  /** Dos decimales, igual que el validador y la API. */
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  // ---- Los importes del encabezado, derivados de las líneas ---------------
  // Misma regla que `validators/business-expense.ts` y que la API. Se recalcula
  // en cada render en vez de guardarse en estado: así no puede quedar viejo
  // respecto de las líneas, que es de donde sale.
  const subtotalNum = round2(lineas.reduce((a, l) => a + (Number(l.amount) || 0), 0));
  const taxNum = round2(lineas.reduce((a, l) => a + (Number(l.tax_amount) || 0), 0));
  const totalNum = computeTotal(subtotalNum, taxNum);

  /** La tasa que viaja en el encabezado. Ver el comentario de la sección de importes. */
  const taxRateDerivada = (() => {
    if (taxNum <= 0) return 0;
    const gravadas = lineas
      .filter((l) => (Number(l.tax_amount) || 0) > 0)
      .map((l) => Number(l.tax_rate) || 0);
    return gravadas.length > 0 ? Math.max(...gravadas) : 0;
  })();

  // ---- Submit -------------------------------------------------------------
  async function handleSubmit() {
    setSubmitError(null);

    const payload: Partial<CreateBusinessExpenseInput> = {
      expense_date: expenseDate,
      supplier_id: supplierId || null,
      due_date: dueDate || null,
      supplier_invoice_number: supplierInvoiceNumber.trim() || null,
      // Se conservan como respaldo y para el caso sin entidad (ver la pantalla).
      supplier_name: supplierName.trim() || null,
      supplier_ruc: supplierRuc.trim() || null,
      lineas: lineas.map((l) => ({
        description: l.description.trim(),
        chart_account_code: l.chart_account_code || null,
        amount: Number(l.amount) || 0,
        tax_rate: Number(l.tax_rate) || 0,
        tax_amount: Number(l.tax_amount) || 0,
      })),
      description: description.trim(),
      // El servidor recalcula los dos sumando las líneas. Se mandan igual para
      // que el cliente muestre el total sin esperar la respuesta; si difieren,
      // gana el servidor.
      subtotal: subtotalNum,
      tax_rate: taxRateDerivada as BusinessExpenseTaxRate,
      tax_amount: taxNum,
      status,
      payment_date: status === "pagado" ? (paymentDate || null) : null,
      payment_method: status === "pagado"
        ? ((paymentMethod || null) as BusinessExpensePaymentMethod | null)
        : null,
      notes: notes.trim() || null,
    };

    const validation = validateCreateBusinessExpense(payload);
    if (!validation.ok) {
      setErrors(validation.errors);
      requestAnimationFrame(() => {
        document.querySelector("[data-error='true']")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
      return;
    }
    setErrors({});

    startTransition(async () => {
      try {
        const url =
          props.mode === "create"
            ? "/api/finanzas/business-expenses"
            : `/api/finanzas/business-expenses/${props.initial.id}`;
        const method = props.mode === "create" ? "POST" : "PATCH";

        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validation.data),
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
          router.push(`/finanzas/gastos-bufete/${id}?saved=1`);
          router.refresh();
        }
      } catch (err) {
        console.error(err);
        setSubmitError("Error de red al guardar. Intente de nuevo.");
      }
    });
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      {/* ── Sección: Datos del gasto ────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-integra-navy">Datos del gasto</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Fecha */}
          <div data-error={!!errors.expense_date}>
            <Label className="mb-1 block">Fecha del gasto *</Label>
            <Input
              type="date"
              value={expenseDate}
              onChange={(e) => {
                setExpenseDate(e.target.value);
                proponerVencimiento(e.target.value, proveedorElegido?.payment_terms_days ?? 0);
              }}
              disabled={isPending}
              className={errors.expense_date ? "border-red-300" : ""}
            />
            {errors.expense_date && (
              <p className="mt-1 text-xs text-red-600">{errors.expense_date}</p>
            )}
          </div>

          {/* ───────────────────────────────────────────────────────────────
              LÍNEAS. El mismo editor que usa el gasto de trámite — es la misma
              tabla `expense_lines` desde la `036`, por arco exclusivo.
              🔑 La cuenta es OBLIGATORIA en cada línea. El formulario guía; el
              servidor garantiza (`createBusinessExpense` la exige y la valida
              contra el plan vigente, línea por línea).
              ─────────────────────────────────────────────────────────────── */}
          <div className="sm:col-span-2">
            <Label className="mb-1 block">Líneas de la compra</Label>
            <ExpenseLinesEditor
              lineas={lineas}
              onChange={setLineas}
              // `account_type` es opcional en `ExpenseAccountOption` y el editor
              // lo pide siempre. Se completa con `expense`, que es lo que la
              // opción representaba antes de que el tipo existiera: la lista ya
              // viene filtrada a asset/cost/expense por
              // `listExpenseAccountOptions`, así que el valor no cambia qué se
              // ofrece — solo satisface el tipo.
              cuentas={props.accounts.map((a) => ({
                ...a,
                account_type: a.account_type ?? "expense",
              }))}
              disabled={isPending}
            />
            {errors.lineas && (
              <p className="mt-1 text-xs text-red-600">{errors.lineas}</p>
            )}
          </div>

          {/* ───────────────────────────────────────────────────────────────
              PROVEEDOR. Antes eran dos campos de texto libre que se
              reescribían en cada gasto, y por eso la antigüedad de cuentas por
              pagar mostraba el mismo proveedor dos veces cuando el nombre venía
              tipeado distinto. Ahora se elige la ficha.
              ─────────────────────────────────────────────────────────────── */}
          <div data-error={!!errors.supplier_id}>
            <Label className="mb-1 block">Proveedor</Label>
            <select
              value={supplierId}
              onChange={(e) => {
                const id = e.target.value;
                setSupplierId(id);
                const p = props.suppliers.find((x) => x.id === id) ?? null;
                if (p) setSupplierName("");
                proponerVencimiento(expenseDate, p?.payment_terms_days ?? 0);
              }}
              disabled={isPending}
              className={
                "block w-full rounded-md border px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none " +
                (errors.supplier_id ? "border-red-300" : "border-gray-300")
              }
            >
              <option value="">Sin ficha de proveedor</option>
              {props.suppliers.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.supplier_number} — {sp.trade_name?.trim() || sp.legal_name}
                </option>
              ))}
            </select>
            {errors.supplier_id && (
              <p className="mt-1 text-xs text-red-600">{errors.supplier_id}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              {proveedorElegido ? (
                <>
                  Plazo: <strong>{paymentTermsLabel(proveedorElegido.payment_terms_days)}</strong>.{" "}
                  <Link
                    href={`/finanzas/proveedores/${proveedorElegido.id}`}
                    className="text-integra-navy underline"
                  >
                    Ver ficha
                  </Link>
                </>
              ) : (
                <>
                  El RUC y el DV viven en la ficha del proveedor.{" "}
                  <Link href="/finanzas/proveedores/nuevo" className="text-integra-navy underline">
                    Crear un proveedor
                  </Link>
                </>
              )}
            </p>
          </div>

          {/* ───────────────────────────────────────────────────────────────
              NÚMERO DE FACTURA DEL PROVEEDOR (migración `044`). Es lo que se
              usa para conciliar contra el estado de cuenta del proveedor y para
              el anexo de compras de la DGI. Opcional a propósito: hay recibos y
              vales sin numeración de factura.
              ─────────────────────────────────────────────────────────────── */}
          <div data-error={!!errors.supplier_invoice_number}>
            <Label className="mb-1 block">N.º de factura del proveedor</Label>
            <Input
              type="text"
              value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
              disabled={isPending}
              maxLength={50}
              placeholder="Ej. 001-002-000123456"
              className={errors.supplier_invoice_number ? "border-red-300" : ""}
            />
            {errors.supplier_invoice_number && (
              <p className="mt-1 text-xs text-red-600">{errors.supplier_invoice_number}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              El número tal como viene en el comprobante. Opcional: si el gasto no
              tiene factura numerada, se deja vacío.
            </p>
          </div>

          {/* Vencimiento: lo que la antigüedad usa para calcular los tramos. */}
          <div data-error={!!errors.due_date}>
            <Label className="mb-1 block">Vence</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                setVencimientoTocado(true);
              }}
              disabled={isPending}
              className={errors.due_date ? "border-red-300" : ""}
            />
            {errors.due_date && <p className="mt-1 text-xs text-red-600">{errors.due_date}</p>}
            <p className="mt-1 text-xs text-gray-500">
              {vencimientoTocado
                ? "Editado a mano: ya no se recalcula solo."
                : "Se propone desde el plazo del proveedor y se puede cambiar: la fecha que vale es la del comprobante."}
            </p>
          </div>

          {/* Sin ficha: el texto libre de siempre, para no cerrar nada. */}
          {!supplierId && (
            <>
              <div data-error={!!errors.supplier_name}>
                <Label className="mb-1 block">Nombre del proveedor (sin ficha)</Label>
                <Input
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  disabled={isPending}
                  placeholder='Ej. "Cable Onda S.A."'
                  className={errors.supplier_name ? "border-red-300" : ""}
                />
                {errors.supplier_name && (
                  <p className="mt-1 text-xs text-red-600">{errors.supplier_name}</p>
                )}
              </div>

              <div data-error={!!errors.supplier_ruc}>
                <Label className="mb-1 block">RUC (sin ficha)</Label>
                <Input
                  type="text"
                  value={supplierRuc}
                  onChange={(e) => setSupplierRuc(e.target.value)}
                  disabled={isPending}
                  placeholder="Ej. 155123456-2-2024"
                  className={errors.supplier_ruc ? "border-red-300" : ""}
                />
                {errors.supplier_ruc && (
                  <p className="mt-1 text-xs text-red-600">{errors.supplier_ruc}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  Un gasto suelto se puede cargar así, pero <strong>los anexos de renta
                  necesitan la ficha</strong>: ahí el RUC y el DV van separados.
                </p>
              </div>
            </>
          )}

          {/* Descripción */}
          <div className="sm:col-span-2" data-error={!!errors.description}>
            <Label className="mb-1 block">Descripción *</Label>
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPending}
              placeholder='Ej. "Internet abril 2026"'
              className={errors.description ? "border-red-300" : ""}
            />
            {errors.description && (
              <p className="mt-1 text-xs text-red-600">{errors.description}</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Sección: Montos ─────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-integra-navy">Montos</h2>

        {/* ─────────────────────────────────────────────────────────────────
            LOS IMPORTES SE DERIVAN DE LAS LÍNEAS, NO SE TIPEAN.

            Hasta el 09/09/2026 acá había tres campos editables —subtotal, tasa
            de ITBMS y monto de ITBMS— que convivían con las líneas sin estar
            conectados. Eso obligaba a cargar los importes dos veces y, peor,
            rompía dos casos legítimos contra
            `business_expenses_tax_consistency_check`:

              · Todas las líneas exentas y la tasa del encabezado en su valor por
                DEFECTO (7%) → la base rechazaba la compra.
              · Líneas mixtas —una gravada y una exenta, la factura del internet
                que planteó Josuarth— con la tasa del encabezado en 0% → también.

            Ahora el encabezado es un RESUMEN. El ITBMS de cada línea se sigue
            pudiendo ajustar a mano en el editor de líneas, que es donde vive el
            dato: si el comprobante trae un redondeo distinto, se corrige ahí.
            ───────────────────────────────────────────────────────────────── */}
        <div className="rounded-md border bg-gray-50 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Subtotal</span>
            <span className="font-mono font-medium text-gray-900">
              B/. {fmtMoney(subtotalNum)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">
              ITBMS{" "}
              <span className="text-xs text-gray-400">
                (suma de las líneas gravadas)
              </span>
            </span>
            <span className="font-mono font-medium text-gray-900">
              B/. {fmtMoney(taxNum)}
            </span>
          </div>
          {(errors.subtotal || errors.tax_amount || errors.tax_rate) && (
            <p className="text-xs text-red-600">
              {errors.subtotal ?? errors.tax_amount ?? errors.tax_rate}
            </p>
          )}
          <p className="text-xs text-gray-500">
            Se calculan sumando las líneas de arriba. Para cambiarlos, edite la
            línea correspondiente.
          </p>
        </div>

        {/* Total calculado (read-only) */}
        <div className="rounded-md border border-integra-navy/20 bg-integra-navy/5 px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Total a pagar</span>
          <span className="text-xl font-bold text-integra-navy">
            B/. {fmtMoney(totalNum)}
          </span>
        </div>
      </section>

      {/* ── Sección: Pago ───────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-integra-navy">Estado de pago</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Status */}
          <div data-error={!!errors.status}>
            <Label className="mb-1 block">Estado *</Label>
            <div className="flex rounded-md border border-gray-300 bg-white overflow-hidden">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  disabled={isPending}
                  className={
                    "flex-1 min-h-[44px] text-sm font-medium transition-colors " +
                    (status === s
                      ? "bg-integra-navy text-white"
                      : "text-gray-700 hover:bg-gray-50")
                  }
                >
                  {BUSINESS_EXPENSE_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            {errors.status && (
              <p className="mt-1 text-xs text-red-600">{errors.status}</p>
            )}
          </div>

          {/* Fecha de pago (solo si pagado) */}
          {status === "pagado" && (
            <div data-error={!!errors.payment_date}>
              <Label className="mb-1 block">Fecha de pago</Label>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                disabled={isPending}
                className={errors.payment_date ? "border-red-300" : ""}
              />
              {errors.payment_date && (
                <p className="mt-1 text-xs text-red-600">{errors.payment_date}</p>
              )}
            </div>
          )}

          {/* Método de pago (solo si pagado) */}
          {status === "pagado" && (
            <div data-error={!!errors.payment_method}>
              <Label className="mb-1 block">Método de pago</Label>
              <select
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(e.target.value as BusinessExpensePaymentMethod | "")
                }
                disabled={isPending}
                className={
                  "block w-full rounded-md border px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none " +
                  (errors.payment_method ? "border-red-300" : "border-gray-300")
                }
              >
                <option value="">Sin especificar</option>
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm} value={pm}>
                    {BUSINESS_EXPENSE_PAYMENT_METHOD_LABEL[pm]}
                  </option>
                ))}
              </select>
              {errors.payment_method && (
                <p className="mt-1 text-xs text-red-600">{errors.payment_method}</p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Sección: Notas ──────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-integra-navy">Notas</h2>
        <div data-error={!!errors.notes}>
          <Label className="mb-1 block">Notas (opcional)</Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isPending}
            rows={3}
            className={
              "block w-full rounded-md border px-3 py-2 text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none " +
              (errors.notes ? "border-red-300" : "border-gray-300")
            }
            placeholder="Detalles adicionales sobre el gasto…"
          />
          {errors.notes && (
            <p className="mt-1 text-xs text-red-600">{errors.notes}</p>
          )}
        </div>
        {props.mode === "create" && (
          <p className="text-xs text-gray-500">
            El comprobante se puede subir desde la página de detalle después de guardar el gasto.
          </p>
        )}
      </section>

      {/* Submit error */}
      {submitError && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">No se pudo guardar el gasto</p>
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
              {props.mode === "create" ? "Guardar gasto" : "Guardar cambios"}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
