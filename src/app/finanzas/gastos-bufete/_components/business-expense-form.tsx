"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  validateCreateBusinessExpense,
  type ValidationErrors,
} from "@/lib/finanzas/validators/business-expense";
import {
  VALID_TAX_RATES,
  BUSINESS_EXPENSE_STATUS_LABEL,
  BUSINESS_EXPENSE_PAYMENT_METHOD_LABEL,
  computeExpectedTaxAmount,
  computeTotal,
  type BusinessExpenseStatus,
  type BusinessExpensePaymentMethod,
  type BusinessExpenseTaxRate,
  type CreateBusinessExpenseInput,
} from "@/lib/finanzas/types/business-expense";
import type { ExpenseAccountOption } from "@/lib/finanzas/queries/business-expenses";

interface BaseProps {
  accounts: ExpenseAccountOption[];
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
  const [accountCode, setAccountCode] = useState<string>(init?.chart_account_code ?? "");
  const [description, setDescription] = useState<string>(init?.description ?? "");
  const [subtotal, setSubtotal] = useState<string>(
    init ? String(init.subtotal) : ""
  );
  const [taxRate, setTaxRate] = useState<BusinessExpenseTaxRate>(
    (init?.tax_rate as BusinessExpenseTaxRate) ?? 0.07
  );
  const [taxAmount, setTaxAmount] = useState<string>(
    init ? String(init.tax_amount) : ""
  );
  // Si estamos editando, asumimos manualOverride=false (el valor inicial
  // viene de BD y se considera "calculado"). El usuario puede editarlo manual
  // y se marca como override en el momento que lo toca.
  const [manualOverride, setManualOverride] = useState(false);
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

  // ---- Auto-cálculo de tax_amount cuando cambia subtotal o tax_rate -------
  useEffect(() => {
    if (manualOverride) return;
    const sub = Number(subtotal);
    if (!isFinite(sub) || sub < 0) {
      // Si el subtotal está vacío o inválido, dejamos el campo vacío.
      // No forzamos 0 porque rompe la UX si el usuario está tipeando.
      return;
    }
    const expected = computeExpectedTaxAmount(sub, taxRate);
    setTaxAmount(expected.toFixed(2));
  }, [subtotal, taxRate, manualOverride]);

  // ---- Status: cambio de pagado ↔ pendiente_pago --------------------------
  useEffect(() => {
    if (status === "pagado" && !paymentDate) {
      setPaymentDate(todayIso());
    }
    // Cuando vuelve a pendiente_pago, NO limpiamos los campos locales —
    // el validator los descarta. Si el usuario vuelve a pagado los reusa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ---- Cálculo del total para mostrar (read-only) -------------------------
  const subtotalNum = Number(subtotal) || 0;
  const taxNum = Number(taxAmount) || 0;
  const totalNum = computeTotal(subtotalNum, taxNum);

  // ---- Recalcular ITBMS manual --------------------------------------------
  function handleRecalcTax() {
    setManualOverride(false);
    const sub = Number(subtotal);
    if (isFinite(sub) && sub >= 0) {
      setTaxAmount(computeExpectedTaxAmount(sub, taxRate).toFixed(2));
    }
  }

  // ---- Submit -------------------------------------------------------------
  async function handleSubmit() {
    setSubmitError(null);

    const payload: Partial<CreateBusinessExpenseInput> = {
      expense_date: expenseDate,
      supplier_name: supplierName.trim() || null,
      supplier_ruc: supplierRuc.trim() || null,
      chart_account_code: accountCode || null,
      description: description.trim(),
      subtotal: subtotalNum,
      tax_rate: taxRate,
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
        setSubmitError("Error de red al guardar. Intenta de nuevo.");
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
              onChange={(e) => setExpenseDate(e.target.value)}
              disabled={isPending}
              className={errors.expense_date ? "border-red-300" : ""}
            />
            {errors.expense_date && (
              <p className="mt-1 text-xs text-red-600">{errors.expense_date}</p>
            )}
          </div>

          {/* Cuenta contable */}
          <div data-error={!!errors.chart_account_code}>
            <Label className="mb-1 block">Cuenta contable</Label>
            <select
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              disabled={isPending}
              className={
                "block w-full rounded-md border px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none " +
                (errors.chart_account_code ? "border-red-300" : "border-gray-300")
              }
            >
              <option value="">Sin clasificar</option>
              {props.accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
            {errors.chart_account_code && (
              <p className="mt-1 text-xs text-red-600">{errors.chart_account_code}</p>
            )}
          </div>

          {/* Proveedor */}
          <div data-error={!!errors.supplier_name}>
            <Label className="mb-1 block">Proveedor</Label>
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

          {/* RUC */}
          <div data-error={!!errors.supplier_ruc}>
            <Label className="mb-1 block">RUC del proveedor</Label>
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
          </div>

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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Subtotal */}
          <div data-error={!!errors.subtotal}>
            <Label className="mb-1 block">Subtotal (B/.) *</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
              disabled={isPending}
              placeholder="0.00"
              className={errors.subtotal ? "border-red-300" : ""}
            />
            {errors.subtotal && (
              <p className="mt-1 text-xs text-red-600">{errors.subtotal}</p>
            )}
          </div>

          {/* Tasa ITBMS */}
          <div data-error={!!errors.tax_rate}>
            <Label className="mb-1 block">Tasa ITBMS *</Label>
            <select
              value={taxRate}
              onChange={(e) => {
                setTaxRate(Number(e.target.value) as BusinessExpenseTaxRate);
                setManualOverride(false);
              }}
              disabled={isPending}
              className={
                "block w-full rounded-md border px-3 min-h-[44px] text-sm bg-white hover:border-integra-navy focus:border-integra-navy focus:outline-none " +
                (errors.tax_rate ? "border-red-300" : "border-gray-300")
              }
            >
              {VALID_TAX_RATES.map((r) => (
                <option key={r} value={r}>
                  {r === 0 ? "Exento (0%)" : `${(r * 100).toFixed(0)}%`}
                </option>
              ))}
            </select>
            {errors.tax_rate && (
              <p className="mt-1 text-xs text-red-600">{errors.tax_rate}</p>
            )}
          </div>

          {/* ITBMS calculado (editable) */}
          <div data-error={!!errors.tax_amount}>
            <Label className="mb-1 flex items-center justify-between">
              <span>ITBMS (B/.) *</span>
              {manualOverride && (
                <button
                  type="button"
                  onClick={handleRecalcTax}
                  className="inline-flex items-center gap-1 text-xs font-medium text-integra-navy hover:text-integra-gold"
                  title="Volver al cálculo automático"
                >
                  <RefreshCw size={12} />
                  Recalcular
                </button>
              )}
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={taxAmount}
              onChange={(e) => {
                setTaxAmount(e.target.value);
                setManualOverride(true);
              }}
              disabled={isPending || taxRate === 0}
              placeholder="0.00"
              className={errors.tax_amount ? "border-red-300" : ""}
            />
            {errors.tax_amount && (
              <p className="mt-1 text-xs text-red-600">{errors.tax_amount}</p>
            )}
            {!errors.tax_amount && manualOverride && (
              <p className="mt-1 text-xs text-gray-500">Valor manual (override del cálculo automático)</p>
            )}
          </div>
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
