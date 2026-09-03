"use client";

import { useMemo, useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, X, Loader2, Paperclip } from "lucide-react";
import { directUpload } from "@/lib/storage/direct-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import {
  ExpenseLinesEditor,
  type CuentaOption,
} from "@/components/finanzas/expense-lines-editor";
import { lineaVacia } from "@/lib/finanzas/validators/expense-line";
import {
  CUENTA_TRAMITE_DEFAULT,
  totalesDeLineas,
  type ExpenseLineDraft,
} from "@/lib/finanzas/types/expense-line";

/** Un proveedor elegible, con su plazo para precargar el vencimiento. */
export interface ProveedorOption {
  id: string;
  legal_name: string;
  payment_terms_days: number;
}

interface SectionExpenseFormProps {
  caseId: string;
  sectionType: "tramite" | "administrativo";
  /** Cuentas activas del plan, para el selector de cada línea. */
  cuentas?: CuentaOption[];
  /** Proveedores activos. El vencimiento sale de su `payment_terms_days`. */
  proveedores?: ProveedorOption[];
}

/**
 * Suma `dias` a una fecha ISO y devuelve otra fecha ISO.
 *
 * ⚠️ Se hace con `Date.UTC` a propósito: `new Date("2026-03-15")` se interpreta
 * como medianoche UTC, y sumarle días con la zona local puede correr el
 * resultado un día para atrás en Panamá (UTC−5). Un vencimiento corrido un día
 * cambia el tramo de la antigüedad.
 */
export function sumarDias(fechaIso: string, dias: number): string {
  const [a, m, d] = fechaIso.split("-").map(Number);
  if (!a || !m || !d) return fechaIso;
  const t = Date.UTC(a, m - 1, d) + dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function SectionExpenseForm({
  caseId,
  sectionType,
  cuentas = [],
  proveedores = [],
}: SectionExpenseFormProps) {
  const router = useRouter();
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Expense fields
  const [expConcept, setExpConcept] = useState("");
  const [expDate, setExpDate] = useState(new Date().toISOString().split("T")[0]);
  const [expFile, setExpFile] = useState<File | null>(null);
  const expFileRef = useRef<HTMLInputElement>(null);
  const [expSupplier, setExpSupplier] = useState("");
  const [expDueDate, setExpDueDate] = useState("");
  const [expLineas, setExpLineas] = useState<ExpenseLineDraft[]>([
    lineaVacia("l0", CUENTA_TRAMITE_DEFAULT),
  ]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // El monto del encabezado ES la suma de las líneas. No hay campo de monto: si
  // lo hubiera, habría dos verdades y el asiento se arma con una sola.
  const totalLineas = useMemo(
    () =>
      totalesDeLineas(
        expLineas.map((l) => ({
          amount: Number(l.amount.replace(",", ".")) || 0,
          tax_amount: Number(l.tax_amount.replace(",", ".")) || 0,
        }))
      ).total,
    [expLineas]
  );

  /**
   * Al elegir proveedor se precarga el vencimiento con su plazo de pago.
   * Es una PRECARGA, no una imposición: queda editable, y cambiar el plazo del
   * proveedor después NO reescribe los vencimientos ya cargados.
   */
  function elegirProveedor(id: string) {
    setExpSupplier(id);
    const p = proveedores.find((x) => x.id === id);
    if (p) setExpDueDate(sumarDias(expDate, p.payment_terms_days));
    else setExpDueDate("");
  }

  // Payment fields
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [payDescription, setPayDescription] = useState("");

  const isTramite = sectionType === "tramite";

  const resetExpense = () => {
    setExpConcept("");
    setExpDate(new Date().toISOString().split("T")[0]);
    setExpFile(null);
    if (expFileRef.current) expFileRef.current.value = "";
    setExpSupplier("");
    setExpDueDate("");
    setExpLineas([lineaVacia(`l${Date.now()}`, CUENTA_TRAMITE_DEFAULT)]);
    setFieldErrors({});
    setShowExpenseForm(false);
    setError(null);
  };

  const resetPayment = () => {
    setPayAmount("");
    setPayDate(new Date().toISOString().split("T")[0]);
    setPayDescription("");
    setShowPaymentForm(false);
    setError(null);
  };

  const handleAddExpense = () => {
    setFieldErrors({});
    if (!expConcept.trim() || !expDate) {
      setError("Complete el concepto y la fecha del gasto");
      return;
    }
    if (expFile) {
      if (expFile.size > 10 * 1024 * 1024) {
        setError("El archivo excede el tamaño máximo de 10MB");
        return;
      }
      const allowed = ["image/jpeg", "image/png", "image/jpg", "application/pdf"];
      if (!allowed.includes(expFile.type)) {
        setError("Solo se permiten archivos JPG, PNG o PDF");
        return;
      }
    }
    startTransition(async () => {
      try {
        const response = await fetch("/api/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            case_id: caseId,
            concept: expConcept.trim(),
            date: expDate,
            expense_type: sectionType,
            supplier_id: expSupplier || null,
            due_date: expDueDate || null,
            // El monto NO se manda: lo calcula el servidor sumando las líneas.
            // Mandarlo sería ofrecer una segunda verdad que alguien puede
            // manipular con un `curl`.
            lines: expLineas,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(json.error ?? `Error ${response.status}`);
          if (json.fieldErrors) setFieldErrors(json.fieldErrors);
          return;
        }

        if (expFile && json.id) {
          try {
            const { storagePath } = await directUpload({
              file: expFile,
              pathPrefix: `gastos/${json.id}`,
              allowedTypes: ["image/jpeg", "image/png", "image/jpg", "application/pdf"],
            });
            await fetch(`/api/expenses/${json.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ receipt_url: storagePath, receipt_filename: expFile.name }),
            });
          } catch {
            // Expense created but receipt failed — user can retry via edit
          }
        }

        resetExpense();
        router.refresh();
      } catch {
        setError("Error de conexión");
      }
    });
  };

  const handleAddPayment = () => {
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0 || !payDate) {
      setError("Complete todos los campos del cobro");
      return;
    }
    startTransition(async () => {
      try {
        const response = await fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            case_id: caseId,
            amount,
            payment_date: payDate,
            payment_type: sectionType,
            description: payDescription.trim() || null,
          }),
        });
        if (!response.ok) {
          const json = await response.json().catch(() => ({}));
          setError(json.error ?? `Error ${response.status}`);
          return;
        }
        resetPayment();
        router.refresh();
      } catch {
        setError("Error de conexión");
      }
    });
  };

  return (
    <div className="space-y-3">
      {/* Action buttons */}
      {!showExpenseForm && !showPaymentForm && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setShowExpenseForm(true);
              setShowPaymentForm(false);
              setError(null);
              // El gasto administrativo tiene un monto habitual. Ahora que el
              // monto vive en las líneas, la sugerencia precarga la PRIMERA
              // línea en vez de un campo suelto.
              if (sectionType === "administrativo") {
                setExpLineas([
                  {
                    ...lineaVacia(`l${Date.now()}`, CUENTA_TRAMITE_DEFAULT),
                    amount: "21.50",
                  },
                ]);
              }
            }}
            size="sm"
            className="min-h-[44px] bg-red-600 hover:bg-red-700 text-white font-semibold"
          >
            <Plus size={16} className="mr-1" />
            {isTramite ? "Gasto del Trámite" : "Gasto Administrativo"}
          </Button>
          <Button
            onClick={() => {
              setShowPaymentForm(true);
              setShowExpenseForm(false);
              setError(null);
            }}
            size="sm"
            className="min-h-[44px] bg-green-600 hover:bg-green-700 text-white font-semibold"
          >
            <Plus size={16} className="mr-1" />
            {isTramite ? "Cobro de Trámite" : "Cobro Administrativo"}
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Expense form */}
      {showExpenseForm && (
        <div className="rounded-xl border p-4 space-y-3"
          style={{
            borderColor: isTramite ? "rgb(254 202 202)" : "rgb(253 230 138)",
            backgroundColor: isTramite ? "rgba(254 242 242 / 0.3)" : "rgba(255 251 235 / 0.3)",
          }}
        >
          <h4 className={`font-semibold ${isTramite ? "text-red-700" : "text-amber-700"}`}>
            {isTramite ? "Nuevo Gasto del Trámite" : "Nuevo Gasto Administrativo"}
          </h4>
          {sectionType === "administrativo" && (
            <p className="text-xs text-amber-600">Monto sugerido: B/.21.50 (editable)</p>
          )}
          {/* Encabezado del documento. El MONTO no está: sale de las líneas. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Concepto</Label>
              <Input value={expConcept} onChange={(e) => setExpConcept(e.target.value)} placeholder="Ej: Trámite Registro Público" className="min-h-[48px]" />
            </div>
            <div className="space-y-1.5">
              <Label>Fecha del gasto</Label>
              <Input
                type="date"
                value={expDate}
                onChange={(e) => {
                  setExpDate(e.target.value);
                  // Si ya hay proveedor, el vencimiento se recalcula: el plazo
                  // corre desde la fecha del gasto, no desde la de hoy.
                  const p = proveedores.find((x) => x.id === expSupplier);
                  if (p) setExpDueDate(sumarDias(e.target.value, p.payment_terms_days));
                }}
                className="min-h-[48px]"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Proveedor (opcional)</Label>
              <select
                value={expSupplier}
                onChange={(e) => elegirProveedor(e.target.value)}
                className="block w-full rounded-md border border-gray-300 bg-white px-2 min-h-[48px] text-sm focus:border-integra-navy focus:outline-none"
              >
                <option value="">— Sin proveedor —</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.legal_name}
                    {p.payment_terms_days > 0 ? ` (${p.payment_terms_days} días)` : " (contado)"}
                  </option>
                ))}
              </select>
              {proveedores.length === 0 && (
                <p className="text-xs text-gray-400">
                  No hay proveedores cargados todavía.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Vencimiento</Label>
              <Input
                type="date"
                value={expDueDate}
                onChange={(e) => setExpDueDate(e.target.value)}
                className="min-h-[48px]"
              />
              <p className="text-xs text-gray-400">
                Se precarga con el plazo del proveedor y se puede cambiar. De acá salen
                los tramos de la antigüedad.
              </p>
            </div>
          </div>

          {/* El detalle contable. Es el mismo editor que va a usar Compras. */}
          <ExpenseLinesEditor
            lineas={expLineas}
            onChange={setExpLineas}
            cuentas={cuentas}
            cuentaPorDefecto={CUENTA_TRAMITE_DEFAULT}
            errors={fieldErrors}
            disabled={isPending}
          />
          <div className="space-y-1.5">
            <Label className="text-sm flex items-center gap-1">
              <Paperclip size={14} /> Adjuntar recibo (opcional)
            </Label>
            <div className="flex items-center gap-2">
              <Input ref={expFileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setExpFile(e.target.files?.[0] ?? null)} className="min-h-[48px] text-sm" />
              {expFile && (
                <button type="button" onClick={() => { setExpFile(null); if (expFileRef.current) expFileRef.current.value = ""; }} className="text-gray-400 hover:text-red-500">
                  <X size={16} />
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400">JPG, PNG o PDF. Máximo 10MB.</p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button onClick={resetExpense} variant="ghost" disabled={isPending} className="min-h-[44px]">
              <X size={16} className="mr-1" /> Cancelar
            </Button>
            <Button onClick={handleAddExpense} disabled={isPending} className="min-h-[44px] bg-red-600 hover:bg-red-700">
              {isPending ? <Loader2 size={16} className="mr-1 animate-spin" /> : <Save size={16} className="mr-1" />}
              Guardar Gasto{totalLineas > 0 ? ` · B/. ${totalLineas.toFixed(2)}` : ""}
            </Button>
          </div>
        </div>
      )}

      {/* Payment form */}
      {showPaymentForm && (
        <div className="rounded-xl border p-4 space-y-3"
          style={{
            borderColor: isTramite ? "rgb(187 247 208)" : "rgb(153 246 228)",
            backgroundColor: isTramite ? "rgba(240 253 244 / 0.3)" : "rgba(240 253 250 / 0.3)",
          }}
        >
          <h4 className={`font-semibold ${isTramite ? "text-green-700" : "text-teal-700"}`}>
            {isTramite ? "Nuevo Cobro de Trámite" : "Nuevo Cobro Administrativo"}
          </h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Monto (B/.)</Label>
              <NumberInput min="0.01" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0.00" className="min-h-[48px]" />
            </div>
            <div className="space-y-1.5">
              <Label>Descripción (opcional)</Label>
              <Input value={payDescription} onChange={(e) => setPayDescription(e.target.value)} placeholder="Ej: Transferencia bancaria" className="min-h-[48px]" />
            </div>
            <div className="space-y-1.5">
              <Label>Fecha del cobro</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="min-h-[48px]" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button onClick={resetPayment} variant="ghost" disabled={isPending} className="min-h-[44px]">
              <X size={16} className="mr-1" /> Cancelar
            </Button>
            <Button onClick={handleAddPayment} disabled={isPending} className="min-h-[44px] bg-green-600 hover:bg-green-700">
              {isPending ? <Loader2 size={16} className="mr-1 animate-spin" /> : <Save size={16} className="mr-1" />}
              Guardar Cobro
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
