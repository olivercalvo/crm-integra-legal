"use client";

import { useMemo, useState } from "react";
import { ListFilter, Plus, Trash2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import {
  CUENTA_TRAMITE_DEFAULT,
  impuestoSugerido,
  totalesDeLineas,
  type ExpenseLineDraft,
} from "@/lib/finanzas/types/expense-line";
import { lineaVacia } from "@/lib/finanzas/validators/expense-line";
import {
  cuentasClasificables,
  cuentasSugeridasParaTramite,
} from "@/lib/finanzas/contabilidad/cuentas-de-gasto";
import type { AccountType } from "@/lib/finanzas/types/chart-of-account";

/**
 * EDITOR DE LÍNEAS DE GASTO — compartido por gastos de trámite y compras.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ES EL MISMO COMPONENTE PARA LOS DOS MÓDULOS, Y ESO ES EL PUNTO
 * ═════════════════════════════════════════════════════════════════════════════
 * Josuar pidió el 25/08 que el módulo de compras tenga "el mismo formulario" que
 * gastos de trámite. Este archivo es la parte que lo cumple literalmente: recibe
 * las líneas y las devuelve, sin saber a qué documento cuelgan.
 *
 * No conoce `expenses` ni `business_expenses`, no hace fetch y no valida al
 * guardar — de eso se encarga `validators/expense-line.ts`, que corre también en
 * el servidor. Acá solo se editan filas y se muestran los totales.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DECISIONES DE UX QUE NO SON OBVIAS
 * ─────────────────────────────────────────────────────────────────────────────
 * · **Todo se guarda como string mientras se escribe.** Convertir a número en
 *   cada tecla hace que "1." o "0,0" desaparezcan a mitad de tipeo. La
 *   conversión pasa una sola vez, al validar.
 *
 * · **El ITBMS se autocompleta pero NO se bloquea.** Al cambiar la base o la
 *   tasa se recalcula; si la persona lo edita a mano, se respeta. El comprobante
 *   manda: un proveedor puede redondear distinto y el validador acepta ±0,02.
 *
 * · **La cuenta viene precargada y editable.** Regla de Rose: ningún campo de
 *   cuenta se cierra por completo. El default es un parámetro (`cuentaPorDefecto`)
 *   porque en compras NO es `130003` — ahí es la cuenta de gasto o costo que
 *   elija el usuario.
 *
 * · **Mobile-first.** En pantalla chica cada línea es una tarjeta apilada, no una
 *   fila de tabla con scroll horizontal; los controles respetan los 48px de
 *   touch target de CLAUDE.md.
 *
 * · **La última línea no se puede borrar.** Un gasto sin ninguna línea no es un
 *   estado útil, y "borrar la última" es siempre un accidente. Se limpia, no se
 *   elimina.
 */

export interface CuentaOption {
  code: string;
  name: string;
  /**
   * Hace falta para armar la lista corta y para no ofrecer una cuenta que el
   * servidor va a rechazar. Ver `contabilidad/cuentas-de-gasto.ts`.
   */
  account_type: AccountType;
}

interface Props {
  lineas: ExpenseLineDraft[];
  onChange: (lineas: ExpenseLineDraft[]) => void;
  /** Cuentas del plan que se pueden elegir. */
  cuentas: CuentaOption[];
  /**
   * Cuenta precargada en una línea nueva. En gastos de trámite es `130003`
   * (decisión del acta); en compras la define ese módulo.
   */
  cuentaPorDefecto?: string;
  /** Errores del validador, con clave `lineas.{i}.{campo}`. */
  errors?: Record<string, string>;
  disabled?: boolean;
  /** Símbolo de moneda para los encabezados. */
  moneda?: string;
}

export function ExpenseLinesEditor({
  lineas,
  onChange,
  cuentas,
  cuentaPorDefecto = CUENTA_TRAMITE_DEFAULT,
  errors = {},
  disabled = false,
  moneda = "B/.",
}: Props) {
  /**
   * El selector arranca con las SIETE que tienen sentido para un gasto de
   * trámite, no con las 64 del plan.
   *
   * El 03/09/2026 se clasificó un honorario de gestor externo contra
   * `610002 Honorarios Profesionales` en vez de `500004 Honorarios Profesionales
   * Externos` — se llaman casi igual y solo una es de costo. Lo hizo alguien que
   * acababa de diseñar este modelo. Con 64 opciones el error es cuestión de
   * tiempo; con siete, hay que buscarlo.
   *
   * "Ver todas" existe porque el caso raro es REAL —una abogada que viaja a una
   * audiencia va a `610018 Gastos de viajes`— pero cuesta un clic más que lo
   * probable, que es como tiene que ser.
   */
  const [verTodas, setVerTodas] = useState(false);
  const sugeridas = useMemo(() => cuentasSugeridasParaTramite(cuentas), [cuentas]);
  const todas = useMemo(() => cuentasClasificables(cuentas), [cuentas]);
  const opciones = verTodas ? todas : sugeridas;

  const totales = useMemo(
    () =>
      totalesDeLineas(
        lineas.map((l) => ({
          amount: Number(l.amount.replace(",", ".")) || 0,
          tax_amount: Number(l.tax_amount.replace(",", ".")) || 0,
        }))
      ),
    [lineas]
  );

  function actualizar(i: number, cambios: Partial<ExpenseLineDraft>) {
    const copia = [...lineas];
    const linea = { ...copia[i], ...cambios };

    // El impuesto se recalcula SOLO cuando cambió la base o la tasa. Si lo que
    // cambió es el impuesto mismo, se respeta lo que escribió la persona.
    const tocoBaseOTasa = "amount" in cambios || "tax_rate" in cambios;
    if (tocoBaseOTasa) {
      const base = Number(linea.amount.replace(",", ".")) || 0;
      const tasa = Number(linea.tax_rate.replace(",", ".")) || 0;
      linea.tax_amount = impuestoSugerido(base, tasa).toFixed(2);
    }

    copia[i] = linea;
    onChange(copia);
  }

  function agregar() {
    onChange([...lineas, lineaVacia(`l${Date.now()}`, cuentaPorDefecto)]);
  }

  function quitar(i: number) {
    // La última no se borra: se limpia. Un gasto sin líneas no es un estado útil.
    if (lineas.length === 1) {
      onChange([lineaVacia(lineas[0].key, cuentaPorDefecto)]);
      return;
    }
    onChange(lineas.filter((_, j) => j !== i));
  }

  const errorGeneral = errors["lineas"];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold text-integra-navy">
          Detalle contable *
        </Label>
        <span className="text-xs text-gray-400">
          {lineas.length} {lineas.length === 1 ? "línea" : "líneas"}
        </span>
      </div>

      {/* La cuenta es obligatoria al crear aunque la columna sea NULLABLE: el
          NULL existe SOLO para los gastos históricos, que se cargaron cuando el
          sistema no la pedía. Decirlo acá evita que alguien vea un gasto viejo
          sin cuenta y suponga que es opcional. */}
      <p className="text-xs text-gray-500">
        Cada línea necesita su cuenta contable. Los gastos anteriores a esta pantalla
        pueden no tenerla —se cargaron antes de que el sistema la pidiera— pero un gasto
        nuevo no se guarda sin ella.
      </p>

      {errorGeneral && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorGeneral}
        </p>
      )}

      <div className="space-y-3">
        {lineas.map((linea, i) => {
          const e = (campo: string) => errors[`lineas.${i}.${campo}`];
          return (
            <div
              key={linea.key}
              className="rounded-lg border border-gray-200 bg-gray-50/50 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500">
                  Línea {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => quitar(i)}
                  disabled={disabled}
                  aria-label={`Quitar línea ${i + 1}`}
                  className="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                {/* Descripción */}
                <div className="sm:col-span-5">
                  <Label className="mb-1 block text-xs">Descripción</Label>
                  <Input
                    value={linea.description}
                    onChange={(ev) => actualizar(i, { description: ev.target.value })}
                    placeholder="Ej: Timbres fiscales"
                    disabled={disabled}
                    className={"min-h-[44px] " + (e("description") ? "border-red-300" : "")}
                  />
                  {e("description") && (
                    <p className="mt-1 text-xs text-red-600">{e("description")}</p>
                  )}
                </div>

                {/* Cuenta — precargada y editable (regla de Rose) */}
                <div className="sm:col-span-3">
                  <Label className="mb-1 block text-xs">Cuenta contable</Label>
                  <select
                    value={linea.chart_account_code}
                    onChange={(ev) =>
                      actualizar(i, { chart_account_code: ev.target.value })
                    }
                    disabled={disabled}
                    className={
                      "block w-full rounded-md border bg-white px-2 min-h-[44px] text-sm " +
                      "focus:border-integra-navy focus:outline-none " +
                      (e("chart_account_code") ? "border-red-300" : "border-gray-300")
                    }
                  >
                    <option value="">— Elija una —</option>
                    {opciones.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                  {e("chart_account_code") && (
                    <p className="mt-1 text-xs text-red-600">{e("chart_account_code")}</p>
                  )}
                </div>

                {/* Base */}
                <div className="sm:col-span-2">
                  <Label className="mb-1 block text-xs">Base ({moneda})</Label>
                  <NumberInput
                    min="0"
                    step="0.01"
                    value={linea.amount}
                    onChange={(ev) => actualizar(i, { amount: ev.target.value })}
                    placeholder="0.00"
                    disabled={disabled}
                    className={"min-h-[44px] " + (e("amount") ? "border-red-300" : "")}
                  />
                  {e("amount") && <p className="mt-1 text-xs text-red-600">{e("amount")}</p>}
                </div>

                {/* Tasa */}
                <div className="sm:col-span-1">
                  <Label className="mb-1 block text-xs">Tasa</Label>
                  <NumberInput
                    min="0"
                    max="1"
                    step="0.01"
                    value={linea.tax_rate}
                    onChange={(ev) => actualizar(i, { tax_rate: ev.target.value })}
                    disabled={disabled}
                    className={"min-h-[44px] " + (e("tax_rate") ? "border-red-300" : "")}
                  />
                  {e("tax_rate") && (
                    <p className="mt-1 text-xs text-red-600">{e("tax_rate")}</p>
                  )}
                </div>

                {/* ITBMS — autocompletado, editable */}
                <div className="sm:col-span-1">
                  <Label className="mb-1 block text-xs">ITBMS</Label>
                  <NumberInput
                    min="0"
                    step="0.01"
                    value={linea.tax_amount}
                    onChange={(ev) => actualizar(i, { tax_amount: ev.target.value })}
                    disabled={disabled}
                    className={"min-h-[44px] " + (e("tax_amount") ? "border-red-300" : "")}
                  />
                  {e("tax_amount") && (
                    <p className="mt-1 text-xs text-red-600">{e("tax_amount")}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={agregar}
          variant="ghost"
          disabled={disabled}
          className="min-h-[44px] text-integra-navy"
        >
          <Plus size={16} className="mr-1" />
          Agregar línea
        </Button>

        {todas.length > sugeridas.length && (
          <button
            type="button"
            onClick={() => setVerTodas((v) => !v)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md px-3 text-xs font-medium text-gray-500 hover:text-integra-navy"
          >
            <ListFilter size={14} />
            {verTodas
              ? `Ver solo las ${sugeridas.length} habituales`
              : `Ver todas las cuentas (${todas.length})`}
          </button>
        )}
      </div>

      {verTodas && (
        <p className="text-xs text-gray-500">
          Las habituales de un gasto de trámite son el fondo del cliente y las cuentas de
          costo. Las demás existen para casos puntuales —un viaje a una audiencia va a
          <span className="font-medium"> Gastos de viajes</span>— pero si dudás, es una de
          las habituales.
        </p>
      )}

      {/* Totales — los mismos que calcula el validador y la base */}
      <div className="rounded-lg border border-integra-navy/20 bg-integra-navy/5 p-3">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-600">Base</dt>
            <dd className="tabular-nums text-gray-900">
              {moneda} {totales.base.toFixed(2)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">ITBMS</dt>
            <dd className="tabular-nums text-gray-900">
              {moneda} {totales.impuesto.toFixed(2)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-integra-navy/15 pt-1 font-semibold">
            <dt className="text-integra-navy">Total</dt>
            <dd className="tabular-nums text-integra-navy">
              {moneda} {totales.total.toFixed(2)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
