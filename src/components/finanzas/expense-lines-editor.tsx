"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { fmtImporte } from "@/lib/utils/importe";
import { Button } from "@/components/ui/button";
import {
  impuestoSugerido,
  totalesDeLineas,
  type ExpenseLineDraft,
} from "@/lib/finanzas/types/expense-line";
import type { TaxCodeOption } from "@/lib/finanzas/types/invoice";
import { TaxCodeSelect } from "@/components/finanzas/tax-code-select";
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
   * 🔴 OBLIGATORIA, Y SIN VALOR POR DEFECTO A PROPÓSITO.
   *
   * Cuenta precargada en una línea nueva. En gastos de trámite es `130003`
   * (decisión del acta del 25/08); en **compras es cadena vacía**: no hay una
   * cuenta plausible para una compra del bufete, así que el selector arranca
   * vacío y obliga a elegir.
   *
   * Tenía `= CUENTA_TRAMITE_DEFAULT` como default del componente, y compras
   * —que no lo pasaba— heredó `130003 · Fondo Legales de Clientes` en cada
   * línea agregada. Esa es la cuenta de lo que las licenciadas adelantan POR UN
   * CLIENTE, no la de una compra del bufete: se guardaba mal, con apariencia de
   * dato elegido, y sin que nadie viera un error. Se detectó el 10/09/2026.
   *
   * Sin default, un módulo nuevo no puede heredar el de otro por descuido:
   * tiene que decir cuál quiere.
   */
  cuentaPorDefecto: string;
  /**
   * Los códigos de `tax_codes` activos del bufete, cargados server-side con
   * `listTaxCodesActive` — los MISMOS que ve el formulario de facturación, en
   * el MISMO `TaxCodeSelect`. Es lo que Josuarth pidió el 25/08 y el 10/09:
   * que cada línea vaya gravada o exenta "igual que en una factura".
   *
   * Hasta el 16/09/2026 las opciones salían de una lista fija en el código
   * (`OPCIONES_DE_IMPUESTO`), porque la línea no tenía dónde guardar cuál
   * código eligió. Desde la migración `045` tiene `tax_code_id`.
   */
  taxCodes: TaxCodeOption[];
  /**
   * Código precargado en una línea nueva, por `code` de `tax_codes`. Trámite
   * pasa `"EXENTO"` (el ITBMS de un adelanto es pass-through); compras pasa
   * `"ITBMS_7"`, como `makeEmptyLine` en facturación. Si el código no está en
   * `taxCodes` la línea arranca sin impuesto elegido y el validador lo pide.
   */
  impuestoPorDefecto: string;
  /** Errores del validador, con clave `lineas.{i}.{campo}`. */
  errors?: Record<string, string>;
  disabled?: boolean;
  /** Símbolo de moneda para los encabezados. */
  moneda?: string;
  /**
   * Totales al pie del editor. En gastos de trámite es el único lugar donde se
   * ven, así que van. En compras el formulario ya tiene su propio bloque al
   * final y quedaban DOS, con nombres distintos para lo mismo.
   */
  mostrarTotales?: boolean;
}

export function ExpenseLinesEditor({
  lineas,
  onChange,
  cuentas,
  cuentaPorDefecto,
  taxCodes,
  impuestoPorDefecto,
  errors = {},
  disabled = false,
  moneda = "B/.",
  mostrarTotales = true,
}: Props) {
  /**
   * LAS HABITUALES ARRIBA, EL RESTO ABAJO — EN EL MISMO DESPLEGABLE.
   *
   * ═════════════════════════════════════════════════════════════════════════
   * POR QUÉ DEJÓ DE HABER UN FILTRO
   * ═════════════════════════════════════════════════════════════════════════
   * Hasta el 10/09/2026 el selector mostraba SOLO las siete habituales y el
   * resto vivía detrás de un botón «Ver todas las cuentas», que estaba abajo
   * del todo, al lado de «Agregar línea». Oliver estuvo buscando cuentas que
   * existían y no las encontraba hasta que bajó de casualidad.
   *
   * El problema no era la lista corta: era que el control que la ampliaba
   * estaba lejos del campo y no se veía. Un `<optgroup>` resuelve las dos
   * cosas a la vez — las siete probables quedan primero, y las demás están
   * ahí mismo, a un scroll del mismo desplegable.
   *
   * 🔴 La lista corta NO se abandonó, se reubicó. Existe por un error real: el
   *    03/09/2026 se clasificó un honorario de gestor externo contra
   *    `610002 Honorarios Profesionales` en vez de `500004 Honorarios
   *    Profesionales Externos` —se llaman casi igual y sólo una es de costo—.
   *    Con 64 opciones sueltas ese error es cuestión de tiempo; con siete
   *    arriba y un encabezado que las separa, hay que ignorarlas para
   *    equivocarse.
   */
  const sugeridas = useMemo(() => cuentasSugeridasParaTramite(cuentas), [cuentas]);
  const todas = useMemo(() => cuentasClasificables(cuentas), [cuentas]);
  const codigosSugeridos = useMemo(
    () => new Set(sugeridas.map((c) => c.code)),
    [sugeridas]
  );
  const resto = useMemo(
    () => todas.filter((c) => !codigosSugeridos.has(c.code)),
    [todas, codigosSugeridos]
  );

  const impuestoInicial = useMemo(() => {
    const tc = taxCodes.find((t) => t.code === impuestoPorDefecto);
    return tc ? { id: tc.id, rate: tc.rate } : null;
  }, [taxCodes, impuestoPorDefecto]);

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
    onChange([...lineas, lineaVacia(`l${Date.now()}`, cuentaPorDefecto, impuestoInicial)]);
  }

  function quitar(i: number) {
    // La última no se borra: se limpia. Un gasto sin líneas no es un estado útil.
    if (lineas.length === 1) {
      onChange([lineaVacia(lineas[0].key, cuentaPorDefecto, impuestoInicial)]);
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
          // `data-error` es lo que busca el `scrollIntoView` del formulario al
          // rechazar. Sin esto la pantalla no se movía y el borde rojo podía
          // quedar fuera de la vista.
          const hayErrorEnLinea = Object.keys(errors).some((k) =>
            k.startsWith(`lineas.${i}.`)
          );
          return (
            <div
              key={linea.key}
              data-error={hayErrorEnLinea || undefined}
              className={
                "rounded-lg border bg-gray-50/50 p-3 " +
                (hayErrorEnLinea ? "border-red-300" : "border-gray-200")
              }
            >
              <div className="mb-2 flex items-center justify-end">
                {/* Sin rótulo "Línea N": lo pidió Josuarth el 09/09/2026 —«esa
                línea 1, línea 2, yo eliminaría eso, y simplemente las líneas»—.
                El número seguía en el `aria-label` del botón de borrar, que es
                donde hace falta: sin él, un lector de pantalla anuncia varios
                «Quitar» idénticos y no se sabe cuál fila se borra. */}
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
                    {sugeridas.length > 0 && (
                      <optgroup label="Habituales">
                        {sugeridas.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} · {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {resto.length > 0 && (
                      <optgroup label={`Todas las cuentas (${todas.length})`}>
                        {resto.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} · {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {e("chart_account_code") && (
                    <p className="mt-1 text-xs text-red-600">{e("chart_account_code")}</p>
                  )}
                </div>

                {/* Base */}
                <div className="sm:col-span-1">
                  <Label className="mb-1 block text-xs">Base ({moneda})</Label>
                  <MoneyInput
                    value={linea.amount}
                    onChange={(ev) => actualizar(i, { amount: ev.target.value })}
                    placeholder="0.00"
                    disabled={disabled}
                    className={"min-h-[44px] " + (e("amount") ? "border-red-300" : "")}
                  />
                  {e("amount") && <p className="mt-1 text-xs text-red-600">{e("amount")}</p>}
                </div>

                {/* Impuesto — el MISMO componente y los MISMOS códigos que
                    facturación (`TaxCodeSelect` + `tax_codes`). Al elegir se
                    guardan el id y el snapshot de la tasa; el ITBMS se
                    recalcula desde `actualizar`. El servidor vuelve a
                    resolver la tasa contra el catálogo: acá es para mostrar. */}
                <div className="sm:col-span-2">
                  <Label className="mb-1 block text-xs">Impuesto</Label>
                  <TaxCodeSelect
                    taxCodes={taxCodes}
                    value={linea.tax_code_id}
                    onChange={(id, tc) =>
                      actualizar(i, {
                        tax_code_id: id,
                        tax_rate: tc ? String(tc.rate) : linea.tax_rate,
                      })
                    }
                    error={e("tax_code_id") ?? e("tax_rate")}
                    disabled={disabled}
                  />
                </div>

                {/* ITBMS — autocompletado, editable */}
                <div className="sm:col-span-1">
                  <Label className="mb-1 block text-xs">ITBMS</Label>
                  <MoneyInput
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
      </div>

      {/* Totales — los mismos que calcula el validador y la base */}
      {mostrarTotales && (
        <div className="rounded-lg border border-integra-navy/20 bg-integra-navy/5 p-3">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-600">Base</dt>
              <dd className="tabular-nums text-gray-900">
                {moneda} {fmtImporte(totales.base)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">ITBMS</dt>
              <dd className="tabular-nums text-gray-900">
                {moneda} {fmtImporte(totales.impuesto)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-integra-navy/15 pt-1 font-semibold">
              <dt className="text-integra-navy">Total</dt>
              <dd className="tabular-nums text-integra-navy">
                {moneda} {fmtImporte(totales.total)}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
