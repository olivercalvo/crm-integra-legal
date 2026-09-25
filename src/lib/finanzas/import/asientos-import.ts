/**
 * IMPORTAR ASIENTOS DESDE EXCEL (7.5): leer la hoja y validarla. Módulo PURO.
 *
 * Recibe la hoja como matriz de celdas (lo que devuelve `xlsx`) y el contexto
 * que vive en la base (cuentas activas, meses cerrados). Devuelve los asientos
 * listos para el RPC y TODOS los errores juntos, con fila y columna: se corrige
 * el Excel en una sola vuelta.
 *
 * 🔴 Todo o nada: si hay un solo error, no se contabiliza nada. La vista previa
 *    lo dice antes y el RPC (`post_journal_entries_batch`, 067) lo vuelve a
 *    exigir en una transacción.
 *
 * Reglas (Oliver, 25/09/2026): cuadre por asiento, cuentas existentes y
 * activas, fechas en período abierto, montos positivos con dos decimales.
 *
 * ⚠️ El monto se lee con un parser ESTRICTO que devuelve error, nunca 0.
 *    `parseImporte` del formulario convierte texto basura en 0 (hallazgo 8 del
 *    plan): en un formulario no importa, en un archivo sería un monto cero
 *    silencioso.
 */

export const ENCABEZADOS = [
  "Asiento",
  "Fecha",
  "Descripción del asiento",
  "Referencia",
  "Cuenta",
  "Descripción de la línea",
  "Débito",
  "Crédito",
] as const;

const OBLIGATORIOS = ["asiento", "fecha", "descripcion del asiento", "cuenta", "debito", "credito"];

/** Tope inicial por archivo (plan 7.5, R-B1): se sube después de medir. */
export const MAX_ASIENTOS = 200;
export const MAX_LINEAS = 3000;

export interface ErrorDeFila {
  /** Número de fila del Excel (1 = encabezados). 0 = el archivo entero. */
  fila: number;
  columna: string | null;
  mensaje: string;
}

export interface LineaImportada {
  account_code: string;
  debit: number;
  credit: number;
  description: string | null;
}

export interface AsientoImportado {
  group_label: string;
  first_row: number;
  last_row: number;
  transaction_date: string;
  description: string;
  reference: string | null;
  lines: LineaImportada[];
  total: number;
}

export interface ContextoDeImportacion {
  /** Códigos de cuentas que existen (activas o no). */
  cuentasExistentes: Set<string>;
  /** Códigos de cuentas ACTIVAS. */
  cuentasActivas: Set<string>;
  /** `YYYY-MM` de los meses con período cerrado. */
  mesesCerrados: Set<string>;
  /** Años para los que el motor crea el período solo si falta (el actual y el siguiente). */
  aniosConPeriodoAutomatico: Set<number>;
  /** `YYYY-MM` de los meses que ya tienen período (abierto o cerrado). */
  mesesConPeriodo: Set<string>;
}

export interface ResultadoDeImportacion {
  errores: ErrorDeFila[];
  asientos: AsientoImportado[];
  filasLeidas: number;
  totalDebitos: number;
}

function normalizar(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Monto estricto: número ≥ 0 con hasta dos decimales. Vacío = 0. Nunca "0 por error". */
export function parsearMonto(v: unknown): { ok: true; valor: number } | { ok: false; mensaje: string } {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return { ok: true, valor: 0 };
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else {
    const s = String(v).trim().replace(/^B\/\.\s*/i, "").replace(/\s/g, "");
    if (!/^-?[\d.,]+$/.test(s)) return { ok: false, mensaje: `"${String(v)}" no es un monto.` };
    const coma = s.lastIndexOf(",");
    const punto = s.lastIndexOf(".");
    const normal =
      coma > punto ? s.replace(/\./g, "").replace(",", ".") : punto > coma ? s.replace(/,/g, "") : s;
    n = Number(normal);
  }
  if (!Number.isFinite(n)) return { ok: false, mensaje: `"${String(v)}" no es un monto.` };
  if (n < 0) return { ok: false, mensaje: "El monto no puede ser negativo: usa la otra columna (Débito o Crédito)." };
  if (Math.abs(round2(n) - n) > 1e-9) return { ok: false, mensaje: `El monto ${n} tiene más de dos decimales.` };
  return { ok: true, valor: round2(n) };
}

/** Fecha: celda de fecha de Excel, `AAAA-MM-DD` o `DD/MM/AAAA` (nunca MM/DD). */
export function parsearFecha(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const valida = (a: number, m: number, d: number) => {
    const f = new Date(Date.UTC(a, m - 1, d));
    return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d
      ? `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      : null;
  };
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return valida(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    // Serial de Excel (sistema 1900): días desde el 30/12/1899.
    const f = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return valida(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return valida(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/**
 * Lee la matriz (fila 0 = encabezados) y valida TODO. Nunca lanza: los
 * problemas vuelven como errores con fila y columna.
 */
export function validarImportacion(matriz: unknown[][], ctx: ContextoDeImportacion): ResultadoDeImportacion {
  const errores: ErrorDeFila[] = [];
  const vacio: ResultadoDeImportacion = { errores, asientos: [], filasLeidas: 0, totalDebitos: 0 };

  if (!matriz || matriz.length === 0) {
    errores.push({ fila: 0, columna: null, mensaje: "La hoja está vacía." });
    return vacio;
  }

  // ── Encabezados ──────────────────────────────────────────────────────────
  const enc = (matriz[0] ?? []).map(normalizar);
  const col = (nombre: string) => enc.indexOf(nombre);
  const faltan = OBLIGATORIOS.filter((n) => col(n) < 0);
  if (faltan.length > 0) {
    errores.push({
      fila: 1,
      columna: null,
      mensaje:
        `Faltan columnas en la fila de encabezados: ${faltan.join(", ")}. ` +
        `Usa la plantilla: ${ENCABEZADOS.join(" · ")}.`,
    });
    return vacio;
  }
  const C = {
    asiento: col("asiento"),
    fecha: col("fecha"),
    descripcion: col("descripcion del asiento"),
    referencia: col("referencia"),
    cuenta: col("cuenta"),
    descLinea: col("descripcion de la linea"),
    debito: col("debito"),
    credito: col("credito"),
  };
  const celda = (fila: unknown[], i: number) => (i >= 0 ? fila[i] : null);
  const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

  // ── Filas ────────────────────────────────────────────────────────────────
  interface Fila {
    n: number;
    grupo: string;
    fecha: string | null;
    descripcion: string;
    referencia: string;
    cuenta: string;
    descLinea: string;
    debito: number;
    credito: number;
  }
  const filas: Fila[] = [];
  for (let i = 1; i < matriz.length; i++) {
    const r = matriz[i] ?? [];
    if (r.every((c) => texto(c) === "")) continue;
    const n = i + 1;
    const grupo = texto(celda(r, C.asiento));
    const cuenta = texto(celda(r, C.cuenta));
    const fecha = parsearFecha(celda(r, C.fecha));
    const d = parsearMonto(celda(r, C.debito));
    const c = parsearMonto(celda(r, C.credito));

    if (!grupo) errores.push({ fila: n, columna: "Asiento", mensaje: "Falta el identificador del asiento." });
    if (!fecha) {
      errores.push({
        fila: n,
        columna: "Fecha",
        mensaje: `Fecha inválida: "${texto(celda(r, C.fecha))}". Usa DD/MM/AAAA o AAAA-MM-DD.`,
      });
    }
    if (!cuenta) {
      errores.push({ fila: n, columna: "Cuenta", mensaje: "Falta la cuenta." });
    } else if (!ctx.cuentasExistentes.has(cuenta)) {
      errores.push({ fila: n, columna: "Cuenta", mensaje: `La cuenta ${cuenta} no existe en el plan de cuentas.` });
    } else if (!ctx.cuentasActivas.has(cuenta)) {
      errores.push({ fila: n, columna: "Cuenta", mensaje: `La cuenta ${cuenta} está desactivada en el plan de cuentas.` });
    }
    if (!d.ok) errores.push({ fila: n, columna: "Débito", mensaje: d.mensaje });
    if (!c.ok) errores.push({ fila: n, columna: "Crédito", mensaje: c.mensaje });
    const deb = d.ok ? d.valor : 0;
    const cre = c.ok ? c.valor : 0;
    if (d.ok && c.ok) {
      if (deb > 0 && cre > 0) {
        errores.push({ fila: n, columna: "Débito", mensaje: "La línea tiene débito y crédito. Deja solo uno." });
      } else if (deb === 0 && cre === 0) {
        errores.push({ fila: n, columna: "Débito", mensaje: "La línea no tiene monto: pon el débito o el crédito." });
      }
    }
    filas.push({
      n,
      grupo,
      fecha,
      descripcion: texto(celda(r, C.descripcion)),
      referencia: texto(celda(r, C.referencia)),
      cuenta,
      descLinea: texto(celda(r, C.descLinea)),
      debito: deb,
      credito: cre,
    });
  }

  if (filas.length === 0) {
    errores.push({ fila: 0, columna: null, mensaje: "La hoja no tiene filas con datos debajo de los encabezados." });
    return { ...vacio, errores };
  }
  if (filas.length > MAX_LINEAS) {
    errores.push({ fila: 0, columna: null, mensaje: `El archivo tiene ${filas.length} líneas; el máximo es ${MAX_LINEAS}.` });
  }

  // ── Agrupar: las filas de un asiento tienen que estar juntas ─────────────
  const grupos: { label: string; filas: Fila[] }[] = [];
  const vistos = new Set<string>();
  for (const f of filas) {
    if (!f.grupo) continue;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.label === f.grupo) {
      ultimo.filas.push(f);
    } else {
      if (vistos.has(f.grupo)) {
        errores.push({
          fila: f.n,
          columna: "Asiento",
          mensaje: `Las filas del asiento "${f.grupo}" tienen que estar juntas; esta aparece separada de las demás.`,
        });
      }
      vistos.add(f.grupo);
      grupos.push({ label: f.grupo, filas: [f] });
    }
  }
  if (grupos.length > MAX_ASIENTOS) {
    errores.push({ fila: 0, columna: null, mensaje: `El archivo tiene ${grupos.length} asientos; el máximo es ${MAX_ASIENTOS}.` });
  }

  // ── Cada asiento ─────────────────────────────────────────────────────────
  const asientos: AsientoImportado[] = [];
  let totalDebitos = 0;
  for (const g of grupos) {
    const primera = g.filas[0];
    const fecha = primera.fecha;
    const descripcion = g.filas.map((f) => f.descripcion).find((x) => x) ?? "";
    const referencia = g.filas.map((f) => f.referencia).find((x) => x) ?? "";

    for (const f of g.filas.slice(1)) {
      if (f.fecha && fecha && f.fecha !== fecha) {
        errores.push({ fila: f.n, columna: "Fecha", mensaje: `Todas las líneas del asiento "${g.label}" van con la misma fecha.` });
      }
      if (f.descripcion && f.descripcion !== descripcion) {
        errores.push({ fila: f.n, columna: "Descripción del asiento", mensaje: `El asiento "${g.label}" tiene dos descripciones distintas.` });
      }
      if (f.referencia && f.referencia !== referencia) {
        errores.push({ fila: f.n, columna: "Referencia", mensaje: `El asiento "${g.label}" tiene dos referencias distintas.` });
      }
    }
    if (descripcion.length < 3) {
      errores.push({ fila: primera.n, columna: "Descripción del asiento", mensaje: `El asiento "${g.label}" necesita una descripción de al menos 3 caracteres.` });
    }
    if (g.filas.length < 2) {
      errores.push({ fila: primera.n, columna: "Asiento", mensaje: `El asiento "${g.label}" tiene una sola línea: necesita al menos dos.` });
    }
    const deb = round2(g.filas.reduce((s, f) => s + f.debito, 0));
    const cre = round2(g.filas.reduce((s, f) => s + f.credito, 0));
    if (deb !== cre) {
      const dif = round2(Math.abs(deb - cre));
      errores.push({
        fila: primera.n,
        columna: "Débito",
        mensaje: `El asiento "${g.label}" no cuadra: débitos B/. ${deb.toFixed(2)}, créditos B/. ${cre.toFixed(2)}; faltan B/. ${dif.toFixed(2)} en el ${deb > cre ? "crédito" : "débito"}.`,
      });
    }
    if (fecha) {
      const mes = fecha.slice(0, 7);
      const [a, m] = mes.split("-");
      if (ctx.mesesCerrados.has(mes)) {
        errores.push({ fila: primera.n, columna: "Fecha", mensaje: `El mes ${m}/${a} está cerrado.` });
      } else if (!ctx.mesesConPeriodo.has(mes) && !ctx.aniosConPeriodoAutomatico.has(Number(a))) {
        errores.push({ fila: primera.n, columna: "Fecha", mensaje: `No hay período contable abierto para ${m}/${a}.` });
      }
    }
    totalDebitos += deb;
    asientos.push({
      group_label: g.label,
      first_row: primera.n,
      last_row: g.filas[g.filas.length - 1].n,
      transaction_date: fecha ?? "",
      description: descripcion,
      reference: referencia || null,
      lines: g.filas.map((f) => ({
        account_code: f.cuenta,
        debit: f.debito,
        credit: f.credito,
        description: f.descLinea || null,
      })),
      total: deb,
    });
  }

  errores.sort((a, b) => a.fila - b.fila);
  return { errores, asientos, filasLeidas: filas.length, totalDebitos: round2(totalDebitos) };
}
