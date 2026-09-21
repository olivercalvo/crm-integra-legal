/**
 * ASIENTO MANUAL DE DIARIO — armado puro.
 *
 * Lo que pidió el acta del 25/08/2026: *"módulo de asientos de diario: fecha,
 * referencia, número, líneas con débito y crédito"*. El número lo asigna el
 * ledger; los otros tres los carga la persona.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🚫 LO QUE ESTE ARCHIVO **NO** VALIDA, Y NO ES UN OLVIDO
 * ═════════════════════════════════════════════════════════════════════════════
 * Las reglas contables de un asiento ya las hace cumplir `post_journal_entry`, y
 * duplicarlas acá crearía dos verdades que se desincronizan. Lo que el RPC
 * rechaza, con su mensaje —directamente mostrable, ya viene en español—:
 *
 * | Regla | Mensaje del RPC |
 * |---|---|
 * | Débitos = créditos | *"El asiento no cuadra: débitos 1500.00 vs créditos 1400.00 (diferencia 100.00)"* |
 * | Mínimo 2 líneas | *"Un asiento necesita al menos 2 líneas (partida doble); llegaron 1"* |
 * | Débito O crédito, nunca ambos | *"N línea(s) inválidas: cada línea lleva débito O crédito, mayor que cero, nunca ambos ni ninguno"* |
 * | Cuentas del plan y activas | *"Cuenta(s) inexistentes o inactivas en el plan: 4101, 5201"* — nombra cuáles |
 * | Todo en cero | *"El asiento suma cero: no hay nada que registrar"* |
 * | Período cerrado | *"El período 2026-03 está CERRADO: no admite asientos nuevos."* |
 *
 * `totalesManuales()` SÍ calcula el cuadre, pero **no como validación**: es el
 * totalizador que la pantalla muestra mientras se carga, para que la diferencia
 * se vea antes de apretar. Es la misma regla mostrada antes, no una segunda.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 ACÁ **NO** VA EL GUARD DE CUENTAS DE GASTO
 * ═════════════════════════════════════════════════════════════════════════════
 * `esTipoValidoParaGasto()` rechaza ingreso, patrimonio y pasivo. **No se usa acá,
 * y nunca hay que "unificarlo".**
 *
 * Un asiento manual es justamente el mecanismo para tocar lo que ningún documento
 * toca: el aporte de capital de las socias va contra **patrimonio**, un ajuste de
 * ingresos diferidos contra **ingreso**, la distribución del resultado contra
 * `300004`. Aplicarle el guard de gastos convertiría la herramienta de ajuste en
 * la única que no puede ajustar.
 *
 * Es la regla 3 de SOP-024 en su tercera forma: el 03/09/2026 vimos un guard
 * demasiado ancho (trámite) y uno demasiado estricto (compras); reusar éste sería
 * el tercer error — un guard correcto **en el módulo equivocado**.
 *
 * El único filtro que corresponde es el que el RPC ya hace: la cuenta tiene que
 * existir y estar activa.
 *
 * Módulo PURO: sin I/O, sin React, sin Supabase.
 */

import { round2 } from "@/lib/finanzas/types/expense-line";
import { formatearMonto } from "@/lib/utils/monto-input";

/** Una línea del asiento en edición. Strings porque vienen de inputs del DOM. */
export interface LineaManualDraft {
  /** Clave local del editor, no un id de base. */
  key: string;
  account_code: string;
  debit: string;
  credit: string;
  description: string;
}

/** Una línea ya lista para el RPC. */
export interface LineaManual {
  account_code: string;
  debit: number;
  credit: number;
  description: string | null;
}

export interface TotalesManuales {
  debitos: number;
  creditos: number;
  /** `débitos − créditos`. Cero = cuadra. */
  diferencia: number;
  cuadra: boolean;
}

/** Máximo de líneas por asiento. Un ajuste de depreciación rara vez pasa de 20. */
export const MAX_LINEAS_MANUALES = 100;

/** Una línea vacía para arrancar el editor. */
export function lineaManualVacia(key: string): LineaManualDraft {
  return { key, account_code: "", debit: "", credit: "", description: "" };
}

/**
 * Parsea un importe escrito a mano. Acepta la coma decimal, que es lo que teclea
 * cualquiera en Panamá, y los separadores de miles.
 *
 * Vacío → 0, porque en un asiento la mitad de las celdas están vacías por diseño:
 * una línea es débito O crédito.
 */
export function parseImporte(raw: string): number {
  const s = (raw ?? "").trim();
  if (s === "") return 0;
  const ultimaComa = s.lastIndexOf(",");
  const ultimoPunto = s.lastIndexOf(".");
  let normal: string;
  if (ultimaComa > ultimoPunto) normal = s.replace(/\./g, "").replace(",", ".");
  else if (ultimoPunto > ultimaComa) normal = s.replace(/,/g, "");
  else normal = s.replace(/[.,]/g, "");
  const n = Number(normal);
  return Number.isFinite(n) ? n : 0;
}

/**
 * true si la línea está intacta: recién agregada y sin tocar. Se descarta en
 * silencio al guardar, en vez de reclamarle campos a alguien que apretó "agregar
 * línea" y cambió de idea.
 */
export function lineaManualVaciaODescartable(l: LineaManualDraft): boolean {
  return (
    l.account_code.trim() === "" &&
    parseImporte(l.debit) === 0 &&
    parseImporte(l.credit) === 0 &&
    l.description.trim() === ""
  );
}

/**
 * Los totales de lo que hay cargado. Es lo que el contador mira mientras carga:
 * la diferencia en vivo es la diferencia entre un asiento que entra al primer
 * intento y uno que rebota.
 *
 * Redondea cada suma al final, no línea por línea, por el mismo motivo que
 * `totalesDeLineas()`: el RPC compara `round(sum(debit),2)` contra
 * `round(sum(credit),2)`, y sumar redondeos daría otro número.
 */
export function totalesManuales(
  lineas: readonly LineaManualDraft[]
): TotalesManuales {
  let d = 0;
  let c = 0;
  for (const l of lineas) {
    d += parseImporte(l.debit);
    c += parseImporte(l.credit);
  }
  const debitos = round2(d);
  const creditos = round2(c);
  const diferencia = round2(debitos - creditos);
  return { debitos, creditos, diferencia, cuadra: diferencia === 0 };
}

export interface EstadoDelRegistro {
  /** true = el botón "Registrar en el libro" va habilitado. */
  puede: boolean;
  /** Por qué NO se puede, redactado para quien carga. `null` si se puede. */
  motivo: string | null;
}

/**
 * POR QUÉ EL BOTÓN DE REGISTRAR ESTÁ APAGADO.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ESTO EXISTE POR UN BLOQUEO REAL EN LA DEMO DEL 09/09/2026
 * ═════════════════════════════════════════════════════════════════════════════
 * El formulario decidía con un booleano de cuatro cláusulas y **sólo una tenía
 * explicación en pantalla** (el cuadre). RM armó un asiento de 100 contra 100,
 * el totalizador se puso verde, y el botón siguió apagado porque faltaba la
 * descripción — que no avisaba nada. Desde afuera se veía como un botón roto.
 *
 * La regla que quedó: **una condición que apaga el botón tiene que poder
 * decir por qué.** Por eso esto devuelve un motivo y no un booleano: no se
 * puede agregar una condición sin escribir su frase.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SE DEVUELVE UN SOLO MOTIVO, EL PRÓXIMO PASO
 * ─────────────────────────────────────────────────────────────────────────────
 * No la lista de todo lo que falta. El orden es el de dependencia —sin importes
 * no tiene sentido hablar de cuadre— así que cada frase es la acción que sigue.
 *
 * ⚠️ Las frases son para un contador, no para un programador: nombran lo que
 *    falta en la pantalla, nunca el campo del código ni su largo mínimo.
 */
export function estadoDelRegistro(
  lineas: readonly LineaManualDraft[],
  descripcion: string,
  enviando = false
): EstadoDelRegistro {
  if (enviando) {
    return { puede: false, motivo: "Registrando el asiento…" };
  }

  // Se numeran como las ve la persona: "Línea 1" es la primera de la pantalla,
  // aunque esté vacía y no cuente para el asiento.
  const utiles = lineas
    .map((l, i) => ({ linea: l, numero: i + 1 }))
    .filter((x) => !lineaManualVaciaODescartable(x.linea));

  const totales = totalesManuales(lineas);

  if (totales.debitos === 0 && totales.creditos === 0) {
    return {
      puede: false,
      motivo: "Cargue los importes: cada línea lleva un débito o un crédito.",
    };
  }

  const sinCuenta = utiles.filter((x) => x.linea.account_code.trim() === "");
  if (sinCuenta.length > 0) {
    const ns = sinCuenta.map((x) => x.numero);
    return {
      puede: false,
      motivo:
        ns.length === 1
          ? `Elegí la cuenta contable de la línea ${ns[0]}.`
          : `Elegí la cuenta contable de las líneas ${ns.join(", ")}.`,
    };
  }

  if (!totales.cuadra) {
    // Se dice de qué lado falta, que es lo que se hace con el dato. La
    // diferencia es `débitos − créditos`: positiva = sobra débito.
    const falta = formatearMonto(String(Math.abs(totales.diferencia)));
    const lado = totales.diferencia > 0 ? "crédito" : "débito";
    return {
      puede: false,
      motivo: `El asiento no cuadra: faltan B/. ${falta} en el ${lado}.`,
    };
  }

  if (descripcion.trim().length < 3) {
    return {
      puede: false,
      motivo: "Falta describir la naturaleza del asiento: qué operación registra.",
    };
  }

  return { puede: true, motivo: null };
}

export type ArmadoManual =
  | { ok: true; lineas: LineaManual[]; totales: TotalesManuales }
  | { ok: false; mensaje: string };

/**
 * Convierte los borradores en líneas para el RPC.
 *
 * Solo hace lo que el RPC NO puede hacer: descartar las líneas intactas y pasar
 * de string a número. Las tres comprobaciones de abajo existen únicamente porque
 * sin ellas el request ni siquiera llegaría bien formado — no son reglas
 * contables, que viven todas en `post_journal_entry`.
 */
export function armarAsientoManual(
  borradores: readonly LineaManualDraft[]
): ArmadoManual {
  const utiles = borradores.filter((l) => !lineaManualVaciaODescartable(l));

  if (utiles.length === 0) {
    return { ok: false, mensaje: "El asiento no tiene ninguna línea cargada." };
  }
  if (utiles.length > MAX_LINEAS_MANUALES) {
    return {
      ok: false,
      mensaje: `Un asiento admite hasta ${MAX_LINEAS_MANUALES} líneas.`,
    };
  }

  const sinCuenta = utiles.filter((l) => l.account_code.trim() === "");
  if (sinCuenta.length > 0) {
    // Sin código de cuenta el RPC contestaría "Cuenta(s) inexistentes: " con la
    // lista vacía, que no dice nada. Es lo único que conviene atajar antes.
    const n = sinCuenta.length;
    return {
      ok: false,
      mensaje:
        n === 1
          ? "Hay una línea sin cuenta contable. Elegila o borrá la línea."
          : `Hay ${n} líneas sin cuenta contable. Elegilas o borrá las líneas.`,
    };
  }

  const lineas: LineaManual[] = utiles.map((l) => ({
    account_code: l.account_code.trim(),
    debit: round2(parseImporte(l.debit)),
    credit: round2(parseImporte(l.credit)),
    description: l.description.trim() === "" ? null : l.description.trim(),
  }));

  return { ok: true, lineas, totales: totalesManuales(utiles) };
}
