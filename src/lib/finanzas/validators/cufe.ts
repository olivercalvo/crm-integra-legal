/**
 * El CUFE que alguien copia del portal de ideati y pega en el CRM (caso B).
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * SE VALIDA LA FORMA MÍNIMA, NO UN PATRÓN CERRADO
 * ═════════════════════════════════════════════════════════════════════════════
 * Mismo criterio que el RUC (`CLAUDE.md`, Proveedores): un validador estricto
 * rechaza datos legítimos y deja a alguien sin poder trabajar, que es peor y
 * más silencioso que un rechazo de la DGI. Acá el riesgo es todavía más claro:
 * el CUFE codifica tipo de documento, RUC del emisor, punto, fecha y un
 * verificador, y las facturas del caso B son **de otro punto de facturación**
 * (`050`) y de otro año. Un patrón calcado sobre los CUFE que tenemos hoy
 * rechazaría exactamente los que hacen falta cargar.
 *
 * 📋 Medido el 24/09/2026 sobre los CUFE reales de staging: **66 caracteres**,
 *    prefijo `FE`, y sólo `A-Z`, `0-9` y `-`. Los tres son iguales.
 *
 * Así que se exige: sólo caracteres del alfabeto observado, que empiece con
 * `FE` y un largo dentro de un rango generoso alrededor de 66. Lo que se sale
 * de eso casi seguro es un copiar-y-pegar cortado, un espacio de más o el
 * número de protocolo en vez del CUFE — los tres errores reales de teclear a
 * mano, y los tres detectables sin arriesgar un falso rechazo.
 *
 * 🔴 LO QUE ESTO NO HACE: decir que el CUFE existe ante la DGI. Eso no lo sabe
 * nadie más que la DGI, e **ideati no tiene endpoint para consultarlo** (su
 * swagger completo, revisado el 23/09/2026: hay `GET
 * /Invoices/Authorization/{cufe}`, que sirve para un documento propio ya
 * emitido, no para verificar uno ajeno). Si el CUFE está mal, se va a ver como
 * un rechazo al emitir la nota de crédito. La pantalla lo dice.
 */

/** Largo medido en los CUFE reales. */
export const CUFE_LARGO_TIPICO = 66;

/**
 * Margen alrededor del largo típico. Generoso a propósito: no sabemos si el
 * largo varía con el tipo de documento o el punto de facturación, y no se va a
 * suponer que no.
 */
export const CUFE_LARGO_MIN = 40;
export const CUFE_LARGO_MAX = 120;

const ALFABETO = /^[A-Z0-9-]+$/;

export type ProblemaDeCufe =
  | "vacio"
  | "muy_corto"
  | "muy_largo"
  | "caracteres_invalidos"
  | "sin_prefijo_fe";

export interface ResultadoDeCufe {
  ok: boolean;
  /** El valor ya normalizado: sin espacios y en mayúsculas. */
  valor: string;
  problema: ProblemaDeCufe | null;
  /** Mensaje mostrable. `null` si está bien. */
  mensaje: string | null;
  /**
   * Avisos que NO bloquean, igual que `avisosDeRuc()`. Se muestran para que
   * quien carga mire dos veces, nunca para impedirle guardar.
   */
  avisos: string[];
}

/**
 * Normaliza y valida. **Quita todos los espacios**, incluidos los del medio:
 * el portal muestra el CUFE cortado en varias líneas y al copiarlo vienen
 * saltos de línea adentro. Rechazarlo por eso sería castigar a la persona por
 * algo que el CRM puede arreglar solo.
 */
export function validarCufe(entrada: string | null | undefined): ResultadoDeCufe {
  const valor = String(entrada ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();

  const avisos: string[] = [];
  const base = { valor, avisos };

  if (valor.length === 0) {
    return { ...base, ok: false, problema: "vacio", mensaje: "Pegue el CUFE de la factura." };
  }
  if (!ALFABETO.test(valor)) {
    return {
      ...base,
      ok: false,
      problema: "caracteres_invalidos",
      mensaje:
        "El CUFE sólo lleva letras, números y guiones. Revise que no se haya copiado algún " +
        "otro carácter junto con el número.",
    };
  }
  if (valor.length < CUFE_LARGO_MIN) {
    return {
      ...base,
      ok: false,
      problema: "muy_corto",
      mensaje:
        `Ese CUFE tiene ${valor.length} caracteres y los de la DGI tienen alrededor de ` +
        `${CUFE_LARGO_TIPICO}. Puede que se haya copiado cortado, o que sea el número de ` +
        "protocolo en vez del CUFE.",
    };
  }
  if (valor.length > CUFE_LARGO_MAX) {
    return {
      ...base,
      ok: false,
      problema: "muy_largo",
      mensaje:
        `Ese CUFE tiene ${valor.length} caracteres y los de la DGI tienen alrededor de ` +
        `${CUFE_LARGO_TIPICO}. Puede que se haya copiado de más.`,
    };
  }
  if (!valor.startsWith("FE")) {
    return {
      ...base,
      ok: false,
      problema: "sin_prefijo_fe",
      mensaje:
        "El CUFE de una factura electrónica empieza con FE. Revise que no sea el número de " +
        "protocolo ni el de autorización.",
    };
  }

  // ── Avisos que no bloquean ────────────────────────────────────────────────
  if (valor.length !== CUFE_LARGO_TIPICO) {
    avisos.push(
      `Este CUFE tiene ${valor.length} caracteres y los que emitió el sistema tienen ` +
        `${CUFE_LARGO_TIPICO}. Puede ser correcto (las facturas del portal son de otro punto ` +
        "de facturación), pero conviene compararlo con el del portal antes de guardar."
    );
  }

  return { ...base, ok: true, problema: null, mensaje: null, avisos };
}
