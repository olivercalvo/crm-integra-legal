"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlusCircle, Loader2 } from "lucide-react";

interface ExpenseFormProps {
  caseId: string;
  onSuccess?: () => void;
}

export function ExpenseForm({ caseId, onSuccess }: ExpenseFormProps) {
  const router = useRouter();
  const today = new Date().toISOString().split("T")[0];

  const [amount, setAmount] = useState("");
  const [concept, setConcept] = useState("");
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("Ingrese un monto válido mayor a 0.");
      return;
    }
    if (!concept.trim()) {
      setError("El concepto es requerido.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: caseId, amount: parsedAmount, concept: concept.trim(), date }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al registrar el gasto.");
        setLoading(false);
        return;
      }

      setAmount("");
      setConcept("");
      setDate(today);
      onSuccess?.();
      router.refresh();
    } catch {
      setError("Error de conexión. Intente de nuevo.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Amount */}
        <div className="space-y-1.5">
          <Label htmlFor="expense-amount" className="text-sm font-medium text-integra-navy">
            Monto (USD)
          </Label>
          <Input
            id="expense-amount"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="h-11 border-gray-200 focus:border-integra-gold focus:ring-integra-gold"
          />
        </div>

        {/* Date */}
        <div className="space-y-1.5">
          <Label htmlFor="expense-date" className="text-sm font-medium text-integra-navy">
            Fecha
          </Label>
          <Input
            id="expense-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="h-11 border-gray-200 focus:border-integra-gold focus:ring-integra-gold"
          />
        </div>
      </div>

      {/* Concept */}
      <div className="space-y-1.5">
        <Label htmlFor="expense-concept" className="text-sm font-medium text-integra-navy">
          Concepto
        </Label>
        <Input
          id="expense-concept"
          type="text"
          placeholder="Ej. Honorarios, diligencias, aranceles..."
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          required
          className="h-11 border-gray-200 focus:border-integra-gold focus:ring-integra-gold"
        />
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <Button
        type="submit"
        disabled={loading}
        className="h-11 w-full bg-integra-navy text-white hover:bg-integra-navy/90 font-medium"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Registrando...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <PlusCircle size={16} />
            Registrar Gasto
          </span>
        )}
      </Button>
    </form>
  );
}
