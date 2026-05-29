"use client";

import { forwardRef } from "react";
import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";

type InputProps = ComponentProps<typeof Input>;

/**
 * NumberInput — wrapper sobre <Input type="number"> que neutraliza:
 *   - Scroll-wheel (default decrementa step)
 *   - Arrow Up / Down (default decrementa step)
 *   - Page Up / Down (default decrementa por 10x step)
 *
 * Bug reportado: COT-001287 guardó unit_price=99.99 cuando se ingresó
 * 100.00 — el usuario scrolleó la rueda del mouse sobre el input
 * mientras estaba focused y decrementó el valor en step (0.01).
 *
 * Mantiene API drop-in con <Input type="number">.
 */
export const NumberInput = forwardRef<HTMLInputElement, InputProps>(
  function NumberInput(props, ref) {
    const { onWheel, onKeyDown, ...rest } = props;
    return (
      <Input
        ref={ref}
        type="number"
        {...rest}
        onWheel={(e) => {
          (e.target as HTMLInputElement).blur();
          onWheel?.(e);
        }}
        onKeyDown={(e) => {
          if (
            e.key === "ArrowUp" ||
            e.key === "ArrowDown" ||
            e.key === "PageUp" ||
            e.key === "PageDown"
          ) {
            e.preventDefault();
          }
          onKeyDown?.(e);
        }}
      />
    );
  }
);
