"use client";

import { useState, useEffect } from "react";
import { User, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientCombobox } from "@/components/finanzas/client-combobox";
import type { ClientOption } from "@/lib/finanzas/types/invoice";
import type { NewProspectInput } from "@/lib/finanzas/types/quote";

export type ClientSelectorMode = "existing" | "new";

export interface ClientSelectorValue {
  mode: ClientSelectorMode;
  client_id?: string;
  new_prospect?: NewProspectInput;
}

interface Props {
  clients: ClientOption[];
  initialMode?: ClientSelectorMode;
  initialClientId?: string | null;
  initialProspect?: NewProspectInput | null;
  /** Errores del form padre, prefijados con "client_id", "new_prospect.<field>". */
  errors?: Record<string, string>;
  onChange: (value: ClientSelectorValue) => void;
  disabled?: boolean;
}

/**
 * Toggle "Cliente existente" / "Crear prospecto nuevo" (D1).
 *
 * - Radio visible siempre con las dos secciones.
 * - La sección NO activa se ve disabled/grayed.
 * - Cuando es "existente": ClientCombobox buscable.
 * - Cuando es "nuevo": form inline con name + email + phone + client_type.
 *
 * El componente NO valida — solo emite eventos. La validación final ocurre
 * en validateCreateQuote() server-side. Mostramos los errores que el padre
 * nos pasa (post-submit), prefijados con "new_prospect.<field>" según el
 * shape que retorna la API.
 */
export function ClientSelectorToggle({
  clients,
  initialMode = "existing",
  initialClientId = null,
  initialProspect = null,
  errors = {},
  onChange,
  disabled,
}: Props) {
  const [mode, setMode] = useState<ClientSelectorMode>(initialMode);
  const [clientId, setClientId] = useState<string | null>(initialClientId);

  const [name, setName] = useState(initialProspect?.name ?? "");
  const [email, setEmail] = useState(initialProspect?.email ?? "");
  const [phone, setPhone] = useState(initialProspect?.phone ?? "");
  const [clientType, setClientType] = useState<NewProspectInput["client_type"] | "">(
    initialProspect?.client_type ?? ""
  );

  // Propagar al padre cada cambio de cualquier campo
  useEffect(() => {
    if (mode === "existing") {
      onChange({ mode, client_id: clientId ?? undefined });
    } else {
      onChange({
        mode,
        new_prospect: {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          client_type: (clientType || "persona_natural") as NewProspectInput["client_type"],
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, clientId, name, email, phone, clientType]);

  const existingActive = mode === "existing";
  const newActive = mode === "new";

  // Cuando el cliente NO existe en el catálogo activo (porque está en
  // status='prospect') pero su id viene como initial, igual permitimos
  // seleccionarlo en el combobox a través del lookup. El combobox tolera
  // un value que no esté en clients[] (renderiza placeholder) — para
  // editar borradores existentes simplemente mantenemos el id.

  return (
    <div className="space-y-3">
      <Label className="block">Cliente *</Label>

      {/* Sección "Cliente existente" */}
      <div
        className={`rounded-lg border transition-colors ${
          existingActive ? "border-integra-navy bg-white" : "border-gray-200 bg-gray-50"
        }`}
      >
        <label
          className={`flex cursor-pointer items-center gap-3 px-4 py-3 ${
            disabled ? "opacity-50" : ""
          }`}
        >
          <input
            type="radio"
            name="client_selector_mode"
            value="existing"
            checked={existingActive}
            onChange={() => setMode("existing")}
            disabled={disabled}
            className="h-4 w-4 accent-integra-navy"
          />
          <User
            size={18}
            className={existingActive ? "text-integra-navy" : "text-gray-400"}
          />
          <span
            className={`text-sm font-medium ${
              existingActive ? "text-integra-navy" : "text-gray-500"
            }`}
          >
            Cliente existente
          </span>
        </label>
        {existingActive && (
          <div className="border-t px-4 py-3" data-error={!!errors.client_id}>
            <ClientCombobox
              clients={clients}
              value={clientId}
              onChange={(id) => setClientId(id)}
              error={errors.client_id}
              disabled={disabled}
            />
            <p className="mt-2 text-xs text-gray-500">
              Solo se muestran clientes en estado activo o prospecto.
            </p>
          </div>
        )}
      </div>

      {/* Sección "Crear prospecto nuevo" */}
      <div
        className={`rounded-lg border transition-colors ${
          newActive ? "border-integra-navy bg-white" : "border-gray-200 bg-gray-50"
        }`}
      >
        <label
          className={`flex cursor-pointer items-center gap-3 px-4 py-3 ${
            disabled ? "opacity-50" : ""
          }`}
        >
          <input
            type="radio"
            name="client_selector_mode"
            value="new"
            checked={newActive}
            onChange={() => setMode("new")}
            disabled={disabled}
            className="h-4 w-4 accent-integra-navy"
          />
          <UserPlus
            size={18}
            className={newActive ? "text-integra-gold" : "text-gray-400"}
          />
          <span
            className={`text-sm font-medium ${
              newActive ? "text-integra-navy" : "text-gray-500"
            }`}
          >
            Crear prospecto nuevo
          </span>
        </label>
        {newActive && (
          <div className="border-t px-4 py-4 space-y-3">
            <p className="text-xs text-gray-500">
              Datos mínimos para empezar. El prospecto se guarda con estado
              <span className="mx-1 font-mono">prospect</span>; para emitir
              facturas hay que completar los datos fiscales después.
            </p>

            <div data-error={!!errors["new_prospect.name"]}>
              <Label className="mb-1 block">Nombre o razón social *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Juan Pérez / Constructora ABC, S.A."
                disabled={disabled}
                className={errors["new_prospect.name"] ? "border-red-300" : ""}
              />
              {errors["new_prospect.name"] && (
                <p className="mt-1 text-xs text-red-600">
                  {errors["new_prospect.name"]}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div data-error={!!errors["new_prospect.email"]}>
                <Label className="mb-1 block">Email *</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cliente@ejemplo.com"
                  disabled={disabled}
                  className={errors["new_prospect.email"] ? "border-red-300" : ""}
                />
                {errors["new_prospect.email"] && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors["new_prospect.email"]}
                  </p>
                )}
              </div>

              <div>
                <Label className="mb-1 block">Teléfono (opcional)</Label>
                <Input
                  type="tel"
                  value={phone ?? ""}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="6000-0000"
                  disabled={disabled}
                />
              </div>
            </div>

            <div data-error={!!errors["new_prospect.client_type"]}>
              <Label className="mb-1 block">Tipo de persona *</Label>
              <div className="flex rounded-md border border-gray-300 bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => setClientType("persona_natural")}
                  disabled={disabled}
                  className={`flex-1 min-h-[44px] text-sm font-medium transition-colors ${
                    clientType === "persona_natural"
                      ? "bg-integra-navy text-white"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Persona natural
                </button>
                <button
                  type="button"
                  onClick={() => setClientType("persona_juridica")}
                  disabled={disabled}
                  className={`flex-1 min-h-[44px] text-sm font-medium border-l transition-colors ${
                    clientType === "persona_juridica"
                      ? "bg-integra-navy text-white"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Persona jurídica
                </button>
              </div>
              {errors["new_prospect.client_type"] && (
                <p className="mt-1 text-xs text-red-600">
                  {errors["new_prospect.client_type"]}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
