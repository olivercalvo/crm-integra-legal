"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Check, Loader2 } from "lucide-react";
import type { Client, CatClassification } from "@/types/database";

interface ClientFormProps {
  mode: "create" | "edit";
  client?: Client;
  classifications: CatClassification[];
}

interface FormData {
  client_number: string;
  name: string;
  ruc: string;
  type: string;
  contact: string;
  phone: string;
  email: string;
  observations: string;
}

const STEPS = [
  { label: "Identificación", description: "Datos principales del cliente" },
  { label: "Contacto", description: "Información de contacto" },
  { label: "Observaciones", description: "Notas adicionales" },
];

export function ClientForm({ mode, client, classifications }: ClientFormProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<FormData>({
    client_number: client?.client_number ?? "",
    name: client?.name ?? "",
    ruc: client?.ruc ?? "",
    type: client?.type ?? "",
    contact: client?.contact ?? "",
    phone: client?.phone ?? "",
    email: client?.email ?? "",
    observations: client?.observations ?? "",
  });

  // Fetch suggested number on create mode
  useEffect(() => {
    if (mode === "create") {
      fetch("/api/clients")
        .then((r) => r.json())
        .then((d) => {
          if (d.suggested) {
            setFormData((prev) => ({ ...prev, client_number: d.suggested }));
          }
        })
        .catch(() => {});
    }
  }, [mode]);

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  const set = (key: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData((prev) => ({ ...prev, [key]: e.target.value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validateStep = (s: number): boolean => {
    const errors: Partial<Record<keyof FormData, string>> = {};
    if (s === 0) {
      if (!formData.name.trim()) {
        errors.name = "El nombre es requerido";
      }
    }
    if (s === 1) {
      if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
        errors.email = "Ingresa un correo válido";
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleNext = () => {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleBack = () => {
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = async () => {
    if (!validateStep(step)) return;
    setLoading(true);
    setError(null);

    try {
      const payload = {
        name: formData.name.trim(),
        ruc: formData.ruc.trim() || null,
        type: formData.type || null,
        contact: formData.contact.trim() || null,
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        observations: formData.observations.trim() || null,
        ...(mode === "create" && formData.client_number.trim()
          ? { client_number: formData.client_number.trim() }
          : {}),
      };

      let response: Response;

      if (mode === "create") {
        response = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        response = await fetch(`/api/clients/${client!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Error al guardar el cliente");
        return;
      }

      router.push(`/abogada/clientes/${data.id}`);
      router.refresh();
    } catch {
      setError("Error de conexión. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const isLastStep = step === STEPS.length - 1;

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                i < step
                  ? "bg-integra-gold text-integra-navy"
                  : i === step
                  ? "bg-integra-navy text-white"
                  : "bg-gray-200 text-gray-500"
              }`}
            >
              {i < step ? <Check size={14} /> : i + 1}
            </div>
            <span className={`hidden sm:block text-sm ${i === step ? "font-semibold text-integra-navy" : "text-gray-400"}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-6 sm:w-12 ${i < step ? "bg-integra-gold" : "bg-gray-200"}`} />
            )}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-6 space-y-5">
          <div>
            <h3 className="font-semibold text-integra-navy">{STEPS[step].label}</h3>
            <p className="text-sm text-gray-500">{STEPS[step].description}</p>
          </div>

          {/* Step 0: Identificación */}
          {step === 0 && (
            <div className="space-y-4">
              {/* Editable client number */}
              <div className="space-y-1.5">
                <Label htmlFor="client_number">
                  N° Cliente <span className="text-gray-400 text-xs font-normal">(editable)</span>
                </Label>
                <Input
                  id="client_number"
                  value={formData.client_number}
                  onChange={set("client_number")}
                  placeholder="Ej. CLI-024"
                  className="min-h-[48px] font-mono"
                  disabled={mode === "edit"}
                />
                {mode === "create" && (
                  <p className="text-xs text-gray-400">
                    Sugerido automáticamente. Puedes cambiarlo para seguir tu propia numeración.
                  </p>
                )}
                {fieldErrors.client_number && (
                  <p className="text-xs text-red-500">{fieldErrors.client_number}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="name">
                  Nombre completo <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={set("name")}
                  placeholder="Ej. Empresa ABC, S.A."
                  className="min-h-[48px]"
                  autoFocus
                />
                {fieldErrors.name && (
                  <p className="text-xs text-red-500">{fieldErrors.name}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ruc">RUC / Cédula</Label>
                <Input
                  id="ruc"
                  value={formData.ruc}
                  onChange={set("ruc")}
                  placeholder="Ej. 12-345-6789"
                  className="min-h-[48px]"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="type">Tipo de Cliente</Label>
                <select
                  id="type"
                  value={formData.type}
                  onChange={set("type")}
                  className="w-full min-h-[48px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— Seleccionar tipo —</option>
                  <option value="Persona Natural">Persona Natural</option>
                  <option value="Persona Jurídica">Persona Jurídica</option>
                  <option value="Retainer">Retainer</option>
                </select>
                {formData.type === "Retainer" && (
                  <p className="text-xs text-integra-gold font-medium">
                    Cliente con contrato continuo y múltiples casos
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 1: Contacto */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="contact">Persona de contacto</Label>
                <Input
                  id="contact"
                  value={formData.contact}
                  onChange={set("contact")}
                  placeholder="Nombre del representante o contacto"
                  className="min-h-[48px]"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={set("phone")}
                  placeholder="Ej. +507 6000-0000"
                  className="min-h-[48px]"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={set("email")}
                  placeholder="cliente@ejemplo.com"
                  className="min-h-[48px]"
                />
                {fieldErrors.email && (
                  <p className="text-xs text-red-500">{fieldErrors.email}</p>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Observaciones */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="observations">Observaciones</Label>
                <textarea
                  id="observations"
                  value={formData.observations}
                  onChange={set("observations")}
                  placeholder="Notas internas, instrucciones especiales, referencias, etc."
                  rows={6}
                  autoFocus
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={step === 0 ? () => router.back() : handleBack}
          className="min-h-[48px] px-5"
        >
          <ChevronLeft size={18} />
          {step === 0 ? "Cancelar" : "Anterior"}
        </Button>

        {!isLastStep ? (
          <Button
            type="button"
            onClick={handleNext}
            className="min-h-[48px] px-5 bg-integra-navy hover:bg-integra-navy/90"
          >
            Siguiente
            <ChevronRight size={18} />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="min-h-[48px] px-6 bg-integra-gold text-integra-navy hover:bg-integra-gold/90 font-semibold"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Guardando…
              </>
            ) : (
              <>
                <Check size={18} />
                {mode === "create" ? "Crear Cliente" : "Guardar Cambios"}
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
