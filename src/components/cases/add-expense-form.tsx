"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AddExpenseFormProps {
  caseId: string;
}

export function AddExpenseForm({ caseId }: AddExpenseFormProps) {
  const router = useRouter();
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Expense fields
  const [expAmount, setExpAmount] = useState("");
  const [expConcept, setExpConcept] = useState("");
  const [expDate, setExpDate] = useState(new Date().toISOString().split("T")[0]);
  const [expType, setExpType] = useState<"tramite" | "administrativo">("tramite");

  // Payment fields
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [payType, setPayType] = useState<"tramite" | "administrativo">("tramite");

  const resetExpense = () => {
    setExpAmount("");
    setExpConcept("");
    setExpDate(new Date().toISOString().split("T")[0]);
    setShowExpenseForm(false);
    setError(null);
  };

  const resetPayment = () => {
    setPayAmount("");
    setPayDate(new Date().toISOString().split("T")[0]);
    setShowPaymentForm(false);
    setError(null);
  };

  const handleAddExpense = () => {
    const amount = parseFloat(expAmount);
    if (!amount || amount <= 0 || !expConcept.trim() || !expDate) {
      setError("Completa todos los campos del gasto");
      return;
    }
    startTransition(async () => {
      try {
        const response = await fetch("/api/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            case_id: caseId,
            amount,
            concept: expConcept.trim(),
            date: expDate,
            expense_type: expType,
          }),
        });
        if (!response.ok) {
          const json = await response.json().catch(() => ({}));
          setError(json.error ?? `Error ${response.status}: ${response.statusText}`);
          return;
        }
        resetExpense();
        router.refresh();
      } catch {
        setError("Error de conexión. Verifica tu conexión a internet.");
      }
    });
  };

  const handleAddPayment = () => {
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0 || !payDate) {
      setError("Completa todos los campos del pago");
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
            payment_type: payType,
          }),
        });
        if (!response.ok) {
          const json = await response.json().catch(() => ({}));
          setError(json.error ?? `Error ${response.status}: ${response.statusText}`);
          return;
        }
        resetPayment();
        router.refresh();
      } catch {
        setError("Error de conexión. Verifica tu conexión a internet.");
      }
    });
  };

  return (
    <div className="space-y-3">
      {/* Action buttons */}
      {!showExpenseForm && !showPaymentForm && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => { setShowExpenseForm(true); setExpType("tramite"); setShowPaymentForm(false); setError(null); }}
            className="min-h-[48px] bg-red-600 text-white hover:bg-red-700 font-semibold"
          >
            <Plus size={18} className="mr-1" />
            Gasto del Trámite
          </Button>
          <Button
            onClick={() => { setShowExpenseForm(true); setExpType("administrativo"); setExpAmount("21.50"); setShowPaymentForm(false); setError(null); }}
            className="min-h-[48px] bg-amber-600 text-white hover:bg-amber-700 font-semibold"
          >
            <Plus size={18} className="mr-1" />
            Gasto Administrativo
          </Button>
          <Button
            onClick={() => { setShowPaymentForm(true); setPayType("tramite"); setShowExpenseForm(false); setError(null); }}
            className="min-h-[48px] bg-green-600 text-white hover:bg-green-700 font-semibold"
          >
            <Plus size={18} className="mr-1" />
            Pago para Trámite
          </Button>
          <Button
            onClick={() => { setShowPaymentForm(true); setPayType("administrativo"); setShowExpenseForm(false); setError(null); }}
            className="min-h-[48px] bg-teal-600 text-white hover:bg-teal-700 font-semibold"
          >
            <Plus size={18} className="mr-1" />
            Pago Administrativo
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
        <div className="rounded-xl border border-red-200 bg-red-50/30 p-4 space-y-3">
          <h4 className="font-semibold text-red-700">
            {expType === "tramite" ? "Nuevo Gasto del Trámite" : "Nuevo Gasto Administrativo"}
          </h4>
          {expType === "administrativo" && (
            <p className="text-xs text-amber-600">Monto sugerido: B/.21.50 (editable)</p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Monto (B/.)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={expAmount}
                onChange={(e) => setExpAmount(e.target.value)}
                placeholder="0.00"
                className="min-h-[48px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Concepto</Label>
              <Input
                value={expConcept}
                onChange={(e) => setExpConcept(e.target.value)}
                placeholder="Ej: Timbres fiscales"
                className="min-h-[48px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <Input
                type="date"
                value={expDate}
                onChange={(e) => setExpDate(e.target.value)}
                className="min-h-[48px]"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button onClick={resetExpense} variant="ghost" disabled={isPending} className="min-h-[44px]">
              <X size={16} className="mr-1" /> Cancelar
            </Button>
            <Button onClick={handleAddExpense} disabled={isPending} className="min-h-[44px] bg-red-600 hover:bg-red-700">
              {isPending ? <Loader2 size={16} className="mr-1 animate-spin" /> : <Save size={16} className="mr-1" />}
              Guardar Gasto
            </Button>
          </div>
        </div>
      )}

      {/* Payment form */}
      {showPaymentForm && (
        <div className={`rounded-xl border p-4 space-y-3 ${payType === "administrativo" ? "border-teal-200 bg-teal-50/30" : "border-green-200 bg-green-50/30"}`}>
          <h4 className={`font-semibold ${payType === "administrativo" ? "text-teal-700" : "text-green-700"}`}>
            {payType === "administrativo" ? "Nuevo Pago para Gastos Administrativos" : "Nuevo Pago para Gastos del Trámite"}
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Monto (USD)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0.00"
                className="min-h-[48px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fecha de pago</Label>
              <Input
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="min-h-[48px]"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button onClick={resetPayment} variant="ghost" disabled={isPending} className="min-h-[44px]">
              <X size={16} className="mr-1" /> Cancelar
            </Button>
            <Button onClick={handleAddPayment} disabled={isPending} className="min-h-[44px] bg-green-600 hover:bg-green-700">
              {isPending ? <Loader2 size={16} className="mr-1 animate-spin" /> : <Save size={16} className="mr-1" />}
              Guardar Pago
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
