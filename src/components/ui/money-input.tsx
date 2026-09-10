"use client";

import { forwardRef, useCallback, useState } from "react";
import type { ChangeEvent, ComponentProps, FocusEvent } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  formatearMonto,
  normalizarMonto,
  sanearMonto,
} from "@/lib/utils/monto-input";

/**
 * MoneyInput — EL campo de dinero del sistema. Uno solo, en todos los módulos.
 *
 * Josuarth lo notó el 09/09/2026: unos campos de monto mostraban las flechitas
 * de incremento y otros no. Eran dos implementaciones distintas conviviendo
 * —`<Input type="number">` crudo en unos lados, `NumberInput` en otros—, y la
 * demo la miran contadores, que ven esa clase de cosa.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ES `type="text"`, Y NO ES UN ATAJO
 * ═════════════════════════════════════════════════════════════════════════════
 * Un `type="number"` NO PUEDE mostrar separador de miles: el navegador
 * considera `"1,234.56"` un valor inválido y devuelve `""` en `e.target.value`,
 * o sea que el importe se pierde al escribirlo. Con `type="text"` +
 * `inputMode="decimal"` se conserva el teclado numérico del celular —el
 * proyecto es mobile-first— y además desaparecen las flechitas sin depender de
 * CSS por navegador.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ SALE POR `onChange`
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 SIEMPRE el valor canónico: sin separador de miles y con punto decimal, tal
 *    como lo entregaba el `type="number"` que reemplaza. Los formularios hacen
 *    `Number(...)` sobre eso. El `1,234.56` es sólo lo que se pinta cuando el
 *    campo no tiene el foco. Ver `lib/utils/monto-input.ts`.
 *
 * Para no tocar los llamadores existentes, `onChange` recibe un evento sintético
 * mínimo —`target.value`, `target.name`, `target.id`— que es lo único que leen.
 * En código nuevo conviene `onValueChange`, que es honesto sobre lo que pasa.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO REEMPLAZA A `NumberInput`
 * ─────────────────────────────────────────────────────────────────────────────
 * `NumberInput` se queda para lo numérico que NO es dinero: cantidades en
 * facturas y cotizaciones, y `tax_rate`, que lleva cuatro decimales (`0.0700`)
 * y se rompería con el recorte a dos de acá.
 */

type InputProps = ComponentProps<typeof Input>;

export interface MoneyInputProps
  extends Omit<InputProps, "type" | "value" | "onChange" | "inputMode"> {
  /**
   * Valor canónico: `"1234.56"`, nunca `"1,234.56"`. Vacío = sin cargar.
   *
   * Se acepta `number` porque las líneas de factura y de cotización guardan
   * `unit_price` como número, no como texto. Se convierte con `String()` y
   * `onChange` sigue emitiendo texto: es el llamador el que decide si lo vuelve
   * a pasar por `Number()`, como ya hacía con el `type="number"`.
   */
  value: string | number | null | undefined;
  /** Compatibilidad con los llamadores que ya existen. Recibe el canónico. */
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  /** La forma preferida en código nuevo. */
  onValueChange?: (valor: string) => void;
  /** Saldos de apertura y ajustes pueden ser negativos. El resto, no. */
  allowNegative?: boolean;
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(
  function MoneyInput(
    {
      value,
      onChange,
      onValueChange,
      onFocus,
      onBlur,
      allowNegative = false,
      className,
      ...rest
    },
    ref
  ) {
    const [enFoco, setEnFoco] = useState(false);
    const canonico = value === null || value === undefined ? "" : String(value);

    const emitir = useCallback(
      (el: HTMLInputElement, valor: string) => {
        onValueChange?.(valor);
        // Evento sintético mínimo. NO se muta el input real: hacerlo movería el
        // cursor al final en cada tecla.
        onChange?.({
          target: { value: valor, name: el.name, id: el.id },
          currentTarget: { value: valor, name: el.name, id: el.id },
        } as unknown as ChangeEvent<HTMLInputElement>);
      },
      [onChange, onValueChange]
    );

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="decimal"
        // `text-right` y `tabular-nums`: una columna de importes se lee por la
        // coma decimal, y con dígitos de ancho variable no alinea.
        // `className` va al final para que el llamador pueda seguir ajustando
        // alto y borde de error como hasta ahora.
        className={cn("text-right tabular-nums", className)}
        value={enFoco ? canonico : formatearMonto(canonico)}
        onChange={(e) => emitir(e.currentTarget, sanearMonto(e.currentTarget.value, allowNegative))}
        onFocus={(e: FocusEvent<HTMLInputElement>) => {
          const el = e.currentTarget;
          setEnFoco(true);

          // ⚠️ SINCRÓNICO, Y NO ES UN DETALLE DE ESTILO.
          //
          // Al enfocar, el texto pasa de `1,234.56` a `1234.56`, así que hay
          // que seleccionarlo todo: si no, quien escribe encima de un campo que
          // dice `0.00` termina con el cero viejo pegado a lo que tecleó —un
          // `1500` sobre un `0.00` se guardaba como `15000`—.
          //
          // La primera versión lo hacía en `requestAnimationFrame`, esperando al
          // repintado. **rAF no dispara en una pestaña oculta**, así que el
          // seleccionar-todo simplemente no ocurría y el importe quedaba mal.
          // Se vio en la verificación del 10/09 contra el deploy.
          //
          // Acá se escribe el valor canónico a mano ANTES de seleccionar. Es la
          // misma cadena que React va a pintar en el render siguiente, así que
          // la reconciliación no toca el `value` y la selección sobrevive. Nada
          // de esto depende de un frame.
          el.value = canonico;
          el.select();

          onFocus?.(e);
        }}
        onBlur={(e: FocusEvent<HTMLInputElement>) => {
          setEnFoco(false);
          const cerrado = normalizarMonto(canonico);
          if (cerrado !== canonico) emitir(e.currentTarget, cerrado);
          onBlur?.(e);
        }}
        {...rest}
      />
    );
  }
);
