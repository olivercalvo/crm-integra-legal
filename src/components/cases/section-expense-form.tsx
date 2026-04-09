"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, X, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SectionExpenseFormProps {
  caseId: string;
  sectionType: "tramite" | "administrativo";
}

export function SectionExpenseForm({ caseId, sectionType }: SectionExpenseFormProps) {
  const router = useRouter();
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Expense fields
  const [expAmount, setExpAmount] = useState("");
  const [expConcept, setExpConcept] = useState("");
  const [expDate, setExpDate] = useState(new Date().toISOString().split("T")[0]);
  const [expFile, setExpFile] = useState<File | null>(null);
  const expFileRef = useRef<HTMLInputElement>(null);

  // Payment fields
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [payDescription, setPayDescription] = useState("");

  const isTramite = sectionType === "tramite";

  const resetExpense = () => {
    setExpAmount("");
    setExpConcept("");
    setExpDate(new Date().toISOString().split("T")[0]);
    setExpFile(null);
    if (expFileRef.current) expFileRef.current.value = "";
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
    const amount = parseFloat(expAmount);
    if (!amount || amount <= 0 || !expConcept.trim() || !expDate) {
      setError("Completa todos los campos del gasto");
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
            amount,
            concept: expConcept.trim(),
            date: expDate,
            expense_type: sectionType,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(json.error ?? `Error ${response.status}`);
          return;
        }

        if (expFile && json.id) {
          const formData = new FormData();
          formData.append("file", expFile);
          await fetch(`/api/expenses/${json.id}/receipt`, {
            method: "POST",
            body: formData,
          });
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
              if (sectionType === "administrativo") setExpAmount("21.50");
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
            {isTramite ? "Pago de Trámite" : "Pago Administrativo"}
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
        <div className={`rounded-xl border border-${expenseColor}-200 bg-${expenseColor}-50/30 p-4 space-y-3`}
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
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Monto (B/.)</Label>
              <Input type="number" min="0.01" step="0.01" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} placeholder="0.00" className="min-h-[48px]" />
            </div>
            <div className="space-y-1.5">
              <Label>Concepto</Label>
              <Input value={expConcept} onChange={(e) => setExpConcept(e.target.value)} placeholder="Ej: Timbres fiscales" className="min-h-[48px]" />
            </div>
            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <Input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} className="min-h-[48px]" />
            </div>
          </div>
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
              Guardar Gasto
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
            {isTramite ? "Nuevo Pago de Trámite" : "Nuevo Pago Administrativo"}
          </h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Monto (B/.)</Label>
              <Input type="number" min="0.01" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0.00" className="min-h-[48px]" />
            </div>
            <div className="space-y-1.5">
              <Label>Descripción (opcional)</Label>
              <Input value={payDescription} onChange={(e) => setPayDescription(e.target.value)} placeholder="Ej: Transferencia bancaria" className="min-h-[48px]" />
            </div>
            <div className="space-y-1.5">
              <Label>Fecha de pago</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="min-h-[48px]" />
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
