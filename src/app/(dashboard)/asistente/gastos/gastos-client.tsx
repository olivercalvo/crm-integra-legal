"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { Plus, X } from "lucide-react";

interface CaseOption {
  id: string;
  code: string;
  clientName: string;
}

interface GastosFormPanelProps {
  cases: CaseOption[];
}

export function GastosFormPanel({ cases }: GastosFormPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(
    cases[0]?.id ?? ""
  );

  if (cases.length === 0) return null;

  return (
    <div>
      {!showForm ? (
        <Button
          type="button"
          onClick={() => setShowForm(true)}
          className="min-h-[48px] bg-integra-navy px-5 text-white hover:bg-integra-navy/90"
        >
          <Plus size={18} className="mr-1.5" />
          Registrar Gasto
        </Button>
      ) : (
        <Card className="border border-dashed border-integra-gold/50 bg-amber-50/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-integra-navy">
              Nuevo Gasto
            </CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowForm(false)}
              className="h-8 w-8 p-0 text-gray-400 hover:text-gray-600"
            >
              <X size={16} />
              <span className="sr-only">Cerrar</span>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Case selector */}
            <div className="space-y-1.5">
              <Label
                htmlFor="gasto-case-select"
                className="text-sm font-medium text-integra-navy"
              >
                Expediente
              </Label>
              <select
                id="gasto-case-select"
                value={selectedCaseId}
                onChange={(e) => setSelectedCaseId(e.target.value)}
                className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-sm focus:border-integra-gold focus:outline-none focus:ring-1 focus:ring-integra-gold"
              >
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.clientName}
                  </option>
                ))}
              </select>
            </div>

            {selectedCaseId && (
              <ExpenseForm
                caseId={selectedCaseId}
                onSuccess={() => setShowForm(false)}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
