"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatTaxRate,
  parseTaxRatePercent,
  type TaxCodeRow,
} from "@/lib/finanzas/types/tax-code";

interface Props {
  taxCodes: TaxCodeRow[];
  /** Solo el admin edita. El contador entra a mirar. */
  canEdit: boolean;
}

/**
 * Tabla del catálogo de impuestos, con edición en línea de la tasa.
 *
 * El campo se escribe en PORCENTAJE ("7", "7.5"), no en decimal, porque es como
 * lo dice cualquiera que trabaje con impuestos. La conversión a 0.07 la hace
 * `parseTaxRatePercent`, y el validador del servidor rechaza cualquier cosa
 * mayor a 1 por si alguien manda el número crudo por API.
 */
export function TaxCodesManager({ taxCodes, canEdit }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [valorPct, setValorPct] = useState("");
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function empezar(t: TaxCodeRow) {
    setEditando(t.id);
    setValorPct(String(Number((Number(t.rate) * 100).toFixed(4))));
    setNombre(t.name);
    setError(null);
  }

  function cancelar() {
    setEditando(null);
    setError(null);
  }

  async function guardar(t: TaxCodeRow) {
    const rate = parseTaxRatePercent(valorPct);
    if (rate === null) {
      setError("La tasa se escribe como porcentaje: 7 para 7%, 7.5 para 7.5%.");
      return;
    }
    if (rate > 1) {
      setError("La tasa no puede superar el 100%.");
      return;
    }
    if (nombre.trim().length < 2) {
      setError("El nombre no puede quedar vacío.");
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/finanzas/configuracion/tax-codes/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rate, name: nombre.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data?.fieldErrors?.rate ?? data?.error ?? "No se pudo guardar el cambio."
        );
        return;
      }
      setEditando(null);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-2 text-left font-semibold text-gray-600">Código</th>
            <th className="px-4 py-2 text-left font-semibold text-gray-600">Nombre</th>
            <th className="px-4 py-2 text-right font-semibold text-gray-600">Tasa</th>
            <th className="px-4 py-2 text-center font-semibold text-gray-600">Estado</th>
            {canEdit && <th className="px-4 py-2 text-right font-semibold text-gray-600" />}
          </tr>
        </thead>
        <tbody>
          {taxCodes.map((t) => {
            const enEdicion = editando === t.id;
            return (
              <tr key={t.id} className="border-b last:border-0">
                <td className="px-4 py-3 font-mono text-gray-700">{t.code}</td>
                <td className="px-4 py-3">
                  {enEdicion ? (
                    <Input
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      disabled={guardando}
                      className="max-w-[220px]"
                      aria-label={`Nombre de ${t.code}`}
                    />
                  ) : (
                    t.name
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {enEdicion ? (
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        value={valorPct}
                        onChange={(e) => setValorPct(e.target.value)}
                        disabled={guardando}
                        inputMode="decimal"
                        className="w-24 text-right"
                        aria-label={`Tasa de ${t.code} en porcentaje`}
                      />
                      <span className="text-gray-500">%</span>
                    </div>
                  ) : (
                    <span className="font-mono">{formatTaxRate(t.rate)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={
                      "inline-block rounded-full px-2 py-0.5 text-xs font-medium " +
                      (t.active
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-600")
                    }
                  >
                    {t.active ? "Activo" : "Inactivo"}
                  </span>
                </td>
                {canEdit && (
                  <td className="px-4 py-3 text-right">
                    {enEdicion ? (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => guardar(t)}
                          disabled={guardando}
                        >
                          <span className="flex items-center gap-1">
                            <Check size={14} /> Guardar
                          </span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={cancelar}
                          disabled={guardando}
                        >
                          <span className="flex items-center gap-1">
                            <X size={14} /> Cancelar
                          </span>
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => empezar(t)}
                      >
                        <span className="flex items-center gap-1">
                          <Pencil size={14} /> Editar
                        </span>
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {error && (
        <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
