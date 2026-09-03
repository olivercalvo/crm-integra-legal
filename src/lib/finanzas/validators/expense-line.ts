/**
 * VALIDADOR DE LÍNEAS DE GASTO — compartido por gastos de trámite y compras.
 *
 * Mismo patrón que `validators/business-expense.ts`: sin Zod, cada validador
 * devuelve `{ ok, data, errors }` con `errors` como mapa plano listo para
 * mostrar inline. Acá la clave del error lleva el índice de la línea
 * (`lineas.0.amount`) porque el editor muestra varias a la vez.
 *
 * Corre en el cliente (para marcar el campo mientras se escribe) Y en el
 * servidor (que es donde vale). El cliente no es un permiso.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 LA CUENTA ES OBLIGATORIA AL CREAR, AUNQUE LA COLUMNA SEA NULLABLE
 * ─────────────────────────────────────────────────────────────────────────────
 * `expense_lines.chart_account_code` es NULLABLE porque las líneas del backfill
 * de gastos históricos quedan sin clasificar a propósito — nadie las clasificó
 * nunca y escribirles el default sería inventar el dato (ver el comentario largo
 * en `types/expense-line.ts`).
 *
 * Pero una línea NUEVA nunca puede nacer en NULL: el `NOT NULL` que dejó de
 * proteger la columna lo hace cumplir ESTE archivo. Hay un test que lo fija; si
 * alguien lo saca de acá, la única defensa desaparece con él.
 */

import {
  CUENTA_TRAMITE_DEFAULT,
  impuestoSugerido,
  round2,
  totalesDeLineas,
  type ExpenseLineDraft,
  type TotalesDeGasto,
} from "@/lib/finanzas/types/expense-line";

export type ValidationErrors = Record<string, string>;

export type ValidationResult<T> =
  | { ok: true; data: T; errors: null }
  | { ok: false; data: null; errors: ValidationErrors };

/** Tolerancia (en B/.) al verificar `tax_amount` contra `amount × tax_rate`. */
export const TOLERANCIA_IMPUESTO = 0.02;

/** Máximo de líneas por documento. */
export const MAX_LINEAS = 50;

/** Tope por línea, el mismo orden de magnitud que el resto del módulo. */
const MONTO_MAX = 9_999_999.99;

/** Largos de la descripción, espejo del CHECK de la base. */
export const DESCRIPCION_MIN = 3;
export const DESCRIPCION_MAX = 300;

/** Una línea ya validada, lista para el INSERT. */
export interface LineaValidada {
  line_order: number;
  description: string;
  chart_account_code: string;
  amount: number;
  tax_rate: number;
  tax_amount: number;
}

export interface LineasValidadas {
  lineas: LineaValidada[];
  totales: TotalesDeGasto;
}

/** Una línea vacía para arrancar el editor. */
export function lineaVacia(key: string, cuentaPorDefecto = CUENTA_TRAMITE_DEFAULT): ExpenseLineDraft {
  return {
    key,
    description: "",
    chart_account_code: cuentaPorDefecto,
    amount: "",
    tax_rate: "0",
    tax_amount: "0",
  };
}

/**
 * true si la línea está intacta: recién agregada y sin tocar. Se descarta en
 * silencio al guardar en vez de reclamarle campos vacíos a alguien que apretó
 * "agregar línea" y cambió de idea.
 *
 * La cuenta NO cuenta como "tocada" porque viene precargada con el default.
 */
export function lineaEstaVacia(l: ExpenseLineDraft): boolean {
  return (
    l.description.trim() === "" &&
    l.amount.trim() === "" &&
    (l.tax_amount.trim() === "" || Number(l.tax_amount) === 0)
  );
}

/**
 * Parsea un monto escrito a mano. Acepta la coma decimal, que es lo que teclea
 * cualquiera en Panamá, y los separadores de miles.
 */
function parseMonto(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  // "1.497,85" y "1,497.85" son el mismo número escrito de dos formas. Se
  // decide por la ÚLTIMA marca decimal presente.
  const ultimaComa = s.lastIndexOf(",");
  const ultimoPunto = s.lastIndexOf(".");
  let normal = s;
  if (ultimaComa > ultimoPunto) {
    normal = s.replace(/\./g, "").replace(",", ".");
  } else if (ultimoPunto > ultimaComa) {
    normal = s.replace(/,/g, "");
  } else {
    normal = s.replace(/[.,]/g, "");
  }
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/**
 * Valida el conjunto de líneas de un gasto.
 *
 * Se valida el CONJUNTO y no línea por línea porque hay reglas que solo existen
 * a nivel documento: que haya al menos una línea con monto, y que el total no
 * sea cero.
 */
export function validarLineas(raw: readonly ExpenseLineDraft[]): ValidationResult<LineasValidadas> {
  const errors: ValidationErrors = {};
  const utiles = raw.filter((l) => !lineaEstaVacia(l));

  if (utiles.length === 0) {
    errors["lineas"] = "Agregue al menos una línea con monto";
    return { ok: false, data: null, errors };
  }

  if (utiles.length > MAX_LINEAS) {
    errors["lineas"] = `Un gasto admite hasta ${MAX_LINEAS} líneas`;
    return { ok: false, data: null, errors };
  }

  const lineas: LineaValidada[] = [];

  utiles.forEach((l, i) => {
    const p = `lineas.${i}`;

    // — descripción —
    const desc = l.description.trim();
    if (desc.length < DESCRIPCION_MIN) {
      errors[`${p}.description`] = `Mínimo ${DESCRIPCION_MIN} caracteres`;
    } else if (desc.length > DESCRIPCION_MAX) {
      errors[`${p}.description`] = `Máximo ${DESCRIPCION_MAX} caracteres`;
    }

    // — cuenta: OBLIGATORIA acá aunque la columna sea nullable —
    const cuenta = l.chart_account_code.trim();
    if (cuenta === "") {
      errors[`${p}.chart_account_code`] = "Elija la cuenta contable de esta línea";
    }

    // — monto —
    const amount = parseMonto(l.amount);
    if (amount === null) {
      errors[`${p}.amount`] = "Escriba un monto";
    } else if (amount <= 0) {
      errors[`${p}.amount`] = "El monto debe ser mayor a 0";
    } else if (amount > MONTO_MAX) {
      errors[`${p}.amount`] = "Monto fuera de rango";
    }

    // — tasa —
    const tasa = parseMonto(l.tax_rate) ?? 0;
    if (tasa < 0 || tasa > 1) {
      errors[`${p}.tax_rate`] = "La tasa se guarda como decimal: 0.07 para 7%";
    }

    // — impuesto: se acepta el del comprobante, se verifica con tolerancia —
    const impuesto = parseMonto(l.tax_amount) ?? 0;
    if (impuesto < 0) {
      errors[`${p}.tax_amount`] = "El impuesto no puede ser negativo";
    } else if (amount !== null && amount > 0 && tasa >= 0 && tasa <= 1) {
      const sugerido = impuestoSugerido(amount, tasa);
      if (Math.abs(impuesto - sugerido) > TOLERANCIA_IMPUESTO) {
        errors[`${p}.tax_amount`] =
          `Con tasa ${tasaPct(tasa)} el impuesto sería ${sugerido.toFixed(2)}. ` +
          `Corríjalo o ajuste la tasa.`;
      }
      // Espejo del CHECK de coherencia de la base: con tasa 0 no hay impuesto.
      if (tasa === 0 && impuesto !== 0) {
        errors[`${p}.tax_amount`] = "Con tasa 0 el impuesto tiene que ser 0";
      }
    }

    if (amount !== null && cuenta !== "") {
      lineas.push({
        line_order: i + 1,
        description: desc,
        chart_account_code: cuenta,
        amount: round2(amount),
        tax_rate: round2(tasa * 10000) / 10000,
        tax_amount: round2(impuesto),
      });
    }
  });

  if (Object.keys(errors).length > 0) {
    return { ok: false, data: null, errors };
  }

  const totales = totalesDeLineas(lineas);
  if (totales.total <= 0) {
    return {
      ok: false,
      data: null,
      errors: { lineas: "El total del gasto tiene que ser mayor a 0" },
    };
  }

  return { ok: true, data: { lineas, totales }, errors: null };
}

/** Igual que `tasaLabel` pero sin importar el módulo de tipos en el mensaje. */
function tasaPct(tasa: number): string {
  const pct = round2(tasa * 100);
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}
