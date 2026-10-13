"use client";

import { Send, FileLock2 } from "lucide-react";

export type ModoDeEnvio = "dgi" | "interna";

/**
 * «Enviar a la DGI» o «Interna (no se envía)», al emitir una NC o una ND
 * (03/10/2026). No viene marcada: es una decisión fiscal y se elige a
 * propósito. La interna postea en el libro igual y queda marcada para siempre
 * (083): después no se puede mandar.
 */
export function SelectorDeEnvio({
  valor,
  onChange,
  disabled,
  error,
  nombre,
}: {
  valor: ModoDeEnvio | null;
  onChange: (v: ModoDeEnvio) => void;
  disabled?: boolean;
  error?: string;
  /** «nota de crédito» / «nota de débito». */
  nombre: string;
}) {
  const opcion = (v: ModoDeEnvio, titulo: string, detalle: string, Icono: typeof Send) => (
    <label
      className={`flex min-h-[48px] cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
        valor === v ? "border-integra-navy bg-integra-navy/5" : "border-gray-300 bg-white"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type="radio"
        name="envio"
        value={v}
        checked={valor === v}
        onChange={() => onChange(v)}
        disabled={disabled}
        className="mt-1"
      />
      <Icono size={16} className="mt-0.5 shrink-0 text-integra-navy" />
      <span>
        <span className="block font-semibold text-integra-navy">{titulo}</span>
        <span className="block text-gray-600">{detalle}</span>
      </span>
    </label>
  );
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium text-gray-900">¿Se envía a la DGI? *</legend>
      {opcion("dgi", "Enviar a la DGI", `Se emite la ${nombre} y en seguida se manda al proveedor de facturación electrónica.`, Send)}
      {opcion(
        "interna",
        "Interna (no se envía)",
        `Se emite la ${nombre} y se registra en el libro igual, pero no se manda a la DGI. Después no se puede enviar.`,
        FileLock2
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </fieldset>
  );
}
