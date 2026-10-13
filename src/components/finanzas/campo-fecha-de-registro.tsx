"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PERMITIR_FECHA_DE_REGISTRO_FUTURA } from "@/lib/finanzas/contabilidad/fecha-de-registro";
import { hoyEnPanama } from "@/lib/utils/hoy-en-panama";

/**
 * EL CAMPO «FECHA DE REGISTRO». Uno solo para todo el módulo: documentos,
 * notas de crédito, reversiones y anulaciones.
 *
 * La fecha de registro es la contable (la del asiento): define el período. La
 * pantalla propone hoy en Panamá; el contador la puede cambiar, siempre a un
 * mes abierto (revisión de Josuarth del 28/09/2026 y reunión del 30/09/2026).
 * El período lo valida el servidor, que es quien tiene la base delante: acá
 * sólo se acotan el mínimo (una reversión no va antes de su original) y, si la
 * llave lo prohíbe, el futuro.
 */
export function CampoFechaDeRegistro({
  id,
  value,
  onChange,
  min,
  error,
  disabled,
  ayuda,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** `YYYY-MM-DD`: la fecha no puede ser anterior (la del asiento que se revierte). */
  min?: string;
  error?: string | null;
  disabled?: boolean;
  /** Texto de ayuda propio. Por defecto explica qué es la fecha de registro. */
  ayuda?: string;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-sm">
        Fecha de registro{" "}
        <span className="text-red-600" aria-hidden="true">
          *
        </span>
      </Label>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        min={min}
        max={PERMITIR_FECHA_DE_REGISTRO_FUTURA ? undefined : hoyEnPanama()}
        className="mt-1 min-h-[48px]"
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-ayuda`}
      />
      <p id={`${id}-ayuda`} className={`mt-1 text-xs ${error ? "text-red-600" : "text-gray-500"}`}>
        {error ??
          ayuda ??
          "Es la fecha contable: define el mes en que entra al libro. Tiene que caer en un período abierto."}
      </p>
    </div>
  );
}
