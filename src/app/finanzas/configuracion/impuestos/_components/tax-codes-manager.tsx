"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatTaxRate,
  parseTaxRatePercent,
  type TaxCodeRow,
} from "@/lib/finanzas/types/tax-code";

interface Props {
  taxCodes: TaxCodeRow[];
  /**
   * Quién puede editar Y crear: admin y contador. La abogada entra a mirar.
   *
   * Es el mismo set que `ROLES_ESCRITURA` en las dos rutas de `/api`. Si alguna
   * vez se amplía hay que mover los tres juntos — ocultar el botón no reemplaza
   * al 403, y el 403 no reemplaza a ocultar el botón.
   */
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

  // ---- alta de una tasa (2.4) ---------------------------------------------
  const [creando, setCreando] = useState(false);
  const [nuevoCodigo, setNuevoCodigo] = useState("");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoPct, setNuevoPct] = useState("");
  const [errorAlta, setErrorAlta] = useState<string | null>(null);

  /**
   * Lo que se va a guardar, calculado en vivo mientras se escribe (D7).
   *
   * La persona piensa en "7%" y la base guarda `0.0700`. Mostrar las dos cosas
   * al mismo tiempo es lo que evita que alguien cargue 700% — el servidor lo
   * rechaza igual, pero un rechazo después de completar el formulario enseña
   * menos que ver el decimal mientras se escribe.
   */
  const decimalNuevo = parseTaxRatePercent(nuevoPct);

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

  function abrirAlta() {
    setCreando(true);
    setNuevoCodigo("");
    setNuevoNombre("");
    setNuevoPct("");
    setErrorAlta(null);
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (decimalNuevo === null) {
      setErrorAlta("La tasa se escribe como porcentaje: 7 para 7%, 7.5 para 7.5%.");
      return;
    }
    setGuardando(true);
    setErrorAlta(null);
    try {
      const res = await fetch("/api/finanzas/configuracion/tax-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: nuevoCodigo.trim().toUpperCase(),
          name: nuevoNombre.trim(),
          rate: decimalNuevo,
          active: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const campos = data?.errors as Record<string, string> | undefined;
        setErrorAlta(
          campos?.code ?? campos?.name ?? campos?.rate ?? data?.error ?? "No se pudo crear la tasa."
        );
        return;
      }
      setCreando(false);
      router.refresh();
    } catch {
      setErrorAlta("No se pudo conectar con el servidor.");
    } finally {
      setGuardando(false);
    }
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
    <div className="space-y-3">
      {/* ---- Alta de una tasa (2.4) ---- */}
      {canEdit && !creando && (
        <Button type="button" variant="outline" onClick={abrirAlta} className="gap-1.5">
          <Plus size={16} />
          Nueva tasa
        </Button>
      )}

      {canEdit && creando && (
        <form
          onSubmit={crear}
          className="rounded-lg border border-gray-200 bg-white p-4 space-y-3"
        >
          <h3 className="text-sm font-semibold text-integra-navy">Nueva tasa</h3>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="nuevo-codigo" className="mb-1 block text-xs font-medium text-gray-700">
                Código
              </label>
              <Input
                id="nuevo-codigo"
                value={nuevoCodigo}
                onChange={(e) => setNuevoCodigo(e.target.value.toUpperCase())}
                placeholder="ITBMS_10"
                disabled={guardando}
                className="font-mono"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                Mayúsculas, números y guión bajo. No se puede cambiar después.
              </p>
            </div>

            <div>
              <label htmlFor="nuevo-nombre" className="mb-1 block text-xs font-medium text-gray-700">
                Nombre
              </label>
              <Input
                id="nuevo-nombre"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                placeholder="ITBMS 10%"
                disabled={guardando}
              />
            </div>

            <div>
              <label htmlFor="nuevo-pct" className="mb-1 block text-xs font-medium text-gray-700">
                Tasa (%)
              </label>
              <Input
                id="nuevo-pct"
                value={nuevoPct}
                onChange={(e) => setNuevoPct(e.target.value)}
                placeholder="10"
                inputMode="decimal"
                disabled={guardando}
                className="text-right font-mono"
              />
              {/* 🔴 D7 — se escribe el PORCENTAJE y se muestra el decimal que se
                  guarda. Las dos cosas a la vez: es lo que evita cargar 700%. */}
              <p className="mt-1 text-[11px] text-gray-500">
                {nuevoPct.trim() === "" ? (
                  "Se escribe en porcentaje: 10 para 10%."
                ) : decimalNuevo === null ? (
                  <span className="text-red-600">No es un número.</span>
                ) : decimalNuevo > 1 ? (
                  <span className="text-red-600">
                    {formatTaxRate(decimalNuevo)} — no puede superar el 100%.
                  </span>
                ) : (
                  <>
                    Se guarda como{" "}
                    <strong className="font-mono">{decimalNuevo.toFixed(4)}</strong> ={" "}
                    {formatTaxRate(decimalNuevo)}
                  </>
                )}
              </p>
            </div>
          </div>

          {errorAlta && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{errorAlta}</p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={guardando} className="gap-1.5">
              <Check size={16} />
              Crear tasa
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreando(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
          </div>

          <p className="text-[11px] text-gray-500">
            La tasa nueva aparece sola en los selectores de facturas, compras y gastos de
            trámite, y su ITBMS va a <span className="font-mono">200003</span> como las demás.
            Una tasa no se borra: se desactiva.
          </p>
        </form>
      )}

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
    </div>
  );
}
