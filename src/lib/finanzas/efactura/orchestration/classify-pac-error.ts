/**
 * Clasificación del ERROR de una respuesta rechazada del PAC eFactura:
 * decide si es un RECHAZO duro o un DUPLICADO, arma el mensaje que ve la
 * licenciada y agrega una guía accionable cuando el código lo permite.
 *
 * ---------------------------------------------------------------------------
 * Causa raíz (2026-08)
 * ---------------------------------------------------------------------------
 * Al emitir con un RUC inválido, el diálogo mostraba DOS cosas contradictorias
 * a la vez:
 *
 *   "El PAC indicó que el documento ya existe. Posiblemente ya fue autorizado"
 *   · 1601: Regla de formación del RUC inválida
 *   · 1602: RUC inexistente en el Registro Único de Contribuyentes
 *
 * La licenciada leyó "ya fue autorizado" y creyó que debía ANULAR, cuando en
 * realidad fue un rechazo por RUC y bastaba corregir la ficha y reintentar.
 *
 * Dos bugs independientes se sumaron:
 *
 *   1. SUBSTRING. La heurística de duplicado hacía
 *      `msg.includes("existente")`, y "RUC in-EXISTENTE" contiene "existente".
 *      Un código que dice EXACTAMENTE LO CONTRARIO (el RUC no existe) se
 *      leía como "el documento ya existe".
 *
 *   2. PRECEDENCIA. `detectsDuplicate` usaba `.some(...)`: con UN solo match
 *      dudoso entre varios códigos, todo el rechazo se reclasificaba como
 *      duplicado y el motivo real quedaba tapado por el mensaje de "posiblemente
 *      autorizado".
 *
 * Regla que implementa este módulo:
 *
 *   Si hay AL MENOS UN código de rechazo duro → es RECHAZO. El mensaje muestra
 *   SOLO esos motivos. El texto de "duplicado / posiblemente autorizado"
 *   aparece únicamente cuando el PAC señala duplicado y NO hay ningún código
 *   de rechazo que lo acompañe.
 *
 * Módulo PURO (sin I/O) para testearlo sin BD ni red.
 */

/** Entrada gResProc del PAC (rRetEnviFe.xProtFe.rProtFe.gInfProt.gResProc[]). */
export interface CodRes {
  dCodRes?: string;
  dMsgRes?: string;
}

/**
 * Códigos que NO son rechazo. `0260` = "Autorizado el uso de la FE" según la
 * Ficha Técnica DGI v1.00 (§8, Tabla 7); los ceros cubren las variantes de
 * "OK" que distintos PACs devuelven. Todo lo demás con código se trata como
 * rechazo salvo que su mensaje sea la señal de duplicado.
 *
 * NOTA: la Ficha Técnica también distingue efecto "E" (rechazo) de "N"
 * (notificación — ej. 1607/1608/1609/1616/1617 de ubicación del receptor, que
 * NO rechazan). No tenemos la tabla completa en el repo, así que NO se
 * hardcodea una lista de códigos "N": un código N solo llega hasta acá si la
 * respuesta ya venía rechazada, en cuyo caso mostrarlo es correcto.
 */
const NON_REJECTION_CODES = new Set(["0260", "0", "00", "000", "0000"]);

/**
 * Códigos de rechazo por RUC del receptor. Ficha Técnica DGI v1.00 — mismos
 * códigos que ya cita el gate fiscal en fetch-invoice-efactura-bundle.ts:182.
 */
export const RUC_REJECTION_CODES = ["1601", "1602"];

/**
 * Guía en lenguaje claro para códigos accionables por la usuaria. El detalle
 * técnico (código + mensaje del PAC) se sigue mostrando aparte como referencia.
 * Tuteo neutro panameño (voseo es anti-patrón en el proyecto, ver CLAUDE.md).
 */
const CODE_HINTS: Array<{ codes: string[]; hint: string }> = [
  {
    codes: RUC_REJECTION_CODES,
    hint:
      "El RUC del cliente parece inválido o incompleto. " +
      "Verifique el RUC en la ficha del cliente y reintente.",
  },
];

/** ¿El código indica éxito/no-rechazo? */
export function isNonRejectionCode(code: string | undefined): boolean {
  if (!code) return false;
  return NON_REJECTION_CODES.has(code.trim());
}

/**
 * ¿Este código es la señal de "el documento ya existe / ya fue autorizado"?
 *
 * Pattern-matching sobre el mensaje en español: el PAC no documenta un código
 * numérico de duplicado. Las diferencias con la versión anterior:
 *
 *   - `\bexistente\b` con límite de palabra en vez de `includes("existente")`,
 *     para NO matchear "inexistente" (que significa lo opuesto).
 *   - Guarda explícita: si el mensaje niega la existencia ("no existe",
 *     "inexistente", "no se encuentra"), NUNCA es duplicado — aunque alguna
 *     otra subcadena matchee.
 */
export function isDuplicateSignal(c: CodRes): boolean {
  const msg = (c.dMsgRes ?? "").toLowerCase();
  if (!msg) return false;

  // Negaciones: matan la detección de duplicado de entrada.
  if (/\bin\s*existente\b|\binexistente\b|\bno\s+existe\b|\bno\s+se\s+encuentra\b/.test(msg)) {
    return false;
  }

  return (
    /\bduplicad/.test(msg) ||
    /\bya\s+(fue\s+)?autoriz/.test(msg) ||
    /\bya\s+(fue\s+)?emitid/.test(msg) ||
    /\bya\s+existe\b/.test(msg) ||
    /\bexistente\b/.test(msg)
  );
}

/**
 * ¿Es un código de RECHAZO duro? Todo lo que tenga contenido y NO sea ni un
 * código de éxito ni la señal de duplicado.
 */
export function isHardRejection(c: CodRes): boolean {
  if (isNonRejectionCode(c.dCodRes)) return false;
  if (isDuplicateSignal(c)) return false;
  return Boolean(c.dCodRes || c.dMsgRes);
}

/** "[1601] Regla de formación del RUC inválida · [1602] …" */
export function summarizeCodRes(codRes: CodRes[]): string | null {
  if (codRes.length === 0) return null;
  const parts = codRes.map((c) => {
    const code = c.dCodRes ? `[${c.dCodRes}] ` : "";
    const msg = c.dMsgRes ?? "(sin mensaje)";
    return `${code}${msg}`;
  });
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Primera guía accionable que aplique a los códigos presentes; null si ninguna. */
export function hintForCodRes(codRes: CodRes[]): string | null {
  const present = new Set(
    codRes.map((c) => c.dCodRes?.trim()).filter((c): c is string => Boolean(c))
  );
  for (const { codes, hint } of CODE_HINTS) {
    if (codes.some((code) => present.has(code))) return hint;
  }
  return null;
}

export type PacErrorKind = "pac_rejected" | "pac_duplicate";

export interface PacErrorClassification {
  errorKind: PacErrorKind;
  /** Mensaje principal para la UI. */
  errorMessage: string;
  /** Línea de guía accionable en lenguaje claro. null si no aplica. */
  errorHint: string | null;
}

const DUPLICATE_MESSAGE =
  "El PAC indicó que el documento ya existe. Posiblemente ya fue autorizado — " +
  "revise en el portal del PAC antes de reintentar.";

/**
 * Clasifica un rechazo del PAC. `fallbackSummary` se usa cuando no hay códigos
 * (respuesta vacía, no-JSON o shape inesperado).
 *
 * PRECEDENCIA: rechazo duro > duplicado. Si hay al menos un código de rechazo,
 * el mensaje enumera SOLO esos códigos — los duplicate-ish se descartan del
 * texto para no reintroducir la contradicción que confundió a la licenciada.
 */
export function classifyPacError(
  codRes: CodRes[],
  fallbackSummary: string
): PacErrorClassification {
  const hardRejections = codRes.filter(isHardRejection);

  if (hardRejections.length > 0) {
    return {
      errorKind: "pac_rejected",
      errorMessage: summarizeCodRes(hardRejections) ?? fallbackSummary,
      errorHint: hintForCodRes(hardRejections),
    };
  }

  if (codRes.some(isDuplicateSignal)) {
    return {
      errorKind: "pac_duplicate",
      errorMessage: DUPLICATE_MESSAGE,
      errorHint: null,
    };
  }

  return {
    errorKind: "pac_rejected",
    errorMessage: summarizeCodRes(codRes) ?? fallbackSummary,
    errorHint: hintForCodRes(codRes),
  };
}
