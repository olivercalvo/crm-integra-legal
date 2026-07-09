"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Check, Loader2 } from "lucide-react";
import type { Client, CatClassification } from "@/types/database";
import {
  TIPO_RECEPTOR_FE_OPTIONS,
  tipoRequiresDV,
  suggestTipoReceptorFe,
  validateFiscalFields,
} from "@/lib/clients/fiscal-fields";

interface LawyerOption {
  id: string;
  name: string;
}

interface ClientFormProps {
  mode: "create" | "edit";
  client?: Client;
  classifications: CatClassification[];
  lawyers?: LawyerOption[];
}

interface FormData {
  client_number: string;
  name: string;
  ruc: string;
  type: string;
  tipo_receptor_fe: string;
  digito_verificador: string;
  responsible_lawyer_id: string;
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

export function ClientForm({ mode, client, classifications, lawyers = [] }: ClientFormProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<FormData>({
    client_number: client?.client_number ?? "",
    name: client?.name ?? "",
    ruc: client?.ruc ?? "",
    type: client?.type ?? "",
    // FE DGI: si el cliente ya lo tiene cargado se respeta; sino se sugiere
    // desde client_type (juridica→01; natural queda a elección de la abogada).
    tipo_receptor_fe: client?.tipo_receptor_fe ?? suggestTipoReceptorFe(client?.client_type),
    digito_verificador: client?.digito_verificador ?? "",
    responsible_lawyer_id: client?.responsible_lawyer_id ?? "",
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
      // FE DGI: coherencia de los campos fiscales (DV obligatorio si 01/03).
      const fiscalErrors = validateFiscalFields({
        tipo_receptor_fe: formData.tipo_receptor_fe,
        digito_verificador: formData.digito_verificador,
      });
      Object.assign(errors, fiscalErrors);
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
      // En modo create NO enviamos client_number: el servidor lo asigna
      // atómicamente vía allocateClientNumber (numbering_sequences).
      // El preview mostrado en la UI es solo informativo; enviarlo dispararía
      // la rama "custom" del POST (que valida UNIQUE en app-level y sufre
      // races bajo concurrencia). En modo edit permitimos que el PATCH decida
      // qué hacer con el campo (comportamiento actual sin cambios).
      const payload = {
        name: formData.name.trim(),
        ruc: formData.ruc.trim() || null,
        type: formData.type || null,
        tipo_receptor_fe: formData.tipo_receptor_fe || null,
        digito_verificador: formData.digito_verificador.trim() || null,
        contact: formData.contact.trim() || null,
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        observations: formData.observations.trim() || null,
        responsible_lawyer_id: formData.responsible_lawyer_id || null,
        ...(mode === "edit" && formData.client_number.trim()
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

      router.push(`/legal/clientes/${data.id}`);
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
              {/* Auto-assigned client number (read-only preview) */}
              {mode === "create" && (
                <div className="rounded-lg border-2 border-integra-gold/50 bg-integra-gold/5 p-3 space-y-1.5">
                  <Label htmlFor="client_number" className="text-integra-navy font-semibold">
                    N° Cliente
                  </Label>
                  <Input
                    id="client_number"
                    value={formData.client_number}
                    readOnly
                    aria-readonly
                    tabIndex={-1}
                    placeholder="Se asignará al guardar"
                    className="min-h-[48px] font-mono text-lg font-bold border-integra-gold/30 bg-gray-100 text-integra-navy cursor-not-allowed focus-visible:ring-0"
                  />
                  <p className="text-xs text-integra-navy/70">
                    El sistema asignará este número automáticamente al guardar.
                  </p>
                </div>
              )}

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

              {/* Datos fiscales para Facturación Electrónica (DGI) */}
              <div className="space-y-1.5">
                <Label htmlFor="tipo_receptor_fe">Tipo de receptor FE</Label>
                <select
                  id="tipo_receptor_fe"
                  value={formData.tipo_receptor_fe}
                  onChange={set("tipo_receptor_fe")}
                  className="w-full min-h-[48px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— Seleccionar —</option>
                  {TIPO_RECEPTOR_FE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">
                  Para facturación electrónica ante la DGI.
                </p>
                {fieldErrors.tipo_receptor_fe && (
                  <p className="text-xs text-red-500">{fieldErrors.tipo_receptor_fe}</p>
                )}
              </div>

              {tipoRequiresDV(formData.tipo_receptor_fe) && (
                <div className="space-y-1.5">
                  <Label htmlFor="digito_verificador">
                    Dígito verificador (DV) <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="digito_verificador"
                    value={formData.digito_verificador}
                    onChange={set("digito_verificador")}
                    placeholder="Ej. 40"
                    inputMode="numeric"
                    maxLength={2}
                    className="min-h-[48px] w-24"
                  />
                  <p className="text-xs text-gray-500">
                    DV que asigna la DGI al RUC (2 dígitos). Aparece por separado
                    en la ficha RUC de la DGI, no dentro del número de RUC.
                  </p>
                  {fieldErrors.digito_verificador && (
                    <p className="text-xs text-red-500">{fieldErrors.digito_verificador}</p>
                  )}
                </div>
              )}

              {lawyers.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="responsible_lawyer_id">Abogada Responsable</Label>
                  <select
                    id="responsible_lawyer_id"
                    value={formData.responsible_lawyer_id}
                    onChange={set("responsible_lawyer_id")}
                    className="w-full min-h-[48px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">— Sin abogada responsable —</option>
                    {lawyers.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              )}
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
